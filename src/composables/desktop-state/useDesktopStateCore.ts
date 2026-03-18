import { computed, ref } from 'vue'
import {
  archiveThread,
  renameThread,
  getAvailableModelIds,
  getCurrentModelConfig,
  getPendingServerRequests,
  interruptThreadTurnRaw,
  replyToServerRequest,
  rollbackThreadRaw,
  getThreadGroups,
  getWorkspaceRootsState,
  setDefaultModel,
  setWorkspaceRootsState,
  getThreadTitleCache,
  persistThreadTitle,
  generateThreadTitle,
  resumeThread,
  startThread,
  subscribeCodexNotifications,
  startThreadTurnRaw,
  type RpcNotification,
  type SkillInfo,
} from '../../api/codexGateway'
import { normalizeThreadMessagesV2 } from '../../api/normalizers/v2'
import { IS_WASM_RUNTIME } from '../../config/runtime'
import type {
  CommandExecutionData,
  ReasoningEffort,
  ThreadScrollState,
  UiFileAttachment,
  UiLiveOverlay,
  UiMessage,
  UiProjectGroup,
  UiServerRequest,
  UiServerRequestReply,
  UiThread,
} from '../../types/codex'
import {
  areCommandExecutionsEqual as areCommandExecutionsEqualHelper,
  areFileAttachmentsEqual as areFileAttachmentsEqualHelper,
  areTurnActivitiesEqual as areTurnActivitiesEqualHelper,
  areTurnSummariesEqual as areTurnSummariesEqualHelper,
  buildTextWithAttachments as buildTextWithAttachmentsHelper,
  formatTurnDuration as formatTurnDurationHelper,
  insertTurnSummaryMessage as insertTurnSummaryMessageHelper,
  mergeMessages as mergeMessagesHelper,
  normalizeMessageText as normalizeMessageTextHelper,
  omitKey as omitKeyHelper,
  parseIsoTimestamp as parseIsoTimestampHelper,
  projectLiveTurnEvents as projectLiveTurnEventsHelper,
  shouldPreserveFinalizedSnapshot as shouldPreserveFinalizedSnapshotHelper,
  upsertMessage as upsertMessageHelper,
} from './message-helpers'
import {
  flattenThreads as flattenThreadsHelper,
  areStringArraysEqual as areStringArraysEqualHelper,
  mergeProjectOrder as mergeProjectOrderHelper,
  mergeThreadGroups as mergeThreadGroupsHelper,
  orderGroupsByProjectOrder as orderGroupsByProjectOrderHelper,
  reorderStringArray as reorderStringArrayHelper,
  toProjectNameFromWorkspaceRoot as toProjectNameFromWorkspaceRootHelper,
} from './thread-groups'
import {
  clamp as clampHelper,
  loadAutoRefreshEnabled as loadAutoRefreshEnabledHelper,
  loadProjectDisplayNames as loadProjectDisplayNamesHelper,
  loadProjectOrder as loadProjectOrderHelper,
  loadReadStateMap as loadReadStateMapHelper,
  loadSelectedThreadId as loadSelectedThreadIdHelper,
  loadThreadScrollStateMap as loadThreadScrollStateMapHelper,
  saveAutoRefreshEnabled as saveAutoRefreshEnabledHelper,
  saveProjectDisplayNames as saveProjectDisplayNamesHelper,
  saveProjectOrder as saveProjectOrderHelper,
  saveReadStateMap as saveReadStateMapHelper,
  saveSelectedThreadId as saveSelectedThreadIdHelper,
  saveThreadScrollStateMap as saveThreadScrollStateMapHelper,
} from './storage'
import { createDesktopLedger } from './ledger'
import { createThreadListState } from './thread-list-state'
import { createThreadRuntimeState } from './thread-runtime-state'
import { createThreadSync } from './thread-sync'
import {
  extractThreadIdFromNotification,
  isAgentContentEvent,
  normalizeServerRequest,
  readAgentMessageCompleted,
  readAgentMessageDelta,
  readAgentMessageStartedId,
  readCommandExecutionCompleted,
  readCommandExecutionStarted,
  readCommandOutputDelta,
  readNotificationErrorMessage,
  readNotificationThreadName,
  readReasoningCompletedItemId,
  readReasoningDelta,
  readReasoningSectionBreakItemId,
  readReasoningStartedItemId,
  readResolvedServerRequestId,
  readTurnActivity,
  readTurnCompletedInfo,
  readTurnErrorMessage,
  readTurnStartedInfo,
  readToolCallCompleted,
  readToolCallStarted,
  readNumber,
} from './notification-parsers'
import type {
  ChatPhase,
  FileAttachment,
  FinalizedTurnSnapshotState,
  LedgerThreadState,
  LiveTextSegmentState,
  LiveTurnEvent,
  PendingTurnRequest,
  QueuedMessage,
  TurnActivityState,
  TurnCompletedInfo,
  TurnErrorState,
  TurnStartedInfo,
  TurnSummaryState,
} from './types'

const EVENT_SYNC_DEBOUNCE_MS = 220
const AUTO_REFRESH_INTERVAL_MS = 4000
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const MODEL_FALLBACK_ID = 'gpt-5.2-codex'
const flattenThreads = flattenThreadsHelper
const loadReadStateMap = loadReadStateMapHelper
const saveReadStateMap = saveReadStateMapHelper
const loadAutoRefreshEnabled = loadAutoRefreshEnabledHelper
const saveAutoRefreshEnabled = saveAutoRefreshEnabledHelper
const clamp = clampHelper
const loadThreadScrollStateMap = loadThreadScrollStateMapHelper
const saveThreadScrollStateMap = saveThreadScrollStateMapHelper
const loadSelectedThreadId = loadSelectedThreadIdHelper
const saveSelectedThreadId = saveSelectedThreadIdHelper
const loadProjectOrder = loadProjectOrderHelper
const saveProjectOrder = saveProjectOrderHelper
const loadProjectDisplayNames = loadProjectDisplayNamesHelper
const saveProjectDisplayNames = saveProjectDisplayNamesHelper
const mergeProjectOrder = mergeProjectOrderHelper
const orderGroupsByProjectOrder = orderGroupsByProjectOrderHelper
const areStringArraysEqual = areStringArraysEqualHelper
const reorderStringArray = reorderStringArrayHelper
const areCommandExecutionsEqual = areCommandExecutionsEqualHelper

function isUnsupportedChatGptModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('not supported when using codex with a chatgpt account') ||
    message.includes('model is not supported')
  )
}

