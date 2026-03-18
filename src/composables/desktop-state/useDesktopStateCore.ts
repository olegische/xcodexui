import { computed, ref } from 'vue'
import {
  archiveThread,
  renameThread,
  getAvailableModelIds,
  getCurrentModelConfig,
  getPendingServerRequests,
  getSkillsList,
  interruptThreadTurnRaw,
  readThreadRaw,
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
import { normalizeThreadMessagesV2, readThreadInProgressFromResponse } from '../../api/normalizers/v2'
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
  areFileAttachmentsEqual as areFileAttachmentsEqualHelper,
  areTurnActivitiesEqual as areTurnActivitiesEqualHelper,
  areTurnSummariesEqual as areTurnSummariesEqualHelper,
  buildTextWithAttachments as buildTextWithAttachmentsHelper,
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
  mergeIncomingWithLocalInProgressThreads as mergeIncomingWithLocalInProgressThreadsHelper,
  mergeProjectOrder as mergeProjectOrderHelper,
  mergeThreadGroups as mergeThreadGroupsHelper,
  orderGroupsByProjectOrder as orderGroupsByProjectOrderHelper,
  pruneThreadStateMap as pruneThreadStateMapHelper,
  reorderStringArray as reorderStringArrayHelper,
  toOptimisticThreadTitle as toOptimisticThreadTitleHelper,
  toProjectName as toProjectNameHelper,
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

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

const READ_STATE_STORAGE_KEY = 'codex-web-local.thread-read-state.v1'
const SCROLL_STATE_STORAGE_KEY = 'codex-web-local.thread-scroll-state.v1'
const SELECTED_THREAD_STORAGE_KEY = 'codex-web-local.selected-thread-id.v1'
const PROJECT_ORDER_STORAGE_KEY = 'codex-web-local.project-order.v1'
const PROJECT_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.project-display-name.v1'
const AUTO_REFRESH_ENABLED_STORAGE_KEY = 'codex-web-local.auto-refresh-enabled.v1'
const EVENT_SYNC_DEBOUNCE_MS = 220
const AUTO_REFRESH_INTERVAL_MS = 4000
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const MODEL_FALLBACK_ID = 'gpt-5.2-codex'

function loadReadStateMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(READ_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function saveReadStateMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadAutoRefreshEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(AUTO_REFRESH_ENABLED_STORAGE_KEY) === '1'
}

function saveAutoRefreshEnabled(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTO_REFRESH_ENABLED_STORAGE_KEY, value ? '1' : '0')
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

function normalizeThreadScrollState(value: unknown): ThreadScrollState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const rawState = value as Record<string, unknown>
  if (typeof rawState.scrollTop !== 'number' || !Number.isFinite(rawState.scrollTop)) return null
  if (typeof rawState.isAtBottom !== 'boolean') return null

  const normalized: ThreadScrollState = {
    scrollTop: Math.max(0, rawState.scrollTop),
    isAtBottom: rawState.isAtBottom,
  }

  if (typeof rawState.scrollRatio === 'number' && Number.isFinite(rawState.scrollRatio)) {
    normalized.scrollRatio = clamp(rawState.scrollRatio, 0, 1)
  }

  return normalized
}

function loadThreadScrollStateMap(): Record<string, ThreadScrollState> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(SCROLL_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, ThreadScrollState> = {}
    for (const [threadId, state] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId) continue
      const normalizedState = normalizeThreadScrollState(state)
      if (normalizedState) {
        normalizedMap[threadId] = normalizedState
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadScrollStateMap(state: Record<string, ThreadScrollState>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SCROLL_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadSelectedThreadId(): string {
  if (typeof window === 'undefined') return ''
  const raw = window.localStorage.getItem(SELECTED_THREAD_STORAGE_KEY)
  return raw ?? ''
}

function saveSelectedThreadId(threadId: string): void {
  if (typeof window === 'undefined') return
  if (!threadId) {
    window.localStorage.removeItem(SELECTED_THREAD_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_THREAD_STORAGE_KEY, threadId)
}

function loadProjectOrder(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const order: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && item.length > 0 && !order.includes(item)) {
        order.push(item)
      }
    }
    return order
  } catch {
    return []
  }
}

function saveProjectOrder(order: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order))
}

function loadProjectDisplayNames(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(PROJECT_DISPLAY_NAME_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const displayNames: Record<string, string> = {}
    for (const [projectName, displayName] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof projectName === 'string' && projectName.length > 0 && typeof displayName === 'string') {
        displayNames[projectName] = displayName
      }
    }
    return displayNames
  } catch {
    return {}
  }
}

function saveProjectDisplayNames(displayNames: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(displayNames))
}

function mergeProjectOrder(previousOrder: string[], incomingGroups: UiProjectGroup[]): string[] {
  const nextOrder: string[] = []

  for (const projectName of previousOrder) {
    if (!nextOrder.includes(projectName)) {
      nextOrder.push(projectName)
    }
  }

  for (const group of incomingGroups) {
    if (!nextOrder.includes(group.projectName)) {
      nextOrder.push(group.projectName)
    }
  }

  return areStringArraysEqual(previousOrder, nextOrder) ? previousOrder : nextOrder
}

