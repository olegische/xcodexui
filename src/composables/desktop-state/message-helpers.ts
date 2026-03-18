import type { CommandExecutionData, UiFileAttachment, UiMessage } from '../../types/codex'
import type {
  FinalizedTurnSnapshotState,
  LiveTurnEvent,
  TurnActivityState,
  TurnSummaryState,
} from './types'

export function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null)
}

export function normalizeMessageText(value: string): string {
  return value.replace(/\r\n/gu, '\n').trim()
}

export function areFileAttachmentsEqual(first?: UiFileAttachment[], second?: UiFileAttachment[]): boolean {
  const left = first ?? []
  const right = second ?? []
  return left.length === right.length && left.every((file, index) =>
    file.label === right[index]?.label && file.path === right[index]?.path,
  )
}

export function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return first.id === second.id
    && first.role === second.role
    && first.text === second.text
    && first.messageType === second.messageType
    && first.turnIndex === second.turnIndex
    && JSON.stringify(first.images ?? []) === JSON.stringify(second.images ?? [])
    && areFileAttachmentsEqual(first.fileAttachments, second.fileAttachments)
    && areCommandExecutionsEqual(first.commandExecution, second.commandExecution)
}

export function areMessageContentsEqual(first: UiMessage, second: UiMessage): boolean {
  return first.role === second.role
    && first.text === second.text
    && first.messageType === second.messageType
    && first.turnIndex === second.turnIndex
    && JSON.stringify(first.images ?? []) === JSON.stringify(second.images ?? [])
    && areFileAttachmentsEqual(first.fileAttachments, second.fileAttachments)
    && areCommandExecutionsEqual(first.commandExecution, second.commandExecution)
}

export function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  return first.length === second.length && first.every((message, index) => areMessageFieldsEqual(message, second[index]))
}

export function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean } = {},
): UiMessage[] {
  if (!options.preserveMissing) return areMessageArraysEqual(previous, incoming) ? previous : incoming
  const next = [...incoming]
  for (const previousMessage of previous) {
    if (!incoming.some((message) => areMessageFieldsEqual(message, previousMessage))) next.push(previousMessage)
  }
  return next
}

export function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const lastPersistedAssistant = [...previous].reverse().find((message) => message.role === 'assistant')
  if (!lastPersistedAssistant) return incoming
  return incoming.filter((message) => !(message.role === 'assistant' && message.text === lastPersistedAssistant.text))
}

export function buildTextWithAttachments(
  prompt: string,
  files: Array<{ label: string; path: string; fsPath: string }>,
): string {
  if (files.length === 0) return prompt
  let prefix = '# Files mentioned by the user:\n'
  for (const file of files) prefix += `\n## ${file.label}: ${file.path}\n`
  return `${prefix}\n## My request for Codex:\n\n${prompt}\n`
}

export function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const index = previous.findIndex((message) => message.id === nextMessage.id)
  if (index === -1) return [...previous, nextMessage]
  if (areMessageFieldsEqual(previous[index], nextMessage)) return previous
  const next = [...previous]
  next.splice(index, 1, nextMessage)
  return next
}

export function parseIsoTimestamp(value: string): number | null {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function formatTurnDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = seconds % 60
  return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`
}

export function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  return first?.turnId === second?.turnId && first?.durationMs === second?.durationMs
}

export function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  return first?.label === second?.label && JSON.stringify(first?.details ?? []) === JSON.stringify(second?.details ?? [])
}

export function buildTurnSummaryMessage(summary: TurnSummaryState): UiMessage {
  return { id: `turn-summary:${summary.turnId}`, role: 'system', text: `Worked for ${formatTurnDuration(summary.durationMs)}`, messageType: 'worked' }
}

export function findLastAssistantMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index
  }
  return -1
}

export function insertTurnSummaryMessage(messages: UiMessage[], summary: TurnSummaryState): UiMessage[] {
  const summaryMessage = buildTurnSummaryMessage(summary)
  const assistantIndex = findLastAssistantMessageIndex(messages)
  if (assistantIndex === -1) return [...messages, summaryMessage]
  const next = [...messages]
  next.splice(assistantIndex, 0, summaryMessage)
  return next
}

export function projectLiveTurnEvents(events: LiveTurnEvent[]): UiMessage[] {
  const projected: UiMessage[] = []
  for (const event of events) {
    if (event.type === 'text_delta') {
      const current = projected.find((message) => message.id === event.segmentId)
      const role = event.kind === 'assistant' ? 'assistant' : 'system'
      const messageType = event.kind === 'assistant' ? 'agentMessage' : 'reasoning.live'
      const text = (current?.text ?? '') + event.delta
      const nextMessage: UiMessage = { id: event.segmentId, role, text, messageType }
      const nextProjected = upsertMessage(projected, nextMessage)
      projected.splice(0, projected.length, ...nextProjected)
      continue
    }
    if (event.type === 'command_snapshot' || event.type === 'tool_snapshot') {
      const nextProjected = upsertMessage(projected, event.message)
      projected.splice(0, projected.length, ...nextProjected)
      continue
    }
    if (event.type === 'command_output_delta') {
      const existing = projected.find((message) => message.id === event.itemId)
      if (!existing?.commandExecution) continue
      const nextProjected = upsertMessage(projected, {
        ...existing,
        commandExecution: {
          ...existing.commandExecution,
          aggregatedOutput: `${existing.commandExecution.aggregatedOutput}${event.delta}`,
        },
      })
      projected.splice(0, projected.length, ...nextProjected)
    }
  }
  return removeRedundantLiveAgentMessages([], projected)
}

export function isWorkedMessage(message: UiMessage): boolean {
  return message.messageType === 'worked'
}

export function shouldPreserveFinalizedSnapshot(
  finalizedSnapshot: FinalizedTurnSnapshotState | null,
  confirmedTranscript: UiMessage[],
): boolean {
  if (!finalizedSnapshot) return false
  const workedMessages = finalizedSnapshot.messages.filter((message) => isWorkedMessage(message) || message.messageType === 'toolCall' || message.messageType === 'commandExecution')
  return workedMessages.some((message) => !confirmedTranscript.some((confirmed) => areMessageFieldsEqual(confirmed, message)))
}

export function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  const next = { ...record }
  delete next[key]
  return next
}
