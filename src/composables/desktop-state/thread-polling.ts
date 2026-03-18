import type { Ref } from 'vue'
import { getPendingServerRequests, replyToServerRequest, subscribeCodexNotifications, type RpcNotification } from '../../api/codexGateway'
import type { UiServerRequestReply } from '../../types/codex'
import { normalizeServerRequest } from './notification-parsers'

export function createThreadPolling(params: {
  isAutoRefreshEnabled: Ref<boolean>
  autoRefreshSecondsLeft: Ref<number>
  ledgerByThreadId: Ref<Record<string, unknown>>
  turnActivityByThreadId: Ref<Record<string, unknown>>
  turnSummaryByThreadId: Ref<Record<string, unknown>>
  turnErrorByThreadId: Ref<Record<string, unknown>>
  queuedMessagesByThreadId: Ref<Record<string, unknown>>
  error: Ref<string>
  globalServerRequestScope: string
  autoRefreshIntervalMs: number
  saveAutoRefreshEnabled: (enabled: boolean) => void
  upsertPendingServerRequest: (request: any) => void
  removePendingServerRequestById: (requestId: number) => void
  applyRealtimeUpdates: (notification: RpcNotification) => void
  queueEventDrivenSync: (notification: RpcNotification) => void
  syncThreadStatus: () => Promise<void>
  pendingThreadsRefreshRef: { value: boolean }
  pendingThreadMessageRefreshRef: { value: Set<string> }
  pendingTurnStartsById: Map<string, unknown>
  eventSyncTimerRef: { value: number | null }
  stopNotificationStreamRef: { value: (() => void) | null }
  activeReasoningItemIdRef: { value: string }
  shouldAutoScrollRef: { value: boolean }
}) {
  const {
    isAutoRefreshEnabled,
    autoRefreshSecondsLeft,
    ledgerByThreadId,
    turnActivityByThreadId,
    turnSummaryByThreadId,
    turnErrorByThreadId,
    queuedMessagesByThreadId,
    error,
    globalServerRequestScope,
    autoRefreshIntervalMs,
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
  } = params

  let autoRefreshIntervalTimer: number | null = null
  let autoRefreshCountdownTimer: number | null = null

  async function loadPendingServerRequestsFromBridge(): Promise<void> {
    try {
      const rows = await getPendingServerRequests()
      for (const row of rows) {
        const request = normalizeServerRequest(row, globalServerRequestScope)
        if (request) upsertPendingServerRequest(request)
      }
    } catch {
      // Keep UI usable when pending request endpoint is temporarily unavailable.
    }
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<void> {
    try {
      await replyToServerRequest(reply.id, { result: reply.result, error: reply.error })
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
    autoRefreshSecondsLeft.value = Math.floor(autoRefreshIntervalMs / 1000)
  }

  function startAutoRefreshTimer(): void {
    if (typeof window === 'undefined') return
    if (autoRefreshIntervalTimer !== null || autoRefreshCountdownTimer !== null) return
    isAutoRefreshEnabled.value = true
    saveAutoRefreshEnabled(true)
    autoRefreshSecondsLeft.value = Math.floor(autoRefreshIntervalMs / 1000)
    autoRefreshIntervalTimer = window.setInterval(() => {
      autoRefreshSecondsLeft.value = Math.floor(autoRefreshIntervalMs / 1000)
      void syncThreadStatus()
    }, autoRefreshIntervalMs)
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

  function startPolling(): void {
    if (typeof window === 'undefined' || stopNotificationStreamRef.value) return
    if (isAutoRefreshEnabled.value) startAutoRefreshTimer()
    void loadPendingServerRequestsFromBridge()
    stopNotificationStreamRef.value = subscribeCodexNotifications((notification) => {
      applyRealtimeUpdates(notification)
      queueEventDrivenSync(notification)
    })
  }

  function stopPolling(): void {
    stopAutoRefreshTimer({ updatePreference: false })
    if (stopNotificationStreamRef.value) {
      stopNotificationStreamRef.value()
      stopNotificationStreamRef.value = null
    }
    pendingThreadsRefreshRef.value = false
    pendingThreadMessageRefreshRef.value.clear()
    pendingTurnStartsById.clear()
    if (eventSyncTimerRef.value !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimerRef.value)
      eventSyncTimerRef.value = null
    }
    activeReasoningItemIdRef.value = ''
    shouldAutoScrollRef.value = false
    ledgerByThreadId.value = {}
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    queuedMessagesByThreadId.value = {}
  }

  return {
    loadPendingServerRequestsFromBridge,
    respondToPendingServerRequest,
    stopAutoRefreshTimer,
    startAutoRefreshTimer,
    toggleAutoRefreshTimer,
    startPolling,
    stopPolling,
  }
}
