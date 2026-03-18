import type { RpcNotification } from '../../api/codexGateway'
import type { CommandExecutionData, UiMessage, UiServerRequest } from '../../types/codex'
import type {
  TurnActivityState,
  TurnCompletedInfo,
  TurnStartedInfo,
} from './types'
import { parseIsoTimestamp } from './message-helpers'

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
  const normalized = server.replace(/^mcp__/u, '').replace(/__$/u, '').trim()
  return normalized ? `${titleCaseWords(normalized)} MCP` : 'MCP'
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

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function extractThreadIdFromNotification(notification: RpcNotification): string {
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
  return readString(turn?.threadId) || readString(turn?.thread_id)
}

export function readTurnErrorMessage(notification: RpcNotification): string {
  if (notification.method !== 'turn/completed') return ''
  const params = asRecord(notification.params)
  const turn = asRecord(params?.turn)
  if (!turn || turn.status !== 'failed') return ''
  return readString(asRecord(turn.error)?.message)
}

export function readNotificationErrorMessage(notification: RpcNotification): string {
  if (notification.method !== 'error') return ''
  const params = asRecord(notification.params)
  return readString(params?.message) || readString(asRecord(params?.error)?.message)
}

export function normalizeServerRequest(params: unknown, globalScope: string): UiServerRequest | null {
  const row = asRecord(params)
  if (!row) return null
  const id = row.id
  const method = readString(row.method)
  const requestParams = row.params
  if (typeof id !== 'number' || !Number.isInteger(id) || !method) return null
  const requestParamRecord = asRecord(requestParams)
  return {
    id,
    method,
    threadId: readString(requestParamRecord?.threadId) || globalScope,
    turnId: readString(requestParamRecord?.turnId),
    itemId: readString(requestParamRecord?.itemId),
    receivedAtIso: readString(row.receivedAtIso) || new Date().toISOString(),
    params: requestParams ?? null,
  }
}

export function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
  const threadId = extractThreadIdFromNotification(notification)
  if (!threadId) return null
  if (notification.method === 'turn/started') {
    return { threadId, activity: { label: 'Thinking', details: [] } }
  }
  if (notification.method === 'item/started') {
    const item = asRecord(asRecord(notification.params)?.item)
    const itemType = readString(item?.type).toLowerCase()
    if (itemType === 'reasoning') return { threadId, activity: { label: 'Thinking', details: [] } }
    if (itemType === 'agentmessage') return { threadId, activity: { label: 'Writing response', details: [] } }
    if (itemType === 'commandexecution') {
      const command = readString(item?.command)
      return { threadId, activity: { label: 'Running command', details: command ? [command] : [] } }
    }
    if (itemType === 'dynamictoolcall' || itemType === 'mcptoolcall') {
      return { threadId, activity: { label: 'Calling', details: [] } }
    }
  }
  if (notification.method === 'item/commandExecution/outputDelta') {
    return { threadId, activity: { label: 'Running command', details: [] } }
  }
  if (notification.method === 'item/reasoning/summaryTextDelta' || notification.method === 'item/reasoning/summaryPartAdded') {
    return { threadId, activity: { label: 'Thinking', details: [] } }
  }
  if (notification.method === 'item/agentMessage/delta') {
    return { threadId, activity: { label: 'Writing response', details: [] } }
  }
  return null
}

export function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
  if (notification.method !== 'turn/started') return null
  const params = asRecord(notification.params)
  const threadId = extractThreadIdFromNotification(notification)
  if (!params || !threadId) return null
  const turnPayload = asRecord(params.turn)
  const turnId = readString(turnPayload?.id) || readString(params.turnId) || `${threadId}:unknown`
  if (!turnId) return null
  return {
    threadId,
    turnId,
    startedAtMs:
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now(),
  }
}

export function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
  if (notification.method !== 'turn/completed') return null
  const params = asRecord(notification.params)
  const threadId = extractThreadIdFromNotification(notification)
  if (!params || !threadId) return null
  const turnPayload = asRecord(params.turn)
  const turnId = readString(turnPayload?.id) || readString(params.turnId) || `${threadId}:unknown`
  if (!turnId) return null
  return {
    threadId,
    turnId,
    completedAtMs:
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now(),
    startedAtMs:
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined,
  }
}

export function readReasoningStartedItemId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/started' || !params) return ''
  const item = asRecord(params.item)
  return item?.type === 'reasoning' ? readString(item.id) : ''
}

export function readReasoningDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/reasoning/summaryTextDelta' || !params) return null
  const itemId = readString(params.itemId)
  const delta = readString(params.delta)
  return itemId && delta ? { itemId, delta } : null
}