function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    areStringArraysEqual(first.images, second.images) &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
    first.turnIndex === second.turnIndex
  )
}

function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean } = {},
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous.map((previousMessage) => {
    const nextMessage = incomingById.get(previousMessage.id)
    if (!nextMessage) {
      return previousMessage
    }
    if (areMessageFieldsEqual(previousMessage, nextMessage)) {
      return previousMessage
    }
    return nextMessage
  })

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const merged = [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function areFileAttachmentsEqual(first?: UiFileAttachment[], second?: UiFileAttachment[]): boolean {
  const left = first ?? []
  const right = second ?? []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.label !== right[index]?.label) return false
    if (left[index]?.path !== right[index]?.path) return false
  }
  return true
}

function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingAssistantIds = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id)
      .filter((id) => id.length > 0),
  )
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingAssistantIds.size === 0 && incomingAssistantTexts.size === 0) {
    return previous
  }

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    if (incomingAssistantIds.has(message.id)) return false
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingAssistantTexts.has(normalized)
  })

  return next.length === previous.length ? previous : next
}

function buildTextWithAttachments(
  prompt: string,
  files: Array<{ label: string; path: string; fsPath: string }>,
): string {
  if (files.length === 0) return prompt
  let prefix = '# Files mentioned by the user:\n'
  for (const file of files) {
    prefix += `\n## ${file.label}: ${file.path}\n`
  }
  return `${prefix}\n## My request for Codex:\n\n${prompt}\n`
}

function buildProtocolTurnInput(
  text: string,
  imageUrls: string[],
  skills: Array<{ name: string; path: string }>,
  fileAttachments: Array<{ label: string; path: string; fsPath: string }>,
): Array<Record<string, unknown>> {
  const finalText = buildTextWithAttachments(text, fileAttachments)
  const input: Array<Record<string, unknown>> = [{ type: 'text', text: finalText }]

  for (const imageUrl of imageUrls) {
    const normalizedUrl = imageUrl.trim()
    if (!normalizedUrl) continue
    input.push({
      type: 'image',
      url: normalizedUrl,
      image_url: normalizedUrl,
    })
  }

  for (const skill of skills) {
    input.push({ type: 'skill', name: skill.name, path: skill.path })
  }

  return input
}

function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) {
    return [...previous, nextMessage]
  }

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, nextMessage)) {
    return previous
  }

  const next = [...previous]
  next.splice(existingIndex, 1, nextMessage)
  return next
}

