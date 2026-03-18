import type { Ref } from 'vue'
import { getSkillsList, readThreadRaw, resumeThread } from '../../api/codexGateway'
import { normalizeThreadMessagesV2, readThreadInProgressFromResponse } from '../../api/normalizers/v2'
import { IS_WASM_RUNTIME } from '../../config/runtime'
import type { UiProjectGroup, UiMessage } from '../../types/codex'

export function createThreadSync(params: {
  sourceGroups: Ref<UiProjectGroup[]>
  selectedThreadId: Ref<string>
  error: Ref<string>
  isLoadingMessages: Ref<boolean>
  loadedMessagesByThreadId: Ref<Record<string, boolean>>
  resumedThreadById: Ref<Record<string, boolean>>
  loadedVersionByThreadId: Ref<Record<string, string>>
  installedSkills: Ref<unknown[]>
  isPolling: Ref<boolean>
  pendingThreadsRefreshRef: { value: boolean }
  pendingThreadMessageRefreshRef: { value: Set<string> }
  eventSyncTimerRef: { value: number | null }
  eventSyncDebounceMs: number
  isThreadInProgress: (threadId: string) => boolean
  currentThreadVersion: (threadId: string) => string
  markThreadAsRead: (threadId: string) => void
  setConfirmedTranscriptForThread: (
    threadId: string,
    messages: UiMessage[],
    options?: { inProgress?: boolean; preserveMissing?: boolean },
  ) => void
  clearLiveLedger: (threadId: string) => void
  setFinalizedTurnSnapshotForThread: (threadId: string, snapshot: unknown | null) => void
  loadThreads: () => Promise<void>
  refreshModelPreferences: () => Promise<void>
  setSelectedThreadId: (threadId: string) => void
}) {
  const {
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
    eventSyncDebounceMs,
    isThreadInProgress,
    currentThreadVersion,
    markThreadAsRead,
    setConfirmedTranscriptForThread,
    clearLiveLedger,
    setFinalizedTurnSnapshotForThread,
    loadThreads,
    refreshModelPreferences,
    setSelectedThreadId,
  } = params

  async function loadMessages(threadId: string, options: { silent?: boolean } = {}): Promise<void> {
    if (!threadId) return
    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    if (shouldShowLoading) isLoadingMessages.value = true
    try {
      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
        resumedThreadById.value = { ...resumedThreadById.value, [threadId]: true }
      }
      const payload = await readThreadRaw(threadId)
      const nextMessages = normalizeThreadMessagesV2(payload)
      const inProgress = readThreadInProgressFromResponse(payload)
      setConfirmedTranscriptForThread(threadId, nextMessages, { inProgress, preserveMissing: options.silent === true })
      if (!inProgress) {
        clearLiveLedger(threadId)
        setFinalizedTurnSnapshotForThread(threadId, null)
      }
      loadedMessagesByThreadId.value = { ...loadedMessagesByThreadId.value, [threadId]: true }
      const version = currentThreadVersion(threadId)
      if (version) loadedVersionByThreadId.value = { ...loadedVersionByThreadId.value, [threadId]: version }
      markThreadAsRead(threadId)
    } finally {
      if (shouldShowLoading) isLoadingMessages.value = false
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

  async function refreshAll(): Promise<void> {
    error.value = ''
    try {
      await loadThreads()
      await Promise.all([refreshModelPreferences(), refreshSkills()])
      await loadMessages(selectedThreadId.value)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function selectThread(threadId: string): Promise<void> {
    setSelectedThreadId(threadId)
    try {
      await loadMessages(threadId)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
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
      if (isThreadInProgress(threadId) || hasVersionChange) {
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
      if (typeof window !== 'undefined' && eventSyncTimerRef.value === null) {
        eventSyncTimerRef.value = window.setTimeout(() => {
          eventSyncTimerRef.value = null
          void syncFromNotifications()
        }, eventSyncDebounceMs)
      }
      return
    }
    isPolling.value = true
    const shouldRefreshThreads = pendingThreadsRefreshRef.value
    const threadIdsToRefresh = new Set(pendingThreadMessageRefreshRef.value)
    pendingThreadsRefreshRef.value = false
    pendingThreadMessageRefreshRef.value.clear()
    try {
      if (shouldRefreshThreads) await loadThreads()
      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) return
      const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
      const currentVersion = currentThreadVersion(activeThreadId)
      const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion
      if (isActiveDirty || isThreadInProgress(activeThreadId) || hasVersionChange || shouldRefreshThreads) {
        await loadMessages(activeThreadId, { silent: true })
      }
    } catch {
      // Keep UI stable on transient event sync failures.
    } finally {
      isPolling.value = false
      if (
        (pendingThreadsRefreshRef.value || pendingThreadMessageRefreshRef.value.size > 0) &&
        typeof window !== 'undefined' &&
        eventSyncTimerRef.value === null
      ) {
        eventSyncTimerRef.value = window.setTimeout(() => {
          eventSyncTimerRef.value = null
          void syncFromNotifications()
        }, eventSyncDebounceMs)
      }
    }
  }

  return {
    loadMessages,
    refreshSkills,
    refreshAll,
    selectThread,
    syncThreadStatus,
    syncFromNotifications,
  }
}