function orderGroupsByProjectOrder(incoming: UiProjectGroup[], projectOrder: string[]): UiProjectGroup[] {
  const incomingByName = new Map(incoming.map((group) => [group.projectName, group]))
  const ordered: UiProjectGroup[] = projectOrder
    .map((projectName) => incomingByName.get(projectName) ?? { projectName, threads: [] })

  for (const group of incoming) {
    if (!projectOrder.includes(group.projectName)) {
      ordered.push(group)
    }
  }

  return ordered
}

function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function reorderStringArray(items: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }

  if (fromIndex === toIndex) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.status === second.status && first.aggregatedOutput === second.aggregatedOutput && first.exitCode === second.exitCode
}

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

type TurnSummaryState = {
  turnId: string
  durationMs: number
}

type TurnActivityState = {
  label: string
  details: string[]
}

type TurnErrorState = {
  message: string
}

type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type TurnCompletedInfo = {
  threadId: string
  turnId: string
  completedAtMs: number
  startedAtMs?: number
}

type LiveTextSegmentState = {
  kind: 'assistant' | 'reasoning'
  itemId: string
  segmentId: string
}

type FinalizedTurnSnapshotState = {
  turnId: string
  messages: UiMessage[]
}

type ChatPhase = 'idle' | 'live' | 'finalizing' | 'settled' | 'failed'

type LiveTurnEvent =
  | {
    type: 'text_delta'
    kind: LiveTextSegmentState['kind']
    itemId: string
    segmentId: string
    delta: string
  }
  | {
    type: 'command_snapshot'
    message: UiMessage
  }
  | {
    type: 'command_output_delta'
    itemId: string
    delta: string
  }
  | {
    type: 'tool_snapshot'
    message: UiMessage
  }

type LedgerThreadState = {
  phase: ChatPhase
  confirmedTranscript: UiMessage[]
  liveEventLog: LiveTurnEvent[]
  finalizedSnapshot: FinalizedTurnSnapshotState | null
  activeTurnId: string
  activeSegment: LiveTextSegmentState | null
  nextSegmentCount: number
}

const WORKED_MESSAGE_TYPE = 'worked'

function parseIsoTimestamp(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  const displaySeconds = seconds > 0 || parts.length === 0 ? seconds : 0
  parts.push(`${displaySeconds}s`)
  return parts.join(' ')
}

function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.turnId === second.turnId && first.durationMs === second.durationMs
}

function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.label !== second.label) return false
  if (first.details.length !== second.details.length) return false
  for (let index = 0; index < first.details.length; index += 1) {
    if (first.details[index] !== second.details[index]) return false
  }
  return true
}

function buildTurnSummaryMessage(summary: TurnSummaryState): UiMessage {
  return {
    id: `turn-summary:${summary.turnId}`,
    role: 'system',
    text: `Worked for ${formatTurnDuration(summary.durationMs)}`,
    messageType: WORKED_MESSAGE_TYPE,
  }
}

function findLastAssistantMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index
    }
  }
  return -1
}

function insertTurnSummaryMessage(messages: UiMessage[], summary: TurnSummaryState): UiMessage[] {
  const summaryMessage = buildTurnSummaryMessage(summary)
  const sanitizedMessages = messages.filter((message) => message.messageType !== WORKED_MESSAGE_TYPE)
  const insertIndex = findLastAssistantMessageIndex(sanitizedMessages)
  if (insertIndex < 0) {
    return [...sanitizedMessages, summaryMessage]
  }
  const next = [...sanitizedMessages]
  next.splice(insertIndex, 0, summaryMessage)
  return next
}

function projectLiveTurnEvents(events: LiveTurnEvent[]): UiMessage[] {
  const projected: UiMessage[] = []

  for (const event of events) {
    if (event.type === 'text_delta') {
      const existingIndex = projected.findIndex((message) => message.id === event.segmentId)
      if (existingIndex >= 0) {
        const existing = projected[existingIndex]
        projected[existingIndex] = {
          ...existing,
          text: `${existing.text}${event.delta}`,
        }
        continue
      }

      projected.push({
        id: event.segmentId,
        role: 'assistant',
        text: event.delta,
        messageType: event.kind === 'reasoning' ? 'reasoning.live' : 'agentMessage.live',
      })
      continue
    }

    if (event.type === 'command_snapshot' || event.type === 'tool_snapshot') {
      const next = upsertMessage(projected, event.message)
      projected.splice(0, projected.length, ...next)
      continue
    }

    if (event.type === 'command_output_delta') {
      const currentIndex = projected.findIndex((message) => message.id === event.itemId)
      if (currentIndex < 0) continue
      const current = projected[currentIndex]
      if (!current.commandExecution) continue
      projected[currentIndex] = {
        ...current,
        commandExecution: {
          ...current.commandExecution,
          aggregatedOutput: `${current.commandExecution.aggregatedOutput}${event.delta}`,
        },
      }
    }
  }

  return projected
}

