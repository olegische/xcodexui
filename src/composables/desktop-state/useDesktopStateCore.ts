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
  areToolCallsEqual as areToolCallsEqualHelper,
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
import { createProjectState } from './project-state'
import { createThreadListState } from './thread-list-state'
import { createThreadPolling } from './thread-polling'
import { createThreadPreferences } from './thread-preferences'
import { createThreadRealtime } from './thread-realtime'
import { createThreadRuntimeState } from './thread-runtime-state'
import { createThreadSync } from './thread-sync'
import { createThreadTurnActions } from './thread-turn-actions'
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
const areToolCallsEqual = areToolCallsEqualHelper

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
    areToolCallsEqual(first.toolCall, second.toolCall) &&
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
  const activeTurnIdByThreadId = ref<Record<string, string>>({})
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
    const persisted = ledger.finalizedSnapshot?.messages ?? ledger.confirmedTranscript
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

    const hasCurrentTurnArtifacts = liveMessages.length > 0 || Boolean(ledger.finalizedSnapshot)
    if (!hasCurrentTurnArtifacts && !isThreadInProgress(threadId)) {
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

  function setSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
    if (effort && !REASONING_EFFORT_OPTIONS.includes(effort)) {
      return
    }
    selectedReasoningEffort.value = effort
  }

  const {
    applyFallbackModelSelection,
    buildPendingTurnDetails,
    refreshModelPreferences,
    loadThreadTitleCacheIfNeeded,
    requestThreadTitleGeneration,
  } = createThreadPreferences({
    selectedModelId,
    selectedReasoningEffort,
    availableModelIds,
    threadTitleById,
    modelFallbackId: MODEL_FALLBACK_ID,
    reasoningEffortOptions: REASONING_EFFORT_OPTIONS,
    applyThreadFlags: () => applyThreadFlags(),
    getThreadTitleCache,
  })

  let applyThreadFlags = (): void => {}
  let hydrateWorkspaceRootsStateIfNeeded = async (_groups: UiProjectGroup[]): Promise<void> => {}
  let persistProjectOrderToWorkspaceRoots = async (): Promise<void> => {}
  let renameProject = (_projectName: string, _displayName: string): void => {}
  let removeProject = (_projectName: string): void => {}
  let reorderProject = (_projectName: string, _toIndex: number): void => {}
  let pinProjectToTop = (_projectName: string): void => {}

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
    hydrateWorkspaceRootsStateIfNeeded: (groups) => hydrateWorkspaceRootsStateIfNeeded(groups),
    getThreadGroups,
    loadThreadTitleCacheIfNeeded,
  })
  applyThreadFlags = threadListState.applyThreadFlags
  const { insertOptimisticThread, loadThreads, pruneThreadScopedState } = threadListState
  ;({
    hydrateWorkspaceRootsStateIfNeeded,
    renameProject,
    removeProject,
    reorderProject,
    pinProjectToTop,
    persistProjectOrderToWorkspaceRoots,
  } = createProjectState({
    sourceGroups,
    projectGroups,
    projectOrder,
    projectDisplayNameById,
    selectedThreadId,
    saveProjectOrder,
    saveProjectDisplayNames,
    applyThreadFlags: () => applyThreadFlags(),
    pruneThreadScopedState,
    setSelectedThreadId,
  }))
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
    getLedgerThreadState: (threadId) => getLedgerThreadState(threadId),
    currentThreadVersion,
    markThreadAsRead,
    pendingTurnRequestByThreadId,
    setConfirmedTranscriptForThread: (threadId, messages, options) => {
      setConfirmedTranscriptForThread(threadId, messages, {
        inProgress: options?.inProgress ?? false,
        preserveMissing: options?.preserveMissing,
      })
    },
    clearPendingTurnRequest,
    clearLiveLedger,
    setFinalizedTurnSnapshotForThread,
    loadThreads,
    refreshModelPreferences,
    setSelectedThreadId,
  })
  const shouldAutoScrollRef = {
    get value() {
      return shouldAutoScrollOnNextAgentEvent
    },
    set value(nextValue: boolean) {
      shouldAutoScrollOnNextAgentEvent = nextValue
    },
  }
  const {
    sendMessageToSelectedThread,
    sendMessageToNewThread,
    startTurnForThread,
    processQueuedMessages,
    interruptSelectedThreadTurn,
    rollbackSelectedThread,
  } = createThreadTurnActions({
    selectedThreadId,
    selectedModelId,
    selectedReasoningEffort,
    resumedThreadById,
    queuedMessagesByThreadId,
    isSendingMessage,
    isInterruptingTurn,
    isRollingBack,
    error,
    shouldAutoScrollRef,
    pendingThreadsRefreshRef,
    pendingThreadMessageRefreshRef,
    modelFallbackId: MODEL_FALLBACK_ID,
    isThreadInProgress,
    getActiveTurnId: (threadId) => activeTurnIdByThreadId.value[threadId] ?? '',
    setActiveTurnId: (threadId, turnId) => {
      activeTurnIdByThreadId.value = { ...activeTurnIdByThreadId.value, [threadId]: turnId }
    },
    clearActiveTurnId: (threadId) => {
      const next = { ...activeTurnIdByThreadId.value }
      delete next[threadId]
      activeTurnIdByThreadId.value = next
    },
    getLedgerThreadState,
    updateLedgerThreadState,
    clearLiveLedger,
    setFinalizedTurnSnapshotForThread,
    clearActiveLiveTextSegment,
    setConfirmedTranscriptForThread,
    setTurnSummaryForThread,
    setTurnActivityForThread,
    setTurnErrorForThread,
    setSelectedThreadId,
    insertOptimisticThread,
    loadMessages,
    loadThreads,
    syncFromNotifications,
    buildPendingTurnDetails,
    buildProtocolTurnInput,
    setPendingTurnRequest,
    isUnsupportedChatGptModelError,
    applyFallbackModelSelection,
    requestThreadTitleGeneration,
  })
  const activeReasoningItemIdRef = {
    get value() {
      return activeReasoningItemId
    },
    set value(nextValue: string) {
      activeReasoningItemId = nextValue
    },
  }
  const {
    retryPendingTurnWithFallback,
    applyRealtimeUpdates,
    queueEventDrivenSync,
  } = createThreadRealtime({
    selectedThreadId,
    selectedModelId,
    threadTitleById,
    resumedThreadById,
    pendingTurnRequestByThreadId,
    error,
    eventUnreadByThreadId,
    modelFallbackId: MODEL_FALLBACK_ID,
    pendingTurnStartsById,
    activeReasoningItemIdRef,
    shouldAutoScrollRef,
    pendingThreadsRefreshRef,
    pendingThreadMessageRefreshRef,
    eventSyncTimerRef,
    eventSyncDebounceMs: EVENT_SYNC_DEBOUNCE_MS,
    applyThreadFlags: () => applyThreadFlags(),
    setPendingTurnRequest,
    processQueuedMessages,
    syncFromNotifications,
    applyFallbackModelSelection,
    buildPendingTurnDetails,
    buildProtocolTurnInput,
    isUnsupportedChatGptModelError,
    handleServerRequestNotification,
    setTurnActivityForThread,
    setTurnSummaryForThread,
    setTurnErrorForThread,
    markThreadUnreadByEvent,
    setThreadScrollState,
    setActiveTurnId: (threadId, turnId) => {
      activeTurnIdByThreadId.value = { ...activeTurnIdByThreadId.value, [threadId]: turnId }
    },
    clearActiveTurnId: (threadId) => {
      const next = { ...activeTurnIdByThreadId.value }
      delete next[threadId]
      activeTurnIdByThreadId.value = next
    },
    getLedgerThreadState,
    updateLedgerThreadState,
    setConfirmedTranscriptForThread,
    setFinalizedTurnSnapshotForThread,
    buildFinalizedTurnSnapshot,
    clearActiveLiveTextSegment,
    appendLiveTextSegment,
    hasLiveTextSegmentsForItem,
    clearLiveLedger,
    appendLiveEvent,
    asRecord,
  })

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
  const stopNotificationStreamRef = {
    get value() {
      return stopNotificationStream
    },
    set value(nextValue: (() => void) | null) {
      stopNotificationStream = nextValue
    },
  }
  const {
    respondToPendingServerRequest,
    toggleAutoRefreshTimer,
    startPolling,
    stopPolling,
  } = createThreadPolling({
    isAutoRefreshEnabled,
    autoRefreshSecondsLeft,
    ledgerByThreadId,
    turnActivityByThreadId,
    turnSummaryByThreadId,
    turnErrorByThreadId,
    queuedMessagesByThreadId,
    error,
    globalServerRequestScope: GLOBAL_SERVER_REQUEST_SCOPE,
    autoRefreshIntervalMs: AUTO_REFRESH_INTERVAL_MS,
    saveAutoRefreshEnabled,
    upsertPendingServerRequest,
    removePendingServerRequestById,
    applyRealtimeUpdates,
    queueEventDrivenSync,
    syncThreadStatus,
    pendingThreadsRefreshRef,
    pendingThreadMessageRefreshRef,
    pendingTurnStartsById,
    eventSyncTimerRef,
    stopNotificationStreamRef,
    activeReasoningItemIdRef,
    shouldAutoScrollRef,
  })

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
