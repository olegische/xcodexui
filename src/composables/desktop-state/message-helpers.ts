import type { CommandExecutionData, ToolCallData, UiFileAttachment, UiMessage } from '../../types/codex'
import { IS_WASM_RUNTIME } from '../../config/runtime'
import type {
  FinalizedTurnSnapshotState,
  LiveTurnEvent,
  TurnActivityState,
  TurnSummaryState,
} from './types'

export function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null)
}

export function areToolCallsEqual(first?: ToolCallData, second?: ToolCallData): boolean {
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
    && areToolCallsEqual(first.toolCall, second.toolCall)
}

export function areMessageContentsEqual(first: UiMessage, second: UiMessage): boolean {
  return first.role === second.role
    && first.text === second.text
    && first.messageType === second.messageType
    && first.turnIndex === second.turnIndex
    && JSON.stringify(first.images ?? []) === JSON.stringify(second.images ?? [])
    && areFileAttachmentsEqual(first.fileAttachments, second.fileAttachments)
    && areCommandExecutionsEqual(first.commandExecution, second.commandExecution)
    && areToolCallsEqual(first.toolCall, second.toolCall)
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
  const maxIncomingTurnIndex = incoming.reduce((max, message) => (
    typeof message.turnIndex === 'number' ? Math.max(max, message.turnIndex) : max
  ), -1)

  for (const previousMessage of previous) {
    if (incoming.some((message) => areMessageFieldsEqual(message, previousMessage))) continue

    if (!isStructuredExecutionMessage(previousMessage)) {
      next.push(previousMessage)
      continue
    }

    const inferredMessage = withInferredTurnIndex(previousMessage, next, next.length, maxIncomingTurnIndex)
    const insertionIndex = findInsertionIndex(previous, next, previousMessage.id)
    const resolvedInsertionIndex = insertionIndex < next.length
      ? insertionIndex
      : (typeof inferredMessage.turnIndex === 'number'
          ? findTurnFallbackInsertionIndex(next, inferredMessage.turnIndex)
          : insertionIndex)
    next.splice(resolvedInsertionIndex, 0, inferredMessage)
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

function isStructuredExecutionMessage(message: UiMessage): boolean {
  return message.messageType === 'commandExecution' || message.messageType === 'toolCall'
}

function hasSameMessageId(messages: UiMessage[], messageId: string): boolean {
  return messages.some((message) => message.id === messageId)
}

function findTurnFallbackInsertionIndex(result: UiMessage[], turnIndex: number): number {
  let lastSameTurnIndex = -1
  let lastAssistantInTurnIndex = -1

  for (let index = 0; index < result.length; index += 1) {
    const message = result[index]
    if (message?.turnIndex === turnIndex) {
      lastSameTurnIndex = index
      if (message.role === 'assistant') lastAssistantInTurnIndex = index
      continue
    }
    if (typeof message?.turnIndex === 'number' && message.turnIndex > turnIndex) {
      return lastAssistantInTurnIndex >= 0 ? lastAssistantInTurnIndex : index
    }
  }

  if (lastAssistantInTurnIndex >= 0) return lastAssistantInTurnIndex
  if (lastSameTurnIndex >= 0) return lastSameTurnIndex + 1
  return result.length
}

function findInsertionIndex(reference: UiMessage[], result: UiMessage[], messageId: string): number {
  const referenceIndex = reference.findIndex((message) => message.id === messageId)
  if (referenceIndex === -1) return result.length

  for (let index = referenceIndex + 1; index < reference.length; index += 1) {
    const nextReferenceId = reference[index]?.id
    if (!nextReferenceId) continue
    const resultIndex = result.findIndex((message) => message.id === nextReferenceId)
    if (resultIndex !== -1) return resultIndex
  }

  for (let index = referenceIndex - 1; index >= 0; index -= 1) {
    const previousReferenceId = reference[index]?.id
    if (!previousReferenceId) continue
    const resultIndex = result.findIndex((message) => message.id === previousReferenceId)
    if (resultIndex !== -1) return resultIndex + 1
  }

  return result.length
}

function withInferredTurnIndex(message: UiMessage, result: UiMessage[], insertIndex: number, fallbackTurnIndex: number): UiMessage {
  if (typeof message.turnIndex === 'number') return message
  const nextTurnIndex = result[insertIndex]?.turnIndex
  if (typeof nextTurnIndex === 'number') return { ...message, turnIndex: nextTurnIndex }
  const previousTurnIndex = result[insertIndex - 1]?.turnIndex
  if (typeof previousTurnIndex === 'number') return { ...message, turnIndex: previousTurnIndex }
  return fallbackTurnIndex >= 0 ? { ...message, turnIndex: fallbackTurnIndex } : message
}

export function reconcileFinalizedMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  liveEvents: LiveTurnEvent[],
): UiMessage[] {
  const result = [...incoming]
  const maxIncomingTurnIndex = incoming.reduce((max, message) => (
    typeof message.turnIndex === 'number' ? Math.max(max, message.turnIndex) : max
  ), -1)
  const projectedLive = projectLiveTurnEvents(liveEvents)
  const references = [projectedLive, previous]

  for (const reference of references) {
    for (const message of reference) {
      if (!isStructuredExecutionMessage(message) || hasSameMessageId(result, message.id)) continue
      if (typeof message.turnIndex === 'number' && maxIncomingTurnIndex >= 0 && message.turnIndex > maxIncomingTurnIndex) continue
      const inferredMessage = withInferredTurnIndex(message, result, result.length, maxIncomingTurnIndex)
      const insertionIndex = findInsertionIndex(reference, result, message.id)
      const resolvedInsertionIndex = insertionIndex < result.length
        ? insertionIndex
        : (typeof inferredMessage.turnIndex === 'number'
            ? findTurnFallbackInsertionIndex(result, inferredMessage.turnIndex)
            : insertionIndex)
      result.splice(resolvedInsertionIndex, 0, inferredMessage)
    }
  }

  return areMessageArraysEqual(previous, result) ? previous : result
}

export function isWorkedMessage(message: UiMessage): boolean {
  return message.messageType === 'worked'
}

export function shouldPreserveFinalizedSnapshot(
  finalizedSnapshot: FinalizedTurnSnapshotState | null,
  confirmedTranscript: UiMessage[],
): boolean {
  if (!IS_WASM_RUNTIME || !finalizedSnapshot) return false
  const requiredMessages = finalizedSnapshot.messages.filter((message) =>
    isWorkedMessage(message) || message.messageType === 'toolCall' || message.messageType === 'commandExecution',
  )
  return requiredMessages.some((message) =>
    !confirmedTranscript.some((confirmed) => areMessageFieldsEqual(confirmed, message)),
  )
}

export function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  const next = { ...record }
  delete next[key]
  return next
}
