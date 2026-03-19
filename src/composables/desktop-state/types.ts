import type {
  CommandExecutionData,
  ReasoningEffort,
  ThreadScrollState,
  UiFileAttachment,
} from '../../types/codex'

export type FileAttachment = { label: string; path: string; fsPath: string }

export type QueuedMessage = {
  id: string
  text: string
  imageUrls: string[]
  skills: Array<{ name: string; path: string }>
  fileAttachments: FileAttachment[]
}

export type PendingTurnRequest = {
  text: string
  imageUrls: string[]
  skills: Array<{ name: string; path: string }>
  fileAttachments: FileAttachment[]
  effort: ReasoningEffort | ''
  fallbackRetried: boolean
}

export type TurnSummaryState = {
  turnId: string
  durationMs: number
}

export type TurnActivityState = {
  label: string
  details: string[]
}

export type TurnErrorState = {
  message: string
}

export type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

export type TurnCompletedInfo = {
  threadId: string
  turnId: string
  completedAtMs: number
  startedAtMs?: number
}

export type LiveTextSegmentState = {
  kind: 'assistant' | 'reasoning'
  itemId: string
  segmentId: string
}

export type ChatPhase = 'idle' | 'live' | 'finalizing' | 'settled' | 'failed'

export type LiveTurnEvent =
  | { type: 'text_delta'; kind: LiveTextSegmentState['kind']; itemId: string; segmentId: string; delta: string }
  | { type: 'command_snapshot'; message: UiMessage }
  | { type: 'tool_snapshot'; message: UiMessage }
  | { type: 'command_output_delta'; itemId: string; delta: string }

export type LedgerThreadState = {
  phase: ChatPhase
  confirmedTranscript: UiMessage[]
  liveEventLog: LiveTurnEvent[]
  activeTurnId: string
  activeSegment: LiveTextSegmentState | null
  nextSegmentCount: number
}

export type DesktopThreadStateMaps = {
  readStateByThreadId: Record<string, string>
  scrollStateByThreadId: Record<string, ThreadScrollState>
  turnSummaryByThreadId: Record<string, TurnSummaryState>
  turnActivityByThreadId: Record<string, TurnActivityState>
  turnErrorByThreadId: Record<string, TurnErrorState>
  ledgerByThreadId: Record<string, LedgerThreadState>
}

export type { CommandExecutionData, ThreadScrollState, UiFileAttachment }