export function readReasoningSectionBreakItemId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/reasoning/summaryPartAdded' || !params) return ''
  return readString(params.itemId)
}

export function readReasoningCompletedItemId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/completed' || !params) return ''
  const item = asRecord(params.item)
  return item?.type === 'reasoning' ? readString(item.id) : ''
}

export function readAgentMessageStartedId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/started' || !params) return ''
  const item = asRecord(params.item)
  return item?.type === 'agentMessage' ? readString(item.id) : ''
}

export function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/agentMessage/delta' || !params) return null
  const messageId = readString(params.itemId)
  const delta = readString(params.delta)
  return messageId && delta ? { messageId, delta } : null
}

export function readAgentMessageCompleted(notification: RpcNotification): { itemId: string; text: string } | null {
  const params = asRecord(notification.params)
  if (notification.method !== 'item/completed' || !params) return null
  const item = asRecord(params.item)
  if (!item || item.type !== 'agentMessage') return null
  const itemId = readString(item.id)
  const text = readString(item.text)
  return itemId && text ? { itemId, text } : null
}

export function readCommandExecutionStarted(notification: RpcNotification): UiMessage | null {
  if (notification.method !== 'item/started') return null
  const item = asRecord(asRecord(notification.params)?.item)
  if (!item || item.type !== 'commandExecution') return null
  const id = readString(item.id)
  if (!id) return null
  const command = readString(item.command)
  const cwd = typeof item.cwd === 'string' ? item.cwd : null
  return {
    id,
    role: 'system',
    text: command,
    messageType: 'commandExecution',
    commandExecution: { command, cwd, status: 'inProgress', aggregatedOutput: '', exitCode: null },
  }
}

export function readCommandOutputDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
  if (notification.method !== 'item/commandExecution/outputDelta') return null
  const params = asRecord(notification.params)
  if (!params) return null
  const itemId = readString(params.itemId)
  const delta = readString(params.delta)
  return itemId && delta ? { itemId, delta } : null
}

export function readCommandExecutionCompleted(notification: RpcNotification): UiMessage | null {
  if (notification.method !== 'item/completed') return null
  const item = asRecord(asRecord(notification.params)?.item)
  if (!item || item.type !== 'commandExecution') return null
  const id = readString(item.id)
  if (!id) return null
  const command = readString(item.command)
  const cwd = typeof item.cwd === 'string' ? item.cwd : null
  const statusRaw = readString(item.status)
  const status: CommandExecutionData['status'] =
    statusRaw === 'failed' ? 'failed' : statusRaw === 'declined' ? 'declined' : statusRaw === 'interrupted' ? 'interrupted' : 'completed'
  return {
    id,
    role: 'system',
    text: command,
    messageType: 'commandExecution',
    commandExecution: {
      command,
      cwd,
      status,
      aggregatedOutput: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '',
      exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
    },
  }
}

export function readToolCallStarted(notification: RpcNotification): UiMessage | null {
  if (notification.method !== 'item/started') return null
  const item = asRecord(asRecord(notification.params)?.item)
  const itemType = readString(item?.type).toLowerCase()
  if (!item || (itemType !== 'dynamictoolcall' && itemType !== 'mcptoolcall')) return null
  const id = readString(item.id)
  return id ? { id, role: 'system', text: toolMessageText('calling', item), messageType: 'toolCall' } : null
}

export function readToolCallCompleted(notification: RpcNotification): UiMessage | null {
  if (notification.method !== 'item/completed') return null
  const item = asRecord(asRecord(notification.params)?.item)
  const itemType = readString(item?.type).toLowerCase()
  if (!item || (itemType !== 'dynamictoolcall' && itemType !== 'mcptoolcall')) return null
  const id = readString(item.id)
  return id ? { id, role: 'system', text: toolMessageText('called', item), messageType: 'toolCall' } : null
}

export function isAgentContentEvent(notification: RpcNotification): boolean {
  if (notification.method === 'item/agentMessage/delta') return true
  if (notification.method !== 'item/completed') return false
  return asRecord(asRecord(notification.params)?.item)?.type === 'agentMessage'
}

export function readNotificationThreadName(notification: RpcNotification): { threadId: string; threadName: string } | null {
  if (notification.method !== 'thread/name/updated') return null
  const params = asRecord(notification.params)
  const threadId = readString(params?.threadId)
  const threadName = readString(params?.threadName)
  return threadId && threadName ? { threadId, threadName } : null
}

export function readResolvedServerRequestId(notification: RpcNotification): number | null {
  if (notification.method !== 'server/request/resolved') return null
  const id = asRecord(notification.params)?.id
  return typeof id === 'number' && Number.isInteger(id) ? id : null
}