function isWorkedMessage(message: UiMessage): boolean {
  return message.messageType === 'commandExecution' || message.messageType === 'toolCall'
}

function shouldPreserveFinalizedSnapshot(
  finalizedSnapshot: FinalizedTurnSnapshotState | null,
  confirmedTranscript: UiMessage[],
): boolean {
  if (!finalizedSnapshot) return false

  const finalizedWorkedMessages = finalizedSnapshot.messages.filter(isWorkedMessage)
  if (finalizedWorkedMessages.length === 0) return false

  const confirmedWorkedIds = new Set(
    confirmedTranscript
      .filter(isWorkedMessage)
      .map((message) => message.id),
  )

  return finalizedWorkedMessages.some((message) => !confirmedWorkedIds.has(message.id))
}

function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return (
    first.id === second.id &&
    first.title === second.title &&
    first.projectName === second.projectName &&
    first.cwd === second.cwd &&
    first.createdAtIso === second.createdAtIso &&
    first.updatedAtIso === second.updatedAtIso &&
    first.preview === second.preview &&
    first.unread === second.unread &&
    first.inProgress === second.inProgress
  )
}

function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  const nextEntries = Object.entries(stateMap).filter(([threadId]) => threadIds.has(threadId))
  if (nextEntries.length === Object.keys(stateMap).length) {
    return stateMap
  }
  return Object.fromEntries(nextEntries) as Record<string, T>
}

function mergeThreadGroups(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
): UiProjectGroup[] {
  const previousGroupsByName = new Map(previous.map((group) => [group.projectName, group]))
  const mergedGroups: UiProjectGroup[] = incoming.map((incomingGroup) => {
    const previousGroup = previousGroupsByName.get(incomingGroup.projectName)
    const previousThreadsById = new Map(previousGroup?.threads.map((thread) => [thread.id, thread]) ?? [])

    const mergedThreads = incomingGroup.threads.map((incomingThread) => {
      const previousThread = previousThreadsById.get(incomingThread.id)
      if (previousThread && areThreadFieldsEqual(previousThread, incomingThread)) {
        return previousThread
      }
      return incomingThread
    })

    if (
      previousGroup &&
      previousGroup.projectName === incomingGroup.projectName &&
      areThreadArraysEqual(previousGroup.threads, mergedThreads)
    ) {
      return previousGroup
    }

    return {
      projectName: incomingGroup.projectName,
      threads: mergedThreads,
    }
  })

  return areGroupArraysEqual(previous, mergedGroups) ? previous : mergedGroups
}

function mergeIncomingWithLocalInProgressThreads(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
  isThreadInProgress: (threadId: string) => boolean,
): UiProjectGroup[] {
  const incomingThreadIds = new Set(flattenThreads(incoming).map((thread) => thread.id))
  const localInProgressThreads = flattenThreads(previous).filter(
    (thread) => isThreadInProgress(thread.id) && !incomingThreadIds.has(thread.id),
  )

  if (localInProgressThreads.length === 0) {
    return incoming
  }

  const incomingByProjectName = new Map(incoming.map((group) => [group.projectName, group]))
  const merged: UiProjectGroup[] = incoming.map((group) => ({
    projectName: group.projectName,
    threads: [...group.threads],
  }))

  for (const thread of localInProgressThreads) {
    const existingGroup = incomingByProjectName.get(thread.projectName)
    if (existingGroup) {
      const mergedGroupIndex = merged.findIndex((group) => group.projectName === thread.projectName)
      if (mergedGroupIndex >= 0) {
        merged[mergedGroupIndex] = {
          projectName: merged[mergedGroupIndex].projectName,
          threads: [thread, ...merged[mergedGroupIndex].threads],
        }
      }
      continue
    }

    merged.push({
      projectName: thread.projectName,
      threads: [thread],
    })
  }

  return merged
}

function toProjectName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts.at(-1) || cwd || 'unknown-project'
}

function toProjectNameFromWorkspaceRoot(value: string): string {
  const normalized = value.replace(/\\/gu, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) || normalized
}

