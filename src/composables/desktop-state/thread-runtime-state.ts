import type { Ref } from 'vue'
import type { RpcNotification } from '../../api/codexGateway'
import type { ThreadScrollState, UiServerRequest, UiThread } from '../../types/codex'
import {
  areTurnActivitiesEqual,
  areTurnSummariesEqual,
  normalizeMessageText,
  omitKey,
} from './message-helpers'
import { normalizeServerRequest, readResolvedServerRequestId } from './notification-parsers'
import type {
  TurnActivityState,
  TurnErrorState,
  TurnSummaryState,
} from './types'

function sanitizeDisplayText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function createThreadRuntimeState(params: {
  selectedThreadId: Ref<string>
  readStateByThreadId: Ref<Record<string, string>>
  scrollStateByThreadId: Ref<Record<string, ThreadScrollState>>
  turnSummaryByThreadId: Ref<Record<string, TurnSummaryState>>
  turnActivityByThreadId: Ref<Record<string, TurnActivityState>>
  turnErrorByThreadId: Ref<Record<string, TurnErrorState>>
  eventUnreadByThreadId: Ref<Record<string, boolean>>
  pendingServerRequestsByThreadId: Ref<Record<string, UiServerRequest[]>>
  globalServerRequestScope: string
  clamp: (value: number, minValue: number, maxValue: number) => number
  saveReadStateMap: (state: Record<string, string>) => void
  saveThreadScrollStateMap: (state: Record<string, ThreadScrollState>) => void
  applyThreadFlags: () => void
  getSourceThreads: () => UiThread[]
}) {
  const {
    selectedThreadId,
    readStateByThreadId,
    scrollStateByThreadId,
    turnSummaryByThreadId,
    turnActivityByThreadId,
    turnErrorByThreadId,
    eventUnreadByThreadId,
    pendingServerRequestsByThreadId,
    globalServerRequestScope,
    clamp,
    saveReadStateMap,
    saveThreadScrollStateMap,
    applyThreadFlags,
    getSourceThreads,
  } = params

  function markThreadAsRead(threadId: string): void {
    const thread = getSourceThreads().find((row) => row.id === threadId)
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
      return
    }
    if (previous) {
      turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
    }
  }

  function markThreadUnreadByEvent(threadId: string): void {
    if (!threadId || threadId === selectedThreadId.value || eventUnreadByThreadId.value[threadId] === true) return
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
      if (previous) turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      return
    }
    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const nextActivity: TurnActivityState = {
      label: normalizedLabel,
      details: Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3),
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
      if (previous) turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      return
    }
    if (previous?.message === normalizedMessage) return
    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage },
    }
  }

  function currentThreadVersion(threadId: string): string {
    return getSourceThreads().find((row) => row.id === threadId)?.updatedAtIso ?? ''
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

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || globalServerRequestScope
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) nextRows.splice(index, 1, request)
    else nextRows.push(request)
    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
  }

  function removePendingServerRequestById(requestId: number): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) next[threadId] = filtered
    }
    pendingServerRequestsByThreadId.value = next
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params, globalServerRequestScope)
      if (!request) return true
      upsertPendingServerRequest(request)
      return true
    }
    if (notification.method === 'server/request/resolved') {
      const id = readResolvedServerRequestId(notification)
      if (id !== null) removePendingServerRequestById(id)
      return true
    }
    return false
  }

  return {
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
  }
}