const parseIsoTimestamp = parseIsoTimestampHelper
const formatTurnDuration = formatTurnDurationHelper
const areTurnSummariesEqual = areTurnSummariesEqualHelper
const areTurnActivitiesEqual = areTurnActivitiesEqualHelper
const insertTurnSummaryMessage = insertTurnSummaryMessageHelper
const projectLiveTurnEvents = projectLiveTurnEventsHelper
const shouldPreserveFinalizedSnapshot = shouldPreserveFinalizedSnapshotHelper
const omitKey = omitKeyHelper
const mergeThreadGroups = mergeThreadGroupsHelper
const toProjectNameFromWorkspaceRoot = toProjectNameFromWorkspaceRootHelper

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sanitizeDisplayText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const ledgerByThreadId = ref<Record<string, LedgerThreadState>>({})
  const queuedMessagesByThreadId = ref<Record<string, QueuedMessage[]>>({})
  const eventUnreadByThreadId = ref<Record<string, boolean>>({})
  const availableModelIds = ref<string[]>([])
  const selectedModelId = ref('')
  const selectedReasoningEffort = ref<ReasoningEffort | ''>('medium')
  const readStateByThreadId = ref<Record<string, string>>(loadReadStateMap())
  const scrollStateByThreadId = ref<Record<string, ThreadScrollState>>(loadThreadScrollStateMap())
  const projectOrder = ref<string[]>(loadProjectOrder())
  const projectDisplayNameById = ref<Record<string, string>>(loadProjectDisplayNames())
  const loadedVersionByThreadId = ref<Record<string, string>>({})
  const loadedMessagesByThreadId = ref<Record<string, boolean>>({})
  const resumedThreadById = ref<Record<string, boolean>>({})
  const turnSummaryByThreadId = ref<Record<string, TurnSummaryState>>({})
  const turnActivityByThreadId = ref<Record<string, TurnActivityState>>({})
  const turnErrorByThreadId = ref<Record<string, TurnErrorState>>({})
  const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({})
  const pendingTurnRequestByThreadId = ref<Record<string, PendingTurnRequest>>({})

  const threadTitleById = ref<Record<string, string>>({})

  const installedSkills = ref<SkillInfo[]>([])

  const isLoadingThreads = ref(false)
  const isLoadingMessages = ref(false)
  const isSendingMessage = ref(false)
  const isInterruptingTurn = ref(false)
  const isRollingBack = ref(false)
  const error = ref('')
  const isPolling = ref(false)
  const hasLoadedThreads = ref(false)
  const isAutoRefreshEnabled = ref(loadAutoRefreshEnabled())
  const autoRefreshSecondsLeft = ref(Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000))
  let stopNotificationStream: (() => void) | null = null
  let eventSyncTimer: number | null = null
  let autoRefreshIntervalTimer: number | null = null
  let autoRefreshCountdownTimer: number | null = null
  let pendingThreadsRefresh = false
  const pendingThreadMessageRefresh = new Set<string>()
  let hasHydratedWorkspaceRootsState = false
  let activeReasoningItemId = ''
  let shouldAutoScrollOnNextAgentEvent = false
  const pendingTurnStartsById = new Map<string, TurnStartedInfo>()
  const fallbackRetryInFlightThreadIds = new Set<string>()

  const allThreads = computed(() => flattenThreads(projectGroups.value))
  const selectedThread = computed(() =>
    allThreads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
  )
  const selectedThreadScrollState = computed<ThreadScrollState | null>(
    () => scrollStateByThreadId.value[selectedThreadId.value] ?? null,
  )
  const selectedThreadServerRequests = computed<UiServerRequest[]>(() => {
    const rows: UiServerRequest[] = []
    const selected = selectedThreadId.value
    if (selected && Array.isArray(pendingServerRequestsByThreadId.value[selected])) {
      rows.push(...pendingServerRequestsByThreadId.value[selected])
    }
    if (Array.isArray(pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
    }
    return rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
  })
  const selectedLiveOverlay = computed<UiLiveOverlay | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null

    const activity = turnActivityByThreadId.value[threadId]
    const errorText = (turnErrorByThreadId.value[threadId]?.message ?? '').trim()

    if (!activity && !errorText) return null
    return {
      activityLabel: activity?.label || 'Thinking',
      activityDetails: activity?.details ?? [],
      reasoningText: '',
      errorText,
    }
  })
  const selectedPendingUserMessage = computed<UiMessage | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null

    const pending = pendingTurnRequestByThreadId.value[threadId]
    if (!pending) return null

    const ledger = getLedgerThreadState(threadId)
    const persisted = ledger.confirmedTranscript
    const liveMessages = projectLiveTurnEvents(ledger.liveEventLog)
    const latestPersistedUserMessage = [...persisted].reverse().find((message) => message.role === 'user')

    const pendingAttachments = pending.fileAttachments.map((file) => ({
      label: file.label,
      path: file.path,
    }))

    if (
      latestPersistedUserMessage &&
      latestPersistedUserMessage.text === pending.text &&
      areStringArraysEqual(latestPersistedUserMessage.images, pending.imageUrls) &&
      areFileAttachmentsEqual(latestPersistedUserMessage.fileAttachments, pendingAttachments)
    ) {
      return null
    }

    const hasCurrentTurnLiveArtifacts = liveMessages.length > 0
    if (!hasCurrentTurnLiveArtifacts && !isThreadInProgress(threadId)) {
      return null
    }

    return {
      id: `pending-user:${threadId}`,
      role: 'user',
      text: pending.text,
      images: pending.imageUrls.length > 0 ? [...pending.imageUrls] : undefined,
      fileAttachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      messageType: 'userMessage.pending',
    }
  })
  const messages = computed<UiMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []

    const ledger = getLedgerThreadState(threadId)
    const pendingUserMessage = selectedPendingUserMessage.value
    const liveMessages = projectLiveTurnEvents(ledger.liveEventLog)
    const baseMessages = ledger.finalizedSnapshot?.messages ?? ledger.confirmedTranscript
    const combined = pendingUserMessage
      ? [...baseMessages, pendingUserMessage, ...liveMessages]
      : [...baseMessages, ...liveMessages]

    const summary = turnSummaryByThreadId.value[threadId]
    if (!summary) return combined
    return insertTurnSummaryMessage(combined, summary)
  })

  function setSelectedThreadId(nextThreadId: string): void {
    if (selectedThreadId.value === nextThreadId) return
    selectedThreadId.value = nextThreadId
    saveSelectedThreadId(nextThreadId)
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
  }

  function setSelectedModelId(modelId: string): void {
    selectedModelId.value = modelId.trim()
  }

  async function applyFallbackModelSelection(): Promise<void> {
    selectedModelId.value = MODEL_FALLBACK_ID
    if (!availableModelIds.value.includes(MODEL_FALLBACK_ID)) {
      availableModelIds.value = [...availableModelIds.value, MODEL_FALLBACK_ID]
    }
    try {
      await setDefaultModel(MODEL_FALLBACK_ID)
    } catch {
      // Keep local selection even when persisting default model fails.
    }
  }

  function setPendingTurnRequest(threadId: string, request: PendingTurnRequest): void {
    pendingTurnRequestByThreadId.value = {
      ...pendingTurnRequestByThreadId.value,
      [threadId]: request,
    }
  }

  function clearPendingTurnRequest(threadId: string): void {
    if (!pendingTurnRequestByThreadId.value[threadId]) return
    pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId)
  }

  async function retryPendingTurnWithFallback(threadId: string): Promise<void> {
    if (fallbackRetryInFlightThreadIds.has(threadId)) return
    const pending = pendingTurnRequestByThreadId.value[threadId]
    if (!pending || pending.fallbackRetried) return

    fallbackRetryInFlightThreadIds.add(threadId)
    setPendingTurnRequest(threadId, {
      ...pending,
      fallbackRetried: true,
    })

    try {
      await applyFallbackModelSelection()
      // Remove the failed user turn before replaying on fallback model to avoid duplicated user messages.
      try {
        const payload = await rollbackThreadRaw(threadId, 1)
        const rolledBackMessages = normalizeThreadMessagesV2({ thread: payload.thread })
        setConfirmedTranscriptForThread(threadId, rolledBackMessages, { inProgress: false })
        clearLiveLedger(threadId)
        clearActiveLiveTextSegment(threadId)
        setFinalizedTurnSnapshotForThread(threadId, null, { forceClear: true })
      } catch {
        // If rollback fails, continue with retry rather than dropping the turn.
      }
      setTurnErrorForThread(threadId, null)
      error.value = ''
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, {
        label: 'Thinking',
        details: buildPendingTurnDetails(MODEL_FALLBACK_ID, pending.effort),
      })
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: 'live',
        finalizedSnapshot: null,
      }))

      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
      }

      await startThreadTurnRaw(
        threadId,
        buildProtocolTurnInput(
          pending.text,
          pending.imageUrls,
          pending.skills,
          pending.fileAttachments,
        ),
        {
          model: MODEL_FALLBACK_ID,
          effort: pending.effort || undefined,
          attachments: pending.fileAttachments,
        },
      )

      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }

      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: current.phase === 'failed' ? 'failed' : 'settled',
        activeTurnId: '',
      }))
      setTurnActivityForThread(threadId, null)
    } finally {
      fallbackRetryInFlightThreadIds.delete(threadId)
    }
  }

  function setSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
    if (effort && !REASONING_EFFORT_OPTIONS.includes(effort)) {
      return
    }
    selectedReasoningEffort.value = effort
  }

  function buildPendingTurnDetails(_modelId: string, _effort: ReasoningEffort | ''): string[] {
    return []
  }

  async function refreshModelPreferences(): Promise<void> {
    try {
      const [modelIds, currentConfig] = await Promise.all([
        getAvailableModelIds(),
        getCurrentModelConfig(),
      ])

      availableModelIds.value = modelIds

      const hasSelectedModel = selectedModelId.value.length > 0 && modelIds.includes(selectedModelId.value)
      if (!hasSelectedModel) {
        if (currentConfig.model && modelIds.includes(currentConfig.model)) {
          selectedModelId.value = currentConfig.model
        } else if (modelIds.length > 0) {
          selectedModelId.value = modelIds[0]
        } else {
          selectedModelId.value = ''
        }
      }

      if (
        currentConfig.reasoningEffort &&
        REASONING_EFFORT_OPTIONS.includes(currentConfig.reasoningEffort)
      ) {
        selectedReasoningEffort.value = currentConfig.reasoningEffort
      }
    } catch {
      // Keep chat UI usable even if model metadata is temporarily unavailable.
    }
  }

  let applyThreadFlags = (): void => {}

  const {
    markThreadAsRead,
    setTurnSummaryForThread,
    markThreadUnreadByEvent,
    setTurnActivityForThread,
    setTurnErrorForThread,
    currentThreadVersion,
    setThreadScrollState,
    upsertPendingServerRequest,
    removePendingServerRequestById,
    handleServerRequestNotification,
  } = createThreadRuntimeState({
    selectedThreadId,
    readStateByThreadId,
    scrollStateByThreadId,
    turnSummaryByThreadId,
    turnActivityByThreadId,
    turnErrorByThreadId,
    eventUnreadByThreadId,
    pendingServerRequestsByThreadId,
    globalServerRequestScope: GLOBAL_SERVER_REQUEST_SCOPE,
    clamp,
    saveReadStateMap,
    saveThreadScrollStateMap,
    applyThreadFlags,
    getSourceThreads: () => flattenThreads(sourceGroups.value),
  })

  const {
    getLedgerThreadState,
    isThreadInProgress,
    updateLedgerThreadState,
    setConfirmedTranscriptForThread,
    setFinalizedTurnSnapshotForThread,
    buildFinalizedTurnSnapshot,
    clearActiveLiveTextSegment,
    appendLiveTextSegment,
    hasLiveTextSegmentsForItem,
    clearLiveLedger,
    appendLiveEvent,
  } = createDesktopLedger({
    ledgerByThreadId,
    onPhaseChange: () => applyThreadFlags(),
  })

  const threadListState = createThreadListState({
    sourceGroups,
    projectGroups,
    projectOrder,
    selectedThreadId,
    readStateByThreadId,
    scrollStateByThreadId,
    loadedMessagesByThreadId,
    loadedVersionByThreadId,
    resumedThreadById,
    ledgerByThreadId,
    turnSummaryByThreadId,
    turnActivityByThreadId,
    turnErrorByThreadId,
    eventUnreadByThreadId,
    pendingServerRequestsByThreadId,
    globalServerRequestScope: GLOBAL_SERVER_REQUEST_SCOPE,
    threadTitleById,
    hasLoadedThreads,
    isLoadingThreads,
    isThreadInProgress,
    setSelectedThreadId,
    saveProjectOrder,
    saveReadStateMap,
    saveThreadScrollStateMap,
    hydrateWorkspaceRootsStateIfNeeded,
    getThreadGroups,
    loadThreadTitleCacheIfNeeded,
  })
  applyThreadFlags = threadListState.applyThreadFlags
  const { insertOptimisticThread, loadThreads, pruneThreadScopedState } = threadListState
  const eventSyncTimerRef = {
    get value() {
      return eventSyncTimer
    },
    set value(nextValue: number | null) {
      eventSyncTimer = nextValue
    },
  }
  const pendingThreadsRefreshRef = {
    get value() {
      return pendingThreadsRefresh
    },
    set value(nextValue: boolean) {
      pendingThreadsRefresh = nextValue
    },
  }
  const pendingThreadMessageRefreshRef = {
    get value() {
      return pendingThreadMessageRefresh
    },
  }
  const {
    loadMessages,
    refreshSkills,
    refreshAll,
    selectThread,
    syncThreadStatus,
    syncFromNotifications,
  } = createThreadSync({
    sourceGroups,
    selectedThreadId,
    error,
    isLoadingMessages,
    loadedMessagesByThreadId,
    resumedThreadById,
    loadedVersionByThreadId,
    installedSkills,
    isPolling,
    pendingThreadsRefreshRef,
    pendingThreadMessageRefreshRef,
    eventSyncTimerRef,
    eventSyncDebounceMs: EVENT_SYNC_DEBOUNCE_MS,
    isThreadInProgress,
    currentThreadVersion,
    markThreadAsRead,
    setConfirmedTranscriptForThread: (threadId, messages, options) => {
      setConfirmedTranscriptForThread(threadId, messages, {
        inProgress: options?.inProgress ?? false,
        preserveMissing: options?.preserveMissing,
      })
    },
    clearLiveLedger,
    setFinalizedTurnSnapshotForThread: (threadId, snapshot) => {
      setFinalizedTurnSnapshotForThread(threadId, snapshot as FinalizedTurnSnapshotState | null)
    },
    loadThreads,
    refreshModelPreferences,
    setSelectedThreadId,
  })

  function applyRealtimeUpdates(notification: RpcNotification): void {
    if (handleServerRequestNotification(notification)) {
      return
    }

    const threadNameUpdate = readNotificationThreadName(notification)
    if (threadNameUpdate) {
      threadTitleById.value = { ...threadTitleById.value, [threadNameUpdate.threadId]: threadNameUpdate.threadName }
      applyThreadFlags()
      void persistThreadTitle(threadNameUpdate.threadId, threadNameUpdate.threadName)
    }

    const turnActivity = readTurnActivity(notification)
    if (turnActivity) {
      setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    }

    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      updateLedgerThreadState(startedTurn.threadId, (current) => ({
        ...current,
        phase: 'live',
        activeTurnId: startedTurn.turnId,
        finalizedSnapshot: null,
        liveEventLog: [],
        activeSegment: null,
      }))
      setFinalizedTurnSnapshotForThread(startedTurn.threadId, null, { forceClear: true })
      setTurnSummaryForThread(startedTurn.threadId, null)
      setTurnErrorForThread(startedTurn.threadId, null)
      if (eventUnreadByThreadId.value[startedTurn.threadId]) {
        eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, startedTurn.threadId)
      }
    }

    const completedTurn = readTurnCompletedInfo(notification)
    const turnErrorMessage = readTurnErrorMessage(notification)
    const completedThreadId = completedTurn?.threadId ?? extractThreadIdFromNotification(notification)
    const shouldRetryWithFallback =
      Boolean(completedThreadId) &&
      Boolean(turnErrorMessage) &&
      selectedModelId.value !== MODEL_FALLBACK_ID &&
      isUnsupportedChatGptModelError(new Error(turnErrorMessage))
    if (completedTurn) {
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) {
        pendingTurnStartsById.delete(completedTurn.turnId)
      }

      const rawDurationMs =
        readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number'
          ? completedTurn.completedAtMs - completedTurn.startedAtMs
          : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)

      const durationMs = typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0
      setTurnSummaryForThread(completedTurn.threadId, {
        turnId: completedTurn.turnId,
        durationMs,
      })
      setTurnActivityForThread(completedTurn.threadId, null)
      markThreadUnreadByEvent(completedTurn.threadId)
      if (!shouldRetryWithFallback) {
        clearPendingTurnRequest(completedTurn.threadId)
        void processQueuedMessages(completedTurn.threadId)
      }
    }

    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        updateLedgerThreadState(failedThreadId, (current) => ({
          ...current,
          phase: 'failed',
        }))
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
      }
      error.value = turnErrorMessage
      if (failedThreadId && shouldRetryWithFallback) {
        void retryPendingTurnWithFallback(failedThreadId)
      }
    } else if (completedTurn) {
      updateLedgerThreadState(completedTurn.threadId, (current) => ({
        ...current,
        phase: current.finalizedSnapshot ? 'finalizing' : 'settled',
      }))
      setTurnErrorForThread(completedTurn.threadId, null)
    }

    const notificationErrorMessage = readNotificationErrorMessage(notification)
    if (notificationErrorMessage) {
      const errorThreadId = extractThreadIdFromNotification(notification)
      if (errorThreadId) {
        setTurnErrorForThread(errorThreadId, notificationErrorMessage)
      }
      error.value = notificationErrorMessage
      if (selectedModelId.value !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(new Error(notificationErrorMessage))) {
        if (errorThreadId) {
          void retryPendingTurnWithFallback(errorThreadId)
        } else {
          void applyFallbackModelSelection()
        }
      }
    }

    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (!notificationThreadId || notificationThreadId !== selectedThreadId.value) return

    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) {
      clearActiveLiveTextSegment(notificationThreadId)
    }

    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) {
      appendLiveTextSegment(
        notificationThreadId,
        'assistant',
        liveAgentMessageDelta.messageId,
        liveAgentMessageDelta.delta,
      )
    }

    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      if (!hasLiveTextSegmentsForItem(notificationThreadId, 'assistant', completedAgentMessage.itemId)) {
        appendLiveTextSegment(
          notificationThreadId,
          'assistant',
          completedAgentMessage.itemId,
          completedAgentMessage.text,
        )
      }
      clearActiveLiveTextSegment(notificationThreadId)
    }

    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      activeReasoningItemId = startedReasoningItemId
      clearActiveLiveTextSegment(notificationThreadId)
    }

    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) {
      appendLiveTextSegment(
        notificationThreadId,
        'reasoning',
        liveReasoningDelta.itemId,
        liveReasoningDelta.delta,
      )
    }

    const sectionBreakItemId = readReasoningSectionBreakItemId(notification)
    if (sectionBreakItemId) {
      const activeSegment = getLedgerThreadState(notificationThreadId).activeSegment
      if (activeSegment?.kind === 'reasoning' && activeSegment.itemId === sectionBreakItemId) {
        appendLiveTextSegment(notificationThreadId, 'reasoning', sectionBreakItemId, '\n\n')
      }
    }

    const completedReasoningItemId = readReasoningCompletedItemId(notification)
    if (completedReasoningItemId) {
      if (completedReasoningItemId === activeReasoningItemId) {
        activeReasoningItemId = ''
      }
      clearActiveLiveTextSegment(notificationThreadId)
    }

    const commandStarted = readCommandExecutionStarted(notification)
    if (commandStarted) {
      clearActiveLiveTextSegment(notificationThreadId)
      appendLiveEvent(notificationThreadId, { type: 'command_snapshot', message: commandStarted })
      setTurnActivityForThread(notificationThreadId, { label: 'Running command', details: [commandStarted.commandExecution?.command ?? ''] })
    }

    const toolStarted = readToolCallStarted(notification)
    if (toolStarted) {
      clearActiveLiveTextSegment(notificationThreadId)
      appendLiveEvent(notificationThreadId, { type: 'tool_snapshot', message: toolStarted })
      setTurnActivityForThread(notificationThreadId, { label: 'Calling', details: [] })
    }

    const commandDelta = readCommandOutputDelta(notification)
    if (commandDelta) {
      appendLiveEvent(notificationThreadId, { type: 'command_output_delta', itemId: commandDelta.itemId, delta: commandDelta.delta })
    }

    const commandCompleted = readCommandExecutionCompleted(notification)
    if (commandCompleted) {
      clearActiveLiveTextSegment(notificationThreadId)
      appendLiveEvent(notificationThreadId, { type: 'command_snapshot', message: commandCompleted })
    }

    const toolCompleted = readToolCallCompleted(notification)
    if (toolCompleted) {
      clearActiveLiveTextSegment(notificationThreadId)
      appendLiveEvent(notificationThreadId, { type: 'tool_snapshot', message: toolCompleted })
    }

    if (isAgentContentEvent(notification)) {
      if (shouldAutoScrollOnNextAgentEvent && selectedThreadId.value) {
        setThreadScrollState(selectedThreadId.value, {
          scrollTop: 0,
          isAtBottom: true,
          scrollRatio: 1,
        })
      }
    }

    if (notification.method === 'turn/completed') {
      activeReasoningItemId = ''
      shouldAutoScrollOnNextAgentEvent = false
      clearActiveLiveTextSegment(notificationThreadId)
      const completedTurnId =
        completedTurn?.turnId ||
        readString(asRecord(asRecord(notification.params)?.turn)?.id) ||
        getLedgerThreadState(notificationThreadId).activeTurnId ||
        `${notificationThreadId}:unknown`
      setFinalizedTurnSnapshotForThread(
        notificationThreadId,
        buildFinalizedTurnSnapshot(notificationThreadId, completedTurnId),
      )
      clearLiveLedger(notificationThreadId)
      updateLedgerThreadState(notificationThreadId, (current) => ({
        ...current,
        phase: 'finalizing',
        activeTurnId: '',
      }))
      const completedThreadId = extractThreadIdFromNotification(notification)
      if (completedThreadId) {
        setTurnActivityForThread(completedThreadId, null)
        markThreadUnreadByEvent(completedThreadId)
        if (!shouldRetryWithFallback) {
          clearPendingTurnRequest(completedThreadId)
          void processQueuedMessages(completedThreadId)
        }
      }
    }

  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    const threadId = extractThreadIdFromNotification(notification)
    const method = notification.method
    const shouldRefreshThreadMessages =
      method === 'turn/completed'

    const shouldRefreshThreads =
      method === 'thread/started'
      || method === 'thread/archived'
      || method === 'thread/unarchived'
      || method === 'thread/closed'
      || method === 'thread/name/updated'

    if (threadId && shouldRefreshThreadMessages) {
      pendingThreadMessageRefresh.add(threadId)
    }

    if (shouldRefreshThreads) {
      pendingThreadsRefresh = true
    }

    if (!shouldRefreshThreadMessages && !shouldRefreshThreads) return

    if (eventSyncTimer !== null || typeof window === 'undefined') return
    eventSyncTimer = window.setTimeout(() => {
      eventSyncTimer = null
      void syncFromNotifications()
    }, EVENT_SYNC_DEBOUNCE_MS)
  }

  async function hydrateWorkspaceRootsStateIfNeeded(groups: UiProjectGroup[]): Promise<void> {
    if (IS_WASM_RUNTIME) return
    if (hasHydratedWorkspaceRootsState) return
    hasHydratedWorkspaceRootsState = true

    try {
      const rootsState = await getWorkspaceRootsState()
      const hydratedOrder: string[] = []
      for (const rootPath of rootsState.order) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (hydratedOrder.includes(projectName)) continue
        hydratedOrder.push(projectName)
      }

      if (hydratedOrder.length > 0) {
        const mergedOrder = mergeProjectOrder(hydratedOrder, groups)
        if (!areStringArraysEqual(projectOrder.value, mergedOrder)) {
          projectOrder.value = mergedOrder
          saveProjectOrder(projectOrder.value)
        }
      }

      if (Object.keys(rootsState.labels).length > 0) {
        const nextLabels = { ...projectDisplayNameById.value }
        let changed = false
        for (const [rootPath, label] of Object.entries(rootsState.labels)) {
          const projectName = toProjectNameFromWorkspaceRoot(rootPath)
          if (nextLabels[projectName] === label) continue
          nextLabels[projectName] = label
          changed = true
        }
        if (changed) {
          projectDisplayNameById.value = nextLabels
          saveProjectDisplayNames(nextLabels)
        }
      }
    } catch {
      // Keep local storage fallback when global state is unavailable.
    }
  }

  async function loadThreadTitleCacheIfNeeded(): Promise<void> {
    if (Object.keys(threadTitleById.value).length > 0) return
    try {
      const cache = await getThreadTitleCache()
      if (Object.keys(cache.titles).length > 0) {
        threadTitleById.value = cache.titles
      }
    } catch {
      // Title cache is optional; keep UI functional.
    }
  }

  async function requestThreadTitleGeneration(threadId: string, prompt: string, cwd: string | null): Promise<void> {
    if (threadTitleById.value[threadId]) return
    const trimmed = prompt.trim()
    if (!trimmed) return
    const truncated = trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed
    try {
      const title = await generateThreadTitle(truncated, cwd)
      if (!title || threadTitleById.value[threadId]) return
      threadTitleById.value = { ...threadTitleById.value, [threadId]: title }
      applyThreadFlags()
      void persistThreadTitle(threadId, title)
    } catch {
      // Title generation is best-effort.
    }
  }

  async function archiveThreadById(threadId: string) {
    try {
      await archiveThread(threadId)
      await loadThreads()

      if (selectedThreadId.value === threadId) {
        await loadMessages(selectedThreadId.value)
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function renameThreadById(threadId: string, threadName: string) {
    const normalizedName = threadName.trim()
    if (!threadId || !normalizedName) return

    try {
      await renameThread(threadId, normalizedName)
      threadTitleById.value = { ...threadTitleById.value, [threadId]: normalizedName }
      applyThreadFlags()
      void persistThreadTitle(threadId, normalizedName)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function sendMessageToSelectedThread(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    mode: 'steer' | 'queue' = 'steer',
    fileAttachments: FileAttachment[] = [],
  ): Promise<void> {
    const threadId = selectedThreadId.value
    const nextText = text.trim()
    if (!threadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)) return

    const isInProgress = isThreadInProgress(threadId)

    if (isInProgress && mode === 'queue') {
      const queue = queuedMessagesByThreadId.value[threadId] ?? []
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      queuedMessagesByThreadId.value = {
        ...queuedMessagesByThreadId.value,
        [threadId]: [...queue, { id, text: nextText, imageUrls, skills, fileAttachments }],
      }
      return
    }

    if (isInProgress) {
      shouldAutoScrollOnNextAgentEvent = true
      void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments).catch((unknownError) => {
        const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        setTurnErrorForThread(threadId, errorMessage)
        error.value = errorMessage
      })
      return
    }

    error.value = ''
    shouldAutoScrollOnNextAgentEvent = true
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(
      threadId,
      { label: 'Thinking', details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value) },
    )
    setTurnErrorForThread(threadId, null)
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      phase: 'live',
      finalizedSnapshot: null,
    }))

    try {
      await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments)
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: current.phase === 'failed' ? 'failed' : 'settled',
        activeTurnId: '',
      }))
      setTurnActivityForThread(threadId, null)
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      throw unknownError
    }
  }

  async function sendMessageToNewThread(
    text: string,
    cwd: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<string> {
    const nextText = text.trim()
    const targetCwd = cwd.trim()
    const selectedModel = selectedModelId.value.trim()
    if (!nextText && imageUrls.length === 0 && fileAttachments.length === 0) return ''

    isSendingMessage.value = true
    error.value = ''
    let threadId = ''

    try {
      try {
        threadId = await startThread(targetCwd || undefined, selectedModel || undefined)
      } catch (unknownError) {
        if (selectedModel && selectedModel !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          threadId = await startThread(targetCwd || undefined, MODEL_FALLBACK_ID)
        } else {
          throw unknownError
        }
      }
      if (!threadId) return ''

      insertOptimisticThread(threadId, targetCwd, nextText || '[Image]')
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      setSelectedThreadId(threadId)
      shouldAutoScrollOnNextAgentEvent = true
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(
        threadId,
        { label: 'Thinking', details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value) },
      )
      setTurnErrorForThread(threadId, null)
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: 'live',
        finalizedSnapshot: null,
      }))
      const capturedThreadId = threadId
      const capturedCwd = targetCwd || null
      const capturedPrompt = nextText
      void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments)
        .catch((unknownError) => {
          shouldAutoScrollOnNextAgentEvent = false
          updateLedgerThreadState(threadId, (current) => ({
            ...current,
            phase: current.phase === 'failed' ? 'failed' : 'settled',
            activeTurnId: '',
          }))
          setTurnActivityForThread(threadId, null)
          const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
          setTurnErrorForThread(threadId, errorMessage)
          error.value = errorMessage
        })
        .finally(() => {
          isSendingMessage.value = false
        })
      void requestThreadTitleGeneration(capturedThreadId, capturedPrompt, capturedCwd)
      return threadId
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      if (threadId) {
        updateLedgerThreadState(threadId, (current) => ({
          ...current,
          phase: current.phase === 'failed' ? 'failed' : 'settled',
          activeTurnId: '',
        }))
        setTurnActivityForThread(threadId, null)
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (threadId) {
        setTurnErrorForThread(threadId, errorMessage)
      }
      error.value = errorMessage
      isSendingMessage.value = false
      throw unknownError
    }
  }

  async function startTurnForThread(
    threadId: string,
    nextText: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<void> {
    const modelId = selectedModelId.value.trim()
    const reasoningEffort = selectedReasoningEffort.value
    const normalizedText = nextText.trim()
    const normalizedSkills = skills.map((skill) => ({ name: skill.name, path: skill.path }))
    const normalizedFileAttachments = fileAttachments.map((file) => ({ ...file }))

    setPendingTurnRequest(threadId, {
      text: normalizedText,
      imageUrls: [...imageUrls],
      skills: normalizedSkills,
      fileAttachments: normalizedFileAttachments,
      effort: reasoningEffort,
      fallbackRetried: false,
    })

    try {
      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
      }

      try {
        await startThreadTurnRaw(
          threadId,
          buildProtocolTurnInput(
            nextText,
            imageUrls,
            skills,
            fileAttachments,
          ),
          {
            model: modelId || undefined,
            effort: reasoningEffort || undefined,
            attachments: fileAttachments,
          },
        )
      } catch (unknownError) {
        if (modelId && modelId !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          setPendingTurnRequest(threadId, {
            text: normalizedText,
            imageUrls: [...imageUrls],
            skills: normalizedSkills,
            fileAttachments: normalizedFileAttachments,
            effort: reasoningEffort,
            fallbackRetried: true,
          })
          await startThreadTurnRaw(
            threadId,
            buildProtocolTurnInput(
              nextText,
              imageUrls,
              skills,
              fileAttachments,
            ),
            {
              model: MODEL_FALLBACK_ID,
              effort: reasoningEffort || undefined,
              attachments: fileAttachments,
            },
          )
        } else {
          throw unknownError
        }
      }

      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }

      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      throw unknownError
    }
  }

  async function processQueuedMessages(threadId: string): Promise<void> {
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue || queue.length === 0) return
    const [next, ...rest] = queue
    queuedMessagesByThreadId.value = rest.length > 0
      ? { ...queuedMessagesByThreadId.value, [threadId]: rest }
      : omitKey(queuedMessagesByThreadId.value, threadId)
    isSendingMessage.value = true
    error.value = ''
    shouldAutoScrollOnNextAgentEvent = true
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(threadId, { label: 'Thinking', details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value) })
    setTurnErrorForThread(threadId, null)
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      phase: 'live',
      finalizedSnapshot: null,
    }))
    try {
      await startTurnForThread(threadId, next.text, next.imageUrls, next.skills, next.fileAttachments)
    } catch {
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: current.phase === 'failed' ? 'failed' : 'settled',
        activeTurnId: '',
      }))
      setTurnActivityForThread(threadId, null)
    } finally {
      isSendingMessage.value = false
    }
  }

  async function interruptSelectedThreadTurn(): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (!isThreadInProgress(threadId)) return
    const turnId = getLedgerThreadState(threadId).activeTurnId

    isInterruptingTurn.value = true
    error.value = ''
    try {
      if (!turnId) {
        throw new Error('turn/interrupt requires turnId')
      }
      await interruptThreadTurnRaw(threadId, turnId)
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: current.phase === 'failed' ? 'failed' : 'settled',
        activeTurnId: '',
      }))
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
    } finally {
      isInterruptingTurn.value = false
    }
  }

  async function rollbackSelectedThread(turnIndex: number): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (isRollingBack.value) return

    const persisted = getLedgerThreadState(threadId).confirmedTranscript
    const maxTurnIndex = persisted.reduce((max, m) => (typeof m.turnIndex === 'number' && m.turnIndex > max ? m.turnIndex : max), -1)
    if (maxTurnIndex < 0 || turnIndex > maxTurnIndex) return
    const numTurns = maxTurnIndex - turnIndex + 1
    if (numTurns < 1) return

    isRollingBack.value = true
    error.value = ''
    try {
      const payload = await rollbackThreadRaw(threadId, numTurns)
      const nextMessages = normalizeThreadMessagesV2({ thread: payload.thread })
      setConfirmedTranscriptForThread(threadId, nextMessages, { inProgress: false })
      clearLiveLedger(threadId)
      clearActiveLiveTextSegment(threadId)
      setFinalizedTurnSnapshotForThread(threadId, null, { forceClear: true })
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to rollback thread'
    } finally {
      isRollingBack.value = false
    }
  }

  function renameProject(projectName: string, displayName: string): void {
    if (projectName.length === 0) return

    const currentValue = projectDisplayNameById.value[projectName] ?? ''
    if (currentValue === displayName) return

    projectDisplayNameById.value = {
      ...projectDisplayNameById.value,
      [projectName]: displayName,
    }
    saveProjectDisplayNames(projectDisplayNameById.value)
  }

  function removeProject(projectName: string): void {
    if (projectName.length === 0) return

    const nextProjectOrder = projectOrder.value.filter((name) => name !== projectName)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }

    sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)

    if (projectDisplayNameById.value[projectName] !== undefined) {
      const nextDisplayNames = { ...projectDisplayNameById.value }
      delete nextDisplayNames[projectName]
      projectDisplayNameById.value = nextDisplayNames
      saveProjectDisplayNames(nextDisplayNames)
    }

    applyThreadFlags()

    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)

    const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)
    if (!currentExists) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }

    void persistProjectOrderToWorkspaceRoots()
  }

  function reorderProject(projectName: string, toIndex: number): void {
    if (projectName.length === 0) return
    if (sourceGroups.value.length === 0) return

    const visibleOrder = sourceGroups.value.map((group) => group.projectName)
    const fromIndex = visibleOrder.indexOf(projectName)
    if (fromIndex === -1) return

    const clampedToIndex = Math.max(0, Math.min(toIndex, visibleOrder.length - 1))
    const reorderedVisibleOrder = reorderStringArray(visibleOrder, fromIndex, clampedToIndex)
    if (reorderedVisibleOrder === visibleOrder) return

    const normalizedProjectOrder = mergeProjectOrder(reorderedVisibleOrder, sourceGroups.value)
    projectOrder.value = normalizedProjectOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  function pinProjectToTop(projectName: string): void {
    const normalizedName = projectName.trim()
    if (!normalizedName) return
    const nextOrder = [normalizedName, ...projectOrder.value.filter((name) => name !== normalizedName)]
    if (areStringArraysEqual(projectOrder.value, nextOrder)) return
    projectOrder.value = nextOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  async function persistProjectOrderToWorkspaceRoots(): Promise<void> {
    if (IS_WASM_RUNTIME) return
    try {
      const rootsState = await getWorkspaceRootsState()
      const rootByProjectName = new Map<string, string>()
      for (const rootPath of rootsState.order) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (!rootByProjectName.has(projectName)) {
          rootByProjectName.set(projectName, rootPath)
        }
      }
      for (const group of sourceGroups.value) {
        const cwd = group.threads[0]?.cwd?.trim() ?? ''
        if (!cwd) continue
        rootByProjectName.set(group.projectName, cwd)
      }

      const nextOrder: string[] = []
      for (const projectName of projectOrder.value) {
        const rootPath = rootByProjectName.get(projectName)
        if (rootPath && !nextOrder.includes(rootPath)) {
          nextOrder.push(rootPath)
        }
      }
      for (const rootPath of rootsState.order) {
        if (!nextOrder.includes(rootPath)) {
          nextOrder.push(rootPath)
        }
      }

      const nextActive = rootsState.active.filter((rootPath) => nextOrder.includes(rootPath))
      if (nextActive.length === 0 && nextOrder.length > 0) {
        nextActive.push(nextOrder[0])
      }

      await setWorkspaceRootsState({
        order: nextOrder,
        labels: rootsState.labels,
        active: nextActive,
      })
    } catch {
      // Keep local project order when global state persistence is unavailable.
    }
  }

  function startPolling(): void {
    if (typeof window === 'undefined') return

    if (stopNotificationStream) return
    if (isAutoRefreshEnabled.value) {
      startAutoRefreshTimer()
    }
    void loadPendingServerRequestsFromBridge()
    stopNotificationStream = subscribeCodexNotifications((notification) => {
      applyRealtimeUpdates(notification)
      queueEventDrivenSync(notification)
    })
  }

  async function loadPendingServerRequestsFromBridge(): Promise<void> {
    try {
      const rows = await getPendingServerRequests()
      for (const row of rows) {
        const request = normalizeServerRequest(row, GLOBAL_SERVER_REQUEST_SCOPE)
        if (request) {
          upsertPendingServerRequest(request)
        }
      }
    } catch {
      // Keep UI usable when pending request endpoint is temporarily unavailable.
    }
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<void> {
    try {
      await replyToServerRequest(reply.id, {
        result: reply.result,
        error: reply.error,
      })
      removePendingServerRequestById(reply.id)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request'
    }
  }

  function stopAutoRefreshTimer(options: { updatePreference?: boolean } = {}): void {
    const updatePreference = options.updatePreference ?? true

    if (autoRefreshIntervalTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(autoRefreshIntervalTimer)
      autoRefreshIntervalTimer = null
    }
    if (autoRefreshCountdownTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(autoRefreshCountdownTimer)
      autoRefreshCountdownTimer = null
    }
    if (updatePreference) {
      isAutoRefreshEnabled.value = false
      saveAutoRefreshEnabled(false)
    }
    autoRefreshSecondsLeft.value = Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000)
  }

  function startAutoRefreshTimer(): void {
    if (typeof window === 'undefined') return
    if (autoRefreshIntervalTimer !== null || autoRefreshCountdownTimer !== null) return

    isAutoRefreshEnabled.value = true
    saveAutoRefreshEnabled(true)
    autoRefreshSecondsLeft.value = Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000)

    autoRefreshIntervalTimer = window.setInterval(() => {
      autoRefreshSecondsLeft.value = Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000)
      void syncThreadStatus()
    }, AUTO_REFRESH_INTERVAL_MS)

    autoRefreshCountdownTimer = window.setInterval(() => {
      autoRefreshSecondsLeft.value = Math.max(0, autoRefreshSecondsLeft.value - 1)
    }, 1000)
  }

  function toggleAutoRefreshTimer(): void {
    if (isAutoRefreshEnabled.value) {
      stopAutoRefreshTimer()
      return
    }
    startAutoRefreshTimer()
  }

  function stopPolling(): void {
    stopAutoRefreshTimer({ updatePreference: false })

    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }

    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()
    pendingTurnStartsById.clear()
    if (eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
    ledgerByThreadId.value = {}
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    queuedMessagesByThreadId.value = {}
  }

  const selectedThreadQueuedMessages = computed<QueuedMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []
    return queuedMessagesByThreadId.value[threadId] ?? []
  })

  function removeQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const next = queue.filter((m) => m.id !== messageId)
    queuedMessagesByThreadId.value = next.length > 0
      ? { ...queuedMessagesByThreadId.value, [threadId]: next }
      : omitKey(queuedMessagesByThreadId.value, threadId)
  }

  function steerQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const msg = queue.find((m) => m.id === messageId)
    if (!msg) return
    removeQueuedMessage(messageId)
    void sendMessageToSelectedThread(msg.text, msg.imageUrls, msg.skills, 'steer', msg.fileAttachments)
  }

  return {
    projectGroups,
    projectDisplayNameById,
    selectedThread,
    selectedThreadScrollState,
    selectedThreadServerRequests,
    selectedLiveOverlay,
    selectedThreadId,
    availableModelIds,
    selectedModelId,
    selectedReasoningEffort,
    installedSkills,
    messages,
    isLoadingThreads,
    isLoadingMessages,
    isSendingMessage,
    isInterruptingTurn,
    isAutoRefreshEnabled,
    autoRefreshSecondsLeft,
    error,
    refreshAll,
    refreshSkills,
    selectThread,
    setThreadScrollState,
    archiveThreadById,
    renameThreadById,
    sendMessageToSelectedThread,
    sendMessageToNewThread,
    interruptSelectedThreadTurn,
    rollbackSelectedThread,
    isRollingBack,
    selectedThreadQueuedMessages,
    removeQueuedMessage,
    steerQueuedMessage,
    setSelectedModelId,
    setSelectedReasoningEffort,
    respondToPendingServerRequest,
    renameProject,
    removeProject,
    reorderProject,
    pinProjectToTop,
    toggleAutoRefreshTimer,
    startPolling,
    stopPolling,
  }
}
