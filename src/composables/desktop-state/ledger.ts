import type { Ref } from 'vue'
import type { UiMessage } from '../../types/codex'
import { mergeMessages } from './message-helpers'
import type {
  ChatPhase,
  LedgerThreadState,
  LiveTextSegmentState,
  LiveTurnEvent,
} from './types'

export function defaultLedgerThreadState(): LedgerThreadState {
  return {
    phase: 'idle',
    confirmedTranscript: [],
    liveEventLog: [],
    activeTurnId: '',
    activeSegment: null,
    nextSegmentCount: 0,
  }
}

export function createDesktopLedger(params: {
  ledgerByThreadId: Ref<Record<string, LedgerThreadState>>
  onPhaseChange?: () => void
}) {
  const { ledgerByThreadId, onPhaseChange } = params

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
      onPhaseChange?.()
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
        activeTurnId: options.inProgress ? current.activeTurnId : '',
        activeSegment: options.inProgress ? current.activeSegment : null,
      }
    })
  }

  function clearActiveLiveTextSegment(threadId: string): void {
    updateLedgerThreadState(threadId, (current) =>
      current.activeSegment ? { ...current, activeSegment: null } : current,
    )
  }

  function appendLiveTextSegment(
    threadId: string,
    kind: LiveTextSegmentState['kind'],
    itemId: string,
    delta: string,
  ): void {
    if (!delta) return
    updateLedgerThreadState(threadId, (current) => {
      const activeSegment = current.activeSegment
      const segmentId =
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
        liveEventLog: [...current.liveEventLog, { type: 'text_delta', kind, itemId, segmentId, delta }],
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

  function clearLiveLedger(threadId: string): void {
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      liveEventLog: [],
      activeSegment: null,
    }))
  }

  function appendLiveEvent(threadId: string, event: LiveTurnEvent): void {
    updateLedgerThreadState(threadId, (current) => ({
      ...current,
      phase: current.phase === 'finalizing' ? 'finalizing' : 'live',
      liveEventLog: [...current.liveEventLog, event],
    }))
  }

  return {
    getLedgerThreadState,
    isThreadInProgress,
    updateLedgerThreadState,
    setConfirmedTranscriptForThread,
    clearActiveLiveTextSegment,
    appendLiveTextSegment,
    hasLiveTextSegmentsForItem,
    clearLiveLedger,
    appendLiveEvent,
  }
}
