import type { Ref } from 'vue'
import { persistThreadTitle, resumeThread, rollbackThreadRaw, startThreadTurnRaw, type RpcNotification } from '../../api/codexGateway'
import { normalizeThreadMessagesV2 } from '../../api/normalizers/v2'
import { omitKey } from './message-helpers'
import {
  extractThreadIdFromNotification,
  isAgentContentEvent,
  readAgentMessageCompleted,
  readAgentMessageDelta,
  readAgentMessageStartedId,
  readCommandExecutionCompleted,
  readCommandExecutionStarted,
  readCommandOutputDelta,
  readNotificationErrorMessage,
  readNotificationThreadName,
  readNumber,
  readReasoningCompletedItemId,
  readReasoningDelta,
  readReasoningSectionBreakItemId,
  readReasoningStartedItemId,
  readToolCallCompleted,
  readToolCallStarted,
  readTurnActivity,
  readTurnCompletedInfo,
  readTurnErrorMessage,
  readTurnStartedInfo,
} from './notification-parsers'

export function createThreadRealtime(params: {
  selectedThreadId: Ref<string>
  selectedModelId: Ref<string>
  threadTitleById: Ref<Record<string, string>>
  resumedThreadById: Ref<Record<string, boolean>>
  pendingTurnRequestByThreadId: Ref<Record<string, any>>
  error: Ref<string>
  eventUnreadByThreadId: Ref<Record<string, boolean>>
  modelFallbackId: string
  pendingTurnStartsById: Map<string, any>
  activeReasoningItemIdRef: { value: string }
  shouldAutoScrollRef: { value: boolean }
  pendingThreadsRefreshRef: { value: boolean }
  pendingThreadMessageRefreshRef: { value: Set<string> }
  eventSyncTimerRef: { value: number | null }
  eventSyncDebounceMs: number
  applyThreadFlags: () => void
  setPendingTurnRequest: (threadId: string, request: any) => void
  processQueuedMessages: (threadId: string) => Promise<void>
  syncFromNotifications: () => Promise<void>
  applyFallbackModelSelection: () => Promise<void>
  buildPendingTurnDetails: (modelId: string, effort: any) => string[]
  buildProtocolTurnInput: (text: string, imageUrls: string[], skills: Array<{ name: string; path: string }>, fileAttachments: any[]) => Record<string, unknown>[]
  isUnsupportedChatGptModelError: (error: unknown) => boolean
  handleServerRequestNotification: (notification: RpcNotification) => boolean
  setTurnActivityForThread: (threadId: string, activity: any | null) => void
  setTurnSummaryForThread: (threadId: string, summary: any | null) => void
  setTurnErrorForThread: (threadId: string, message: string | null) => void
  markThreadUnreadByEvent: (threadId: string) => void
  setThreadScrollState: (threadId: string, state: any) => void
  setActiveTurnId: (threadId: string, turnId: string) => void
  clearActiveTurnId: (threadId: string) => void
  getLedgerThreadState: (threadId: string) => any
  updateLedgerThreadState: (threadId: string, updater: (current: any) => any) => void
  setConfirmedTranscriptForThread: (threadId: string, messages: any[], options?: { inProgress: boolean }) => void
  setFinalizedTurnSnapshotForThread: (threadId: string, snapshot: any | null, options?: { forceClear?: boolean }) => void
  buildFinalizedTurnSnapshot: (threadId: string, turnId: string, options?: { extraMessages?: any[] }) => any
  clearActiveLiveTextSegment: (threadId: string) => void
  appendLiveTextSegment: (threadId: string, kind: 'assistant' | 'reasoning', itemId: string, delta: string) => void
  hasLiveTextSegmentsForItem: (threadId: string, kind: 'assistant' | 'reasoning', itemId: string) => boolean
  clearLiveLedger: (threadId: string) => void
  appendLiveEvent: (threadId: string, event: any) => void
  asRecord: (value: unknown) => Record<string, unknown> | null
}) {
  const {
    selectedThreadId,
    selectedModelId,
    threadTitleById,
    resumedThreadById,
    pendingTurnRequestByThreadId,
    error,
    eventUnreadByThreadId,
    modelFallbackId,
    pendingTurnStartsById,
    activeReasoningItemIdRef,
    shouldAutoScrollRef,
    pendingThreadsRefreshRef,
    pendingThreadMessageRefreshRef,
    eventSyncTimerRef,
    eventSyncDebounceMs,
    applyThreadFlags,
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
    setActiveTurnId,
    clearActiveTurnId,
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
  } = params

  const fallbackRetryInFlightThreadIds = new Set<string>()

  async function retryPendingTurnWithFallback(threadId: string): Promise<void> {
    if (fallbackRetryInFlightThreadIds.has(threadId)) return
    const pending = pendingTurnRequestByThreadId.value[threadId]
    if (!pending || pending.fallbackRetried) return
    fallbackRetryInFlightThreadIds.add(threadId)
    setPendingTurnRequest(threadId, { ...pending, fallbackRetried: true })
    try {
      await applyFallbackModelSelection()
      try {
        const payload = await rollbackThreadRaw(threadId, 1)
        const rolledBackMessages = normalizeThreadMessagesV2({ thread: payload.thread })
        setConfirmedTranscriptForThread(threadId, rolledBackMessages, { inProgress: false })
        clearLiveLedger(threadId)
        clearActiveLiveTextSegment(threadId)
      } catch {}
      setTurnErrorForThread(threadId, null)
      error.value = ''
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, { label: 'Thinking', details: buildPendingTurnDetails(modelFallbackId, pending.effort) })
      updateLedgerThreadState(threadId, (current) => ({ ...current, phase: 'live' }))
      if (resumedThreadById.value[threadId] !== true) await resumeThread(threadId)
      await startThreadTurnRaw(threadId, buildProtocolTurnInput(pending.text, pending.imageUrls, pending.skills, pending.fileAttachments), {
        model: modelFallbackId,
        effort: pending.effort || undefined,
        attachments: pending.fileAttachments,
      })
      resumedThreadById.value = { ...resumedThreadById.value, [threadId]: true }
      pendingThreadMessageRefreshRef.value.add(threadId)
      pendingThreadsRefreshRef.value = true
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

  function applyRealtimeUpdates(notification: RpcNotification): void {
    if (handleServerRequestNotification(notification)) return
    if (notification.method === 'xcodex/turnReconciled') {
      const reconciledThreadId = extractThreadIdFromNotification(notification)
      if (reconciledThreadId) {
        activeReasoningItemIdRef.value = ''
        clearActiveTurnId(reconciledThreadId)
        clearActiveLiveTextSegment(reconciledThreadId)
        setTurnActivityForThread(reconciledThreadId, null)
        updateLedgerThreadState(reconciledThreadId, (current) => ({
          ...current,
          phase: current.liveEventLog.length > 0 ? 'finalizing' : 'settled',
          activeTurnId: '',
        }))
      }
      return
    }
    const threadNameUpdate = readNotificationThreadName(notification)
    if (threadNameUpdate) {
      threadTitleById.value = { ...threadTitleById.value, [threadNameUpdate.threadId]: threadNameUpdate.threadName }
      applyThreadFlags()
      void persistThreadTitle(threadNameUpdate.threadId, threadNameUpdate.threadName)
    }
    const turnActivity = readTurnActivity(notification)
    if (turnActivity) setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      setActiveTurnId(startedTurn.threadId, startedTurn.turnId)
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
    const shouldRetryWithFallback = Boolean(completedThreadId) && Boolean(turnErrorMessage) && selectedModelId.value !== modelFallbackId && isUnsupportedChatGptModelError(new Error(turnErrorMessage))
    if (completedTurn) {
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) pendingTurnStartsById.delete(completedTurn.turnId)
      const rawDurationMs = readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number' ? completedTurn.completedAtMs - completedTurn.startedAtMs : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)
      setTurnSummaryForThread(completedTurn.threadId, { turnId: completedTurn.turnId, durationMs: typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0 })
      setTurnActivityForThread(completedTurn.threadId, null)
      markThreadUnreadByEvent(completedTurn.threadId)
      if (!shouldRetryWithFallback) {
        void processQueuedMessages(completedTurn.threadId)
      }
    }
    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        updateLedgerThreadState(failedThreadId, (current) => ({ ...current, phase: 'failed' }))
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
      }
      error.value = turnErrorMessage
      if (failedThreadId && shouldRetryWithFallback) void retryPendingTurnWithFallback(failedThreadId)
    } else if (completedTurn) {
      clearActiveTurnId(completedTurn.threadId)
      updateLedgerThreadState(completedTurn.threadId, (current) => ({
        ...current,
        phase: current.liveEventLog.length > 0 ? 'finalizing' : 'settled',
      }))
      setTurnErrorForThread(completedTurn.threadId, null)
    }
    const notificationErrorMessage = readNotificationErrorMessage(notification)
    if (notificationErrorMessage) {
      const errorThreadId = extractThreadIdFromNotification(notification)
      if (errorThreadId) setTurnErrorForThread(errorThreadId, notificationErrorMessage)
      error.value = notificationErrorMessage
      if (selectedModelId.value !== modelFallbackId && isUnsupportedChatGptModelError(new Error(notificationErrorMessage))) {
        if (errorThreadId) void retryPendingTurnWithFallback(errorThreadId)
        else void applyFallbackModelSelection()
      }
    }
    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (!notificationThreadId || notificationThreadId !== selectedThreadId.value) return
    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) clearActiveLiveTextSegment(notificationThreadId)
    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) appendLiveTextSegment(notificationThreadId, 'assistant', liveAgentMessageDelta.messageId, liveAgentMessageDelta.delta)
    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      if (!hasLiveTextSegmentsForItem(notificationThreadId, 'assistant', completedAgentMessage.itemId)) {
        appendLiveTextSegment(notificationThreadId, 'assistant', completedAgentMessage.itemId, completedAgentMessage.text)
      }
      clearActiveLiveTextSegment(notificationThreadId)
    }
    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      activeReasoningItemIdRef.value = startedReasoningItemId
      clearActiveLiveTextSegment(notificationThreadId)
    }
    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) appendLiveTextSegment(notificationThreadId, 'reasoning', liveReasoningDelta.itemId, liveReasoningDelta.delta)
    const sectionBreakItemId = readReasoningSectionBreakItemId(notification)
    if (sectionBreakItemId) {
      const activeSegment = getLedgerThreadState(notificationThreadId).activeSegment
      if (activeSegment?.kind === 'reasoning' && activeSegment.itemId === sectionBreakItemId) {
        appendLiveTextSegment(notificationThreadId, 'reasoning', sectionBreakItemId, '\n\n')
      }
    }
    const completedReasoningItemId = readReasoningCompletedItemId(notification)
    if (completedReasoningItemId) {
      if (completedReasoningItemId === activeReasoningItemIdRef.value) activeReasoningItemIdRef.value = ''
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
    if (commandDelta) appendLiveEvent(notificationThreadId, { type: 'command_output_delta', itemId: commandDelta.itemId, delta: commandDelta.delta })
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
    if (isAgentContentEvent(notification) && shouldAutoScrollRef.value && selectedThreadId.value) {
      setThreadScrollState(selectedThreadId.value, { scrollTop: 0, isAtBottom: true, scrollRatio: 1 })
    }
    if (notification.method === 'turn/completed') {
      activeReasoningItemIdRef.value = ''
      shouldAutoScrollRef.value = false
      clearActiveLiveTextSegment(notificationThreadId)
      const completedTurnId = completedTurn?.turnId || getLedgerThreadState(notificationThreadId).activeTurnId || `${notificationThreadId}:unknown`
      const pending = pendingTurnRequestByThreadId.value[notificationThreadId]
      const pendingUserMessage = pending
        ? {
            id: `pending-user:${notificationThreadId}`,
            role: 'user' as const,
            text: pending.text,
            images: pending.imageUrls.length > 0 ? [...pending.imageUrls] : undefined,
            fileAttachments: pending.fileAttachments.length > 0
              ? pending.fileAttachments.map((file: { label: string; path: string }) => ({
                  label: file.label,
                  path: file.path,
                }))
              : undefined,
            messageType: 'userMessage',
          }
        : null
      setFinalizedTurnSnapshotForThread(
        notificationThreadId,
        buildFinalizedTurnSnapshot(notificationThreadId, completedTurnId, {
          extraMessages: pendingUserMessage ? [pendingUserMessage] : [],
        }),
      )
      clearActiveTurnId(notificationThreadId)
      clearLiveLedger(notificationThreadId)
      updateLedgerThreadState(notificationThreadId, (current) => ({ ...current, phase: 'finalizing', activeTurnId: '' }))
      const completedThreadId2 = extractThreadIdFromNotification(notification)
      if (completedThreadId2) {
        setTurnActivityForThread(completedThreadId2, null)
        markThreadUnreadByEvent(completedThreadId2)
      }
    }
  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    const threadId = extractThreadIdFromNotification(notification)
    const method = notification.method
    const shouldRefreshThreadMessages = method === 'turn/completed' || method === 'xcodex/turnReconciled'
    const shouldRefreshThreads =
      method === 'thread/started' ||
      method === 'turn/started' ||
      method === 'turn/completed' ||
      method === 'xcodex/turnReconciled' ||
      method === 'thread/archived' ||
      method === 'thread/unarchived' ||
      method === 'thread/closed' ||
      method === 'thread/name/updated'
    if (threadId && shouldRefreshThreadMessages) pendingThreadMessageRefreshRef.value.add(threadId)
    if (shouldRefreshThreads) pendingThreadsRefreshRef.value = true
    if (!shouldRefreshThreadMessages && !shouldRefreshThreads) return
    if (eventSyncTimerRef.value !== null || typeof window === 'undefined') return
    eventSyncTimerRef.value = window.setTimeout(() => {
      eventSyncTimerRef.value = null
      void syncFromNotifications()
    }, eventSyncDebounceMs)
  }

  return {
    retryPendingTurnWithFallback,
    applyRealtimeUpdates,
    queueEventDrivenSync,
  }
}
