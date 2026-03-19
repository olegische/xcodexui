import type { Ref } from 'vue'
import {
  interruptThreadTurnRaw,
  resumeThread,
  rollbackThreadRaw,
  startThread,
  startThreadTurnRaw,
} from '../../api/codexGateway'
import { normalizeThreadMessagesV2 } from '../../api/normalizers/v2'
import type { ReasoningEffort, UiMessage } from '../../types/codex'
import { omitKey } from './message-helpers'
import type { FileAttachment, QueuedMessage } from './types'

export function createThreadTurnActions(params: {
  selectedThreadId: Ref<string>
  selectedModelId: Ref<string>
  selectedReasoningEffort: Ref<ReasoningEffort | ''>
  resumedThreadById: Ref<Record<string, boolean>>
  queuedMessagesByThreadId: Ref<Record<string, QueuedMessage[]>>
  isSendingMessage: Ref<boolean>
  isInterruptingTurn: Ref<boolean>
  isRollingBack: Ref<boolean>
  error: Ref<string>
  shouldAutoScrollRef: { value: boolean }
  pendingThreadsRefreshRef: { value: boolean }
  pendingThreadMessageRefreshRef: { value: Set<string> }
  modelFallbackId: string
  isThreadInProgress: (threadId: string) => boolean
  getLedgerThreadState: (threadId: string) => { activeTurnId: string; confirmedTranscript: UiMessage[] }
  updateLedgerThreadState: (threadId: string, updater: (current: any) => any) => void
  clearLiveLedger: (threadId: string) => void
  clearActiveLiveTextSegment: (threadId: string) => void
  setConfirmedTranscriptForThread: (
    threadId: string,
    messages: UiMessage[],
    options?: { inProgress: boolean; preserveMissing?: boolean },
  ) => void
  setTurnSummaryForThread: (threadId: string, summary: any | null) => void
  setTurnActivityForThread: (threadId: string, activity: any | null) => void
  setTurnErrorForThread: (threadId: string, message: string | null) => void
  setSelectedThreadId: (threadId: string) => void
  insertOptimisticThread: (threadId: string, cwd: string, firstMessageText: string) => void
  loadMessages: (threadId: string, options?: { silent?: boolean }) => Promise<void>
  loadThreads: () => Promise<void>
  syncFromNotifications: () => Promise<void>
  buildPendingTurnDetails: (modelId: string, effort: ReasoningEffort | '') => string[]
  buildProtocolTurnInput: (
    text: string,
    imageUrls: string[],
    skills: Array<{ name: string; path: string }>,
    fileAttachments: FileAttachment[],
  ) => Record<string, unknown>[]
  setPendingTurnRequest: (threadId: string, request: any) => void
  isUnsupportedChatGptModelError: (error: unknown) => boolean
  applyFallbackModelSelection: () => Promise<void>
  requestThreadTitleGeneration: (threadId: string, prompt: string, cwd: string | null) => Promise<void>
}) {
  const {
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
    modelFallbackId,
    isThreadInProgress,
    getLedgerThreadState,
    updateLedgerThreadState,
    clearLiveLedger,
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
  } = params

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
    if (resumedThreadById.value[threadId] !== true) await resumeThread(threadId)
    try {
      await startThreadTurnRaw(threadId, buildProtocolTurnInput(nextText, imageUrls, skills, fileAttachments), {
        model: modelId || undefined,
        effort: reasoningEffort || undefined,
        attachments: fileAttachments,
      })
    } catch (unknownError) {
      if (modelId && modelId !== modelFallbackId && isUnsupportedChatGptModelError(unknownError)) {
        await applyFallbackModelSelection()
        setPendingTurnRequest(threadId, {
          text: normalizedText,
          imageUrls: [...imageUrls],
          skills: normalizedSkills,
          fileAttachments: normalizedFileAttachments,
          effort: reasoningEffort,
          fallbackRetried: true,
        })
        await startThreadTurnRaw(threadId, buildProtocolTurnInput(nextText, imageUrls, skills, fileAttachments), {
          model: modelFallbackId,
          effort: reasoningEffort || undefined,
          attachments: fileAttachments,
        })
      } else {
        throw unknownError
      }
    }
    resumedThreadById.value = { ...resumedThreadById.value, [threadId]: true }
    pendingThreadMessageRefreshRef.value.add(threadId)
    pendingThreadsRefreshRef.value = true
    await syncFromNotifications()
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
    if (isThreadInProgress(threadId) && mode === 'queue') {
      const queue = queuedMessagesByThreadId.value[threadId] ?? []
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      queuedMessagesByThreadId.value = {
        ...queuedMessagesByThreadId.value,
        [threadId]: [...queue, { id, text: nextText, imageUrls, skills, fileAttachments }],
      }
      return
    }
    if (isThreadInProgress(threadId)) shouldAutoScrollRef.value = true
    isSendingMessage.value = true
    error.value = ''
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(threadId, {
      label: 'Thinking',
      details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value),
    })
    setTurnErrorForThread(threadId, null)
    updateLedgerThreadState(threadId, (current) => ({ ...current, phase: 'live' }))
    try {
      await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments)
    } catch (unknownError) {
      shouldAutoScrollRef.value = false
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
    } finally {
      isSendingMessage.value = false
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
        if (selectedModel && selectedModel !== modelFallbackId && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          threadId = await startThread(targetCwd || undefined, modelFallbackId)
        } else {
          throw unknownError
        }
      }
      if (!threadId) return ''
      insertOptimisticThread(threadId, targetCwd, nextText || '[Image]')
      resumedThreadById.value = { ...resumedThreadById.value, [threadId]: true }
      setSelectedThreadId(threadId)
      shouldAutoScrollRef.value = true
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, {
        label: 'Thinking',
        details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value),
      })
      setTurnErrorForThread(threadId, null)
      updateLedgerThreadState(threadId, (current) => ({ ...current, phase: 'live' }))
      void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments)
        .catch((unknownError) => {
          shouldAutoScrollRef.value = false
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
      void requestThreadTitleGeneration(threadId, nextText, targetCwd || null)
      return threadId
    } catch (unknownError) {
      shouldAutoScrollRef.value = false
      if (threadId) {
        updateLedgerThreadState(threadId, (current) => ({
          ...current,
          phase: current.phase === 'failed' ? 'failed' : 'settled',
          activeTurnId: '',
        }))
        setTurnActivityForThread(threadId, null)
        setTurnErrorForThread(threadId, unknownError instanceof Error ? unknownError.message : 'Unknown application error')
      }
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      isSendingMessage.value = false
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
    shouldAutoScrollRef.value = true
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(threadId, {
      label: 'Thinking',
      details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value),
    })
    setTurnErrorForThread(threadId, null)
    updateLedgerThreadState(threadId, (current) => ({ ...current, phase: 'live' }))
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
    if (!threadId || !isThreadInProgress(threadId)) return
    const turnId = getLedgerThreadState(threadId).activeTurnId
    isInterruptingTurn.value = true
    error.value = ''
    try {
      if (!turnId) throw new Error('turn/interrupt requires turnId')
      await interruptThreadTurnRaw(threadId, turnId)
      updateLedgerThreadState(threadId, (current) => ({
        ...current,
        phase: current.phase === 'failed' ? 'failed' : 'settled',
        activeTurnId: '',
      }))
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadMessageRefreshRef.value.add(threadId)
      pendingThreadsRefreshRef.value = true
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
    if (!threadId || isRollingBack.value) return
    const persisted = getLedgerThreadState(threadId).confirmedTranscript
    const maxTurnIndex = persisted.reduce((max, message) => (
      typeof message.turnIndex === 'number' && message.turnIndex > max ? message.turnIndex : max
    ), -1)
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
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadsRefreshRef.value = true
      await syncFromNotifications()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to rollback thread'
    } finally {
      isRollingBack.value = false
    }
  }

  return {
    sendMessageToSelectedThread,
    sendMessageToNewThread,
    startTurnForThread,
    processQueuedMessages,
    interruptSelectedThreadTurn,
    rollbackSelectedThread,
  }
}