function toOptimisticThreadTitle(message: string): string {
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) return 'Untitled thread'
  return firstLine.slice(0, 80)
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const ledgerByThreadId = ref<Record<string, LedgerThreadState>>({})
  type FileAttachment = { label: string; path: string; fsPath: string }
  type QueuedMessage = { id: string; text: string; imageUrls: string[]; skills: Array<{ name: string; path: string }>; fileAttachments: FileAttachment[] }
  type PendingTurnRequest = {
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    effort: ReasoningEffort | ''
    fallbackRetried: boolean
  }
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

  function applyCachedTitlesToGroups(groups: UiProjectGroup[]): UiProjectGroup[] {
    const titles = threadTitleById.value
    if (Object.keys(titles).length === 0) return groups
    return groups.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const cached = titles[thread.id]
        return cached ? { ...thread, title: cached } : thread
      }),
    }))
  }

  function applyThreadFlags(): void {
    const withTitles = applyCachedTitlesToGroups(sourceGroups.value)
    const flaggedGroups: UiProjectGroup[] = withTitles.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const inProgress = isThreadInProgress(thread.id)
        const isSelected = selectedThreadId.value === thread.id
        const lastReadIso = readStateByThreadId.value[thread.id]
        const unreadByEvent = eventUnreadByThreadId.value[thread.id] === true
        const unread = !isSelected && !inProgress && (unreadByEvent || lastReadIso !== thread.updatedAtIso)

        return {
          ...thread,
          inProgress,
          unread,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string): void {
    const nowIso = new Date().toISOString()
    const normalizedCwd = cwd.trim()
    const projectName = toProjectName(normalizedCwd)
    const nextThread: UiThread = {
      id: threadId,
      title: toOptimisticThreadTitle(firstMessageText),
      projectName,
      cwd: normalizedCwd,
      hasWorktree: normalizedCwd.includes('/.codex/worktrees/') || normalizedCwd.includes('/.git/worktrees/'),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      preview: firstMessageText,
      unread: false,
      inProgress: false,
    }

    const existingGroupIndex = sourceGroups.value.findIndex((group) => group.projectName === projectName)
    if (existingGroupIndex >= 0) {
      const existingGroup = sourceGroups.value[existingGroupIndex]
      const remainingThreads = existingGroup.threads.filter((thread) => thread.id !== threadId)
      const nextGroup: UiProjectGroup = {
        projectName,
        threads: [nextThread, ...remainingThreads],
      }
      const nextGroups = [...sourceGroups.value]
      nextGroups.splice(existingGroupIndex, 1, nextGroup)
      sourceGroups.value = nextGroups
    } else {
      sourceGroups.value = [{ projectName, threads: [nextThread] }, ...sourceGroups.value]
    }

    const nextProjectOrder = mergeProjectOrder(projectOrder.value, sourceGroups.value)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }
    applyThreadFlags()
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    const nextReadState = pruneThreadStateMap(readStateByThreadId.value, activeThreadIds)
    if (nextReadState !== readStateByThreadId.value) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
    const nextScrollState = pruneThreadStateMap(scrollStateByThreadId.value, activeThreadIds)
    if (nextScrollState !== scrollStateByThreadId.value) {
      scrollStateByThreadId.value = nextScrollState
      saveThreadScrollStateMap(nextScrollState)
    }
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    ledgerByThreadId.value = pruneThreadStateMap(ledgerByThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    eventUnreadByThreadId.value = pruneThreadStateMap(eventUnreadByThreadId.value, activeThreadIds)
    const nextPending: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  function markThreadAsRead(threadId: string): void {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    if (!thread) return

    readStateByThreadId.value = {
      ...readStateByThreadId.value,
      [threadId]: thread.updatedAtIso,
    }
    saveReadStateMap(readStateByThreadId.value)
    if (eventUnreadByThreadId.value[threadId]) {
      eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, threadId)
    }
    applyThreadFlags()
  }

  function setTurnSummaryForThread(threadId: string, summary: TurnSummaryState | null): void {
    if (!threadId) return

    const previous = turnSummaryByThreadId.value[threadId]
    if (summary) {
      if (areTurnSummariesEqual(previous, summary)) return
      turnSummaryByThreadId.value = {
        ...turnSummaryByThreadId.value,
        [threadId]: summary,
      }
    } else {
      if (previous) {
        turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
      }
    }
  }

  function markThreadUnreadByEvent(threadId: string): void {
    if (!threadId) return
    if (threadId === selectedThreadId.value) return
    if (eventUnreadByThreadId.value[threadId] === true) return
    eventUnreadByThreadId.value = {
      ...eventUnreadByThreadId.value,
      [threadId]: true,
    }
    applyThreadFlags()
  }

  function setTurnActivityForThread(threadId: string, activity: TurnActivityState | null): void {
    if (!threadId) return

    const previous = turnActivityByThreadId.value[threadId]
    if (!activity) {
      if (previous) {
        turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      }
      return
    }

    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const mergedDetails = Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3)
    const nextActivity: TurnActivityState = {
      label: normalizedLabel,
      details: mergedDetails,
    }

    if (areTurnActivitiesEqual(previous, nextActivity)) return
    turnActivityByThreadId.value = {
      ...turnActivityByThreadId.value,
      [threadId]: nextActivity,
    }
  }

  function setTurnErrorForThread(threadId: string, message: string | null): void {
    if (!threadId) return

    const previous = turnErrorByThreadId.value[threadId]
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (!normalizedMessage) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    if (previous?.message === normalizedMessage) return

    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage },
    }
  }

  function currentThreadVersion(threadId: string): string {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    return thread?.updatedAtIso ?? ''
  }

  function setThreadScrollState(threadId: string, nextState: ThreadScrollState): void {
    if (!threadId) return

    const normalizedState: ThreadScrollState = {
      scrollTop: Math.max(0, nextState.scrollTop),
      isAtBottom: nextState.isAtBottom === true,
    }
    if (typeof nextState.scrollRatio === 'number' && Number.isFinite(nextState.scrollRatio)) {
      normalizedState.scrollRatio = clamp(nextState.scrollRatio, 0, 1)
    }

    const previousState = scrollStateByThreadId.value[threadId]
    if (
      previousState &&
      previousState.scrollTop === normalizedState.scrollTop &&
      previousState.isAtBottom === normalizedState.isAtBottom &&
      previousState.scrollRatio === normalizedState.scrollRatio
    ) {
      return
    }

    scrollStateByThreadId.value = {
      ...scrollStateByThreadId.value,
      [threadId]: normalizedState,
    }
    saveThreadScrollStateMap(scrollStateByThreadId.value)
  }

  function defaultLedgerThreadState(): LedgerThreadState {
    return {
      phase: 'idle',
      confirmedTranscript: [],
      liveEventLog: [],
      finalizedSnapshot: null,
      activeTurnId: '',
      activeSegment: null,
      nextSegmentCount: 0,
    }
  }

  function getLedgerThreadState(threadId: string): LedgerThreadState {
    return ledgerByThreadId.value[threadId] ?? defaultLedgerThreadState()
  }

  function isThreadInProgress(threadId: string): boolean {
    const phase = getLedgerThreadState(threadId).phase
    return phase === 'live' || phase === 'finalizing'
  }

  function updateLedgerThreadState(
    threadId: string,
    updater: (current: LedgerThreadState) => LedgerThreadState,
  ): void {
    if (!threadId) return
    const previous = getLedgerThreadState(threadId)
    const next = updater(previous)
    if (next === previous) return
    ledgerByThreadId.value = {
      ...ledgerByThreadId.value,
      [threadId]: next,
    }
    if (next.phase !== previous.phase) {
      applyThreadFlags()
    }
  }

  function setConfirmedTranscriptForThread(
    threadId: string,
    nextMessages: UiMessage[],
    options: { inProgress: boolean; preserveMissing?: boolean } = { inProgress: false },
  ): void {
    updateLedgerThreadState(threadId, (current) => {
      const mergedMessages = options.inProgress
        ? mergeMessages(current.confirmedTranscript, nextMessages, {
            preserveMissing: options.preserveMissing === true,
          })
        : nextMessages
      const phase: ChatPhase =
        options.inProgress
          ? (current.phase === 'finalizing' ? 'finalizing' : 'live')
          : (current.phase === 'failed' ? 'failed' : 'settled')
      return {
        ...current,
        confirmedTranscript: mergedMessages,
        phase,
        liveEventLog: options.inProgress ? current.liveEventLog : [],
        finalizedSnapshot:
          options.inProgress || shouldPreserveFinalizedSnapshot(current.finalizedSnapshot, mergedMessages)
            ? current.finalizedSnapshot
            : null,
        activeTurnId: options.inProgress ? current.activeTurnId : '',
        activeSegment: options.inProgress ? current.activeSegment : null,
      }
    })
  }

  function setFinalizedTurnSnapshotForThread(
    threadId: string,
    snapshot: FinalizedTurnSnapshotState | null,
    options: { forceClear?: boolean } = {},
  ): void {
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      phase: snapshot
        ? 'finalizing'
        : current.phase === 'finalizing'
          ? 'settled'
          : current.phase,
      finalizedSnapshot: snapshot
        ? snapshot
        : (!options.forceClear && shouldPreserveFinalizedSnapshot(current.finalizedSnapshot, current.confirmedTranscript))
            ? current.finalizedSnapshot
            : null,
      activeTurnId: snapshot ? current.activeTurnId : '',
    }))
  }

  function buildFinalizedTurnSnapshot(threadId: string, turnId: string): FinalizedTurnSnapshotState {
    const ledger = getLedgerThreadState(threadId)
    const liveMessages = projectLiveTurnEvents(ledger.liveEventLog)
    return {
      turnId,
      messages: [...ledger.confirmedTranscript, ...liveMessages],
    }
  }

  function clearActiveLiveTextSegment(threadId: string): void {
    updateLedgerThreadState(threadId, (current) => {
      if (!current.activeSegment) return current
      return {
        ...current,
        activeSegment: null,
      }
    })
  }

  function appendLiveTextSegment(
    threadId: string,
    kind: LiveTextSegmentState['kind'],
    itemId: string,
    delta: string,
  ): void {
    if (!delta) return

    let segmentId = ''
    updateLedgerThreadState(threadId, (current) => {
      const activeSegment = current.activeSegment
      segmentId =
        activeSegment && activeSegment.kind === kind && activeSegment.itemId === itemId
          ? activeSegment.segmentId
          : `${kind}:${itemId}:segment:${current.nextSegmentCount + 1}`

      return {
        ...current,
        phase: current.phase === 'finalizing' ? 'finalizing' : 'live',
        nextSegmentCount:
          activeSegment && activeSegment.kind === kind && activeSegment.itemId === itemId
            ? current.nextSegmentCount
            : current.nextSegmentCount + 1,
        activeSegment: { kind, itemId, segmentId },
        liveEventLog: [...current.liveEventLog, {
          type: 'text_delta',
          kind,
          itemId,
          segmentId,
          delta,
        }],
      }
    })
  }

  function hasLiveTextSegmentsForItem(
    threadId: string,
    kind: LiveTextSegmentState['kind'],
    itemId: string,
  ): boolean {
    return getLedgerThreadState(threadId).liveEventLog.some((event) =>
      event.type === 'text_delta' && event.kind === kind && event.itemId === itemId,
    )
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  function readString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function titleCaseWords(value: string): string {
    return value
      .split(/[\s_]+/u)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  function formatMcpServerLabel(server: string): string {
    const normalized = server
      .replace(/^mcp__/u, '')
      .replace(/__$/u, '')
      .trim()
    if (!normalized) return 'MCP'
    return `${titleCaseWords(normalized)} MCP`
  }

  function readToolCallDetails(item: Record<string, unknown>): string[] {
    const itemType = readString(item.type).toLowerCase()
    if (itemType === 'dynamictoolcall') {
      const tool = readString(item.tool)
      return tool ? [tool] : []
    }
    if (itemType === 'mcptoolcall') {
      const tool = readString(item.tool)
      const server = readString(item.server)
      if (tool && server) return [`${tool} tool from ${formatMcpServerLabel(server)}`]
      if (tool) return [tool]
    }
    return []
  }

  function toolMessageText(
    phase: 'calling' | 'called',
    item: Record<string, unknown>,
  ): string {
    const subject = readToolCallDetails(item)[0] ?? (readString(item.tool) || 'tool')
    return phase === 'calling' ? `Calling ${subject}` : `Called ${subject}`
  }

  function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  function extractThreadIdFromNotification(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    const directThreadId = readString(params.threadId)
    if (directThreadId) return directThreadId
    const snakeThreadId = readString(params.thread_id)
    if (snakeThreadId) return snakeThreadId

    const conversationId = readString(params.conversationId)
    if (conversationId) return conversationId
    const snakeConversationId = readString(params.conversation_id)
    if (snakeConversationId) return snakeConversationId

    const thread = asRecord(params.thread)
    const nestedThreadId = readString(thread?.id)
    if (nestedThreadId) return nestedThreadId

    const turn = asRecord(params.turn)
    const turnThreadId = readString(turn?.threadId)
    if (turnThreadId) return turnThreadId
    const turnSnakeThreadId = readString(turn?.thread_id)
    if (turnSnakeThreadId) return turnSnakeThreadId

    return ''
  }

  function readTurnErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'turn/completed') return ''
    const params = asRecord(notification.params)
    const turn = asRecord(params?.turn)
    if (!turn || turn.status !== 'failed') return ''
    const errorPayload = asRecord(turn.error)
    return readString(errorPayload?.message)
  }

  function readNotificationErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'error') return ''
    const params = asRecord(notification.params)
    return (
      readString(params?.message) ||
      readString(asRecord(params?.error)?.message)
    )
  }

  function normalizeServerRequest(params: unknown): UiServerRequest | null {
    const row = asRecord(params)
    if (!row) return null

    const id = row.id
    const method = readString(row.method)
    const requestParams = row.params
    if (typeof id !== 'number' || !Number.isInteger(id) || !method) {
      return null
    }

    const requestParamRecord = asRecord(requestParams)
    const threadId = readString(requestParamRecord?.threadId) || GLOBAL_SERVER_REQUEST_SCOPE
    const turnId = readString(requestParamRecord?.turnId)
    const itemId = readString(requestParamRecord?.itemId)
    const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString()

    return {
      id,
      method,
      threadId,
      turnId,
      itemId,
      receivedAtIso,
      params: requestParams ?? null,
    }
  }

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) {
      nextRows.splice(index, 1, request)
    } else {
      nextRows.push(request)
    }

    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
  }

  function removePendingServerRequestById(requestId: number): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }
    pendingServerRequestsByThreadId.value = next
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (!request) return true
      upsertPendingServerRequest(request)
      return true
    }

    if (notification.method === 'server/request/resolved') {
      const row = asRecord(notification.params)
      const id = row?.id
      if (typeof id === 'number' && Number.isInteger(id)) {
        removePendingServerRequestById(id)
      }
      return true
    }

    return false
  }

  function sanitizeDisplayText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim()
  }

  function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    if (notification.method === 'turn/started') {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/started') {
      const params = asRecord(notification.params)
      const item = asRecord(params?.item)
      const itemType = readString(item?.type).toLowerCase()
      if (itemType === 'reasoning') {
        return {
          threadId,
          activity: {
            label: 'Thinking',
            details: [],
          },
        }
      }
      if (itemType === 'agentmessage') {
        return {
          threadId,
          activity: {
            label: 'Writing response',
            details: [],
          },
        }
      }
      if (itemType === 'commandexecution') {
        const cmd = readString(item?.command)
        return {
          threadId,
          activity: {
            label: 'Running command',
            details: cmd ? [cmd] : [],
          },
        }
      }
      if (itemType === 'dynamictoolcall' || itemType === 'mcptoolcall') {
        return {
          threadId,
          activity: {
            label: 'Calling',
            details: [],
          },
        }
      }
    }

    if (notification.method === 'item/commandExecution/outputDelta') {
      return {
        threadId,
        activity: {
          label: 'Running command',
          details: [],
        },
      }
    }

    if (
      notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/summaryPartAdded'
    ) {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/agentMessage/delta') {
      return {
        threadId,
        activity: {
          label: 'Writing response',
          details: [],
        },
      }
    }

    return null
  }

  function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
    if (notification.method !== 'turn/started') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    return {
      threadId,
      turnId,
      startedAtMs,
    }
  }

  function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
    if (notification.method !== 'turn/completed') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const completedAtMs =
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined

    return {
      threadId,
      turnId,
      completedAtMs,
      startedAtMs,
    }
  }

  function readReasoningStartedItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return readString(item.id)
    }

    return ''
  }

  function readReasoningDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический источник дельт для UI — уже нормализованный item/*.
    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const itemId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!itemId || !delta) return null
      return { itemId, delta }
    }

    return null
  }

  function readReasoningSectionBreakItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    // Канонический source для section break — item/*
    if (notification.method === 'item/reasoning/summaryPartAdded') {
      const itemId = readString(params.itemId)
      if (!itemId) return ''
      return itemId
    }

    return ''
  }

  function readReasoningCompletedItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return readString(item.id)
    }

    return ''
  }

  function readAgentMessageStartedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return ''
      return readString(item.id)
    }

    return ''
  }

  function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический live-канал агентского текста.
    if (notification.method === 'item/agentMessage/delta') {
      const messageId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!messageId || !delta) return null
      return { messageId, delta }
    }

    return null
  }

  function readAgentMessageCompleted(notification: RpcNotification): { itemId: string; text: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return null
      const id = readString(item.id)
      const text = readString(item.text)
      if (!id || !text) return null
      return { itemId: id, text }
    }

    return null
  }

  function readCommandExecutionStarted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/started') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status: 'inProgress', aggregatedOutput: '', exitCode: null },
    }
  }

  function readCommandOutputDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
    if (notification.method !== 'item/commandExecution/outputDelta') return null
    const params = asRecord(notification.params)
    if (!params) return null
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return null
    return { itemId, delta }
  }

  function readCommandExecutionCompleted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const statusRaw = readString(item.status)
    const status: CommandExecutionData['status'] =
      statusRaw === 'failed' ? 'failed' : statusRaw === 'declined' ? 'declined' : statusRaw === 'interrupted' ? 'interrupted' : 'completed'
    const aggregatedOutput = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status, aggregatedOutput, exitCode },
    }
  }

  function readToolCallStarted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/started') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    const itemType = readString(item?.type).toLowerCase()
    if (!item || (itemType !== 'dynamictoolcall' && itemType !== 'mcptoolcall')) return null
    const id = readString(item.id)
    if (!id) return null
    return {
      id,
      role: 'system',
      text: toolMessageText('calling', item),
      messageType: 'toolCall',
    }
  }

  function readToolCallCompleted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    const itemType = readString(item?.type).toLowerCase()
    if (!item || (itemType !== 'dynamictoolcall' && itemType !== 'mcptoolcall')) return null
    const id = readString(item.id)
    if (!id) return null
    return {
      id,
      role: 'system',
      text: toolMessageText('called', item),
      messageType: 'toolCall',
    }
  }

  function clearLiveLedger(threadId: string): void {
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      liveEventLog: [],
      activeSegment: null,
      activeTurnId: current.phase === 'finalizing' ? current.activeTurnId : current.activeTurnId,
    }))
  }

  function appendLiveEvent(threadId: string, event: LiveTurnEvent): void {
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      phase: current.phase === 'finalizing' ? 'finalizing' : 'live',
      liveEventLog: [...current.liveEventLog, event],
    }))
  }

  function isAgentContentEvent(notification: RpcNotification): boolean {
    if (notification.method === 'item/agentMessage/delta') {
      return true
    }

    const params = asRecord(notification.params)
    if (!params) return false

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      return item?.type === 'agentMessage'
    }

    return false
  }

  function applyRealtimeUpdates(notification: RpcNotification): void {
    if (handleServerRequestNotification(notification)) {
      return
    }

    if (notification.method === 'thread/name/updated') {
      const params = asRecord(notification.params)
      const threadId = readString(params?.threadId)
      const threadName = readString(params?.threadName)
      if (threadId && threadName) {
        threadTitleById.value = { ...threadTitleById.value, [threadId]: threadName }
        applyThreadFlags()
        void persistThreadTitle(threadId, threadName)
      }
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

  async function loadThreads() {
    if (!hasLoadedThreads.value) {
      isLoadingThreads.value = true
    }

    try {
      const [groups] = await Promise.all([getThreadGroups(), loadThreadTitleCacheIfNeeded()])
      await hydrateWorkspaceRootsStateIfNeeded(groups)

      const nextProjectOrder = mergeProjectOrder(projectOrder.value, groups)
      if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
        projectOrder.value = nextProjectOrder
        saveProjectOrder(projectOrder.value)
      }

      const orderedGroups = orderGroupsByProjectOrder(groups, projectOrder.value)
      const mergedWithInProgress = mergeIncomingWithLocalInProgressThreads(
        sourceGroups.value,
        orderedGroups,
        isThreadInProgress,
      )
      sourceGroups.value = mergeThreadGroups(sourceGroups.value, mergedWithInProgress)
      applyThreadFlags()
      hasLoadedThreads.value = true

      const flatThreads = flattenThreads(projectGroups.value)
      pruneThreadScopedState(flatThreads)

      const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)

      if (!currentExists) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
    } finally {
      isLoadingThreads.value = false
    }
  }

  async function loadMessages(threadId: string, options: { silent?: boolean } = {}) {
    if (!threadId) {
      return
    }

    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    if (shouldShowLoading) {
      isLoadingMessages.value = true
    }

    try {
      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const payload = await readThreadRaw(threadId)
      const nextMessages = normalizeThreadMessagesV2(payload)
      const inProgress = readThreadInProgressFromResponse(payload)
      setConfirmedTranscriptForThread(threadId, nextMessages, {
        inProgress,
        preserveMissing: options.silent === true,
      })

      if (!inProgress) {
        clearLiveLedger(threadId)
        setFinalizedTurnSnapshotForThread(threadId, null)
      }

      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [threadId]: true,
      }

      const version = currentThreadVersion(threadId)
      if (version) {
        loadedVersionByThreadId.value = {
          ...loadedVersionByThreadId.value,
          [threadId]: version,
        }
      }
      markThreadAsRead(threadId)
    } finally {
      if (shouldShowLoading) {
        isLoadingMessages.value = false
      }
    }
  }

  async function refreshSkills(): Promise<void> {
    if (IS_WASM_RUNTIME) {
      installedSkills.value = []
      return
    }
    try {
      const cwds = sourceGroups.value.flatMap((g) => g.threads.map((t) => t.cwd)).filter(Boolean)
      installedSkills.value = await getSkillsList(cwds.length > 0 ? [...new Set(cwds)] : undefined)
    } catch {
      // keep previous skills on failure
    }
  }

  async function refreshAll() {
    error.value = ''

    try {
      await loadThreads()
      await Promise.all([
        refreshModelPreferences(),
        refreshSkills(),
      ])
      await loadMessages(selectedThreadId.value)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function selectThread(threadId: string) {
    setSelectedThreadId(threadId)

    try {
      await loadMessages(threadId)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
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

  async function syncThreadStatus(): Promise<void> {
    if (isPolling.value) return
    isPolling.value = true

    try {
      await loadThreads()

      if (!selectedThreadId.value) return

      const threadId = selectedThreadId.value
      const currentVersion = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion
      const isInProgress = isThreadInProgress(threadId)

      if (isInProgress || hasVersionChange) {
        await loadMessages(threadId, { silent: true })
      }
    } catch {
      // ignore poll failures and keep last known state
    } finally {
      isPolling.value = false
    }
  }

  async function syncFromNotifications(): Promise<void> {
    if (isPolling.value) {
      if (typeof window !== 'undefined' && eventSyncTimer === null) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
      return
    }

    isPolling.value = true

    const shouldRefreshThreads = pendingThreadsRefresh
    const threadIdsToRefresh = new Set(pendingThreadMessageRefresh)
    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()

    try {
      if (shouldRefreshThreads) {
        await loadThreads()
      }

      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) return

      const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
      const isInProgress = isThreadInProgress(activeThreadId)
      const currentVersion = currentThreadVersion(activeThreadId)
      const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

      if (isActiveDirty || isInProgress || hasVersionChange || shouldRefreshThreads) {
        await loadMessages(activeThreadId, { silent: true })
      }
    } catch {
      // Keep UI stable on transient event sync failures.
    } finally {
      isPolling.value = false

      if (
        (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) &&
        typeof window !== 'undefined' &&
        eventSyncTimer === null
      ) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
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
        const request = normalizeServerRequest(row)
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
