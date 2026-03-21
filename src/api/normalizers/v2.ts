import type {
  Thread,
  ThreadItem,
  ThreadReadResponse,
  ThreadListResponse,
  Turn,
  UserInput,
} from '../appServerDtos'
import type { CommandExecutionData, ToolCallData, UiFileAttachment, UiMessage, UiProjectGroup, UiThread } from '../../types/codex'

function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

function toProjectName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts.at(-1) || cwd || 'unknown-project'
}

function toRawPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const FILE_ATTACHMENT_LINE = /^##\s+(.+?):\s+(.+?)\s*$/
const FILES_MENTIONED_MARKER = /^#\s*files mentioned by the user\s*:?\s*$/i

function extractFileAttachments(value: string): UiFileAttachment[] {
  const markerIdx = value.split('\n').findIndex((line) => FILES_MENTIONED_MARKER.test(line.trim()))
  if (markerIdx < 0) return []
  const lines = value.split('\n').slice(markerIdx + 1)
  const attachments: UiFileAttachment[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(FILE_ATTACHMENT_LINE)
    if (!m) break
    const label = m[1]?.trim()
    const path = m[2]?.trim().replace(/\s+\((?:lines?\s+\d+(?:-\d+)?)\)\s*$/, '')
    if (label && path) attachments.push({ label, path })
  }
  return attachments
}

function extractCodexUserRequestText(value: string): string {
  const markerRegex = /(?:^|\n)\s{0,3}#{0,6}\s*my request for codex\s*:?\s*/giu
  const matches = Array.from(value.matchAll(markerRegex))
  if (matches.length === 0) {
    return value.trim()
  }

  const lastMatch = matches.at(-1)
  if (!lastMatch || typeof lastMatch.index !== 'number') {
    return value.trim()
  }

  const markerOffset = lastMatch.index + lastMatch[0].length
  return value.slice(markerOffset).trim()
}

function parseUserMessageContent(
  itemId: string,
  content: UserInput[] | undefined,
): { text: string; images: string[]; fileAttachments: UiFileAttachment[]; rawBlocks: UiMessage[] } {
  if (!Array.isArray(content)) return { text: '', images: [], fileAttachments: [], rawBlocks: [] }

  const textChunks: string[] = []
  const images: string[] = []
  const rawBlocks: UiMessage[] = []

  for (const [index, block] of content.entries()) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      textChunks.push(block.text)
    }
    if (block.type === 'image' && typeof block.url === 'string' && block.url.trim().length > 0) {
      images.push(block.url.trim())
    }

    if (block.type !== 'text' && block.type !== 'image') {
      rawBlocks.push({
        id: `${itemId}:user-content:${index}`,
        role: 'user',
        text: '',
        messageType: `userContent.${block.type}`,
        rawPayload: toRawPayload(block),
        isUnhandled: true,
      })
    }
  }

  const fullText = textChunks.join('\n')
  const fileAttachments = extractFileAttachments(fullText)

  return {
    text: extractCodexUserRequestText(fullText),
    images,
    fileAttachments,
    rawBlocks,
  }
}

function formatMcpServerLabel(server: string): string {
  if (!server) return 'server'
  return server
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function readToolCallDetails(item: ThreadItem): string[] {
  if (item.type === 'dynamicToolCall') {
    return item.tool ? [item.tool] : []
  }

  if (item.type === 'mcpToolCall') {
    if (item.tool && item.server) return [`${item.tool} tool from ${formatMcpServerLabel(item.server)}`]
    if (item.tool) return [item.tool]
  }

  return []
}

function toolMessageText(item: ThreadItem): string {
  const subject = readToolCallDetails(item)[0] ?? (readString((item as Record<string, unknown>).tool) || 'tool')
  const status = readString((item as Record<string, unknown>).status)
  return status === 'inProgress' ? `Calling ${subject}` : `Called ${subject}`
}

function toUiMessages(item: ThreadItem): UiMessage[] {
  if (item.type === 'agentMessage') {
    return [
      {
        id: item.id,
        role: 'assistant',
        text: item.text,
        messageType: item.type,
      },
    ]
  }

  if (item.type === 'userMessage') {
    const parsed = parseUserMessageContent(item.id, item.content as UserInput[] | undefined)
    const messages: UiMessage[] = []
    const hasRenderableUserContent = parsed.text.length > 0 || parsed.images.length > 0 || parsed.fileAttachments.length > 0

    if (hasRenderableUserContent) {
      messages.push({
        id: item.id,
        role: 'user',
        text: parsed.text,
        images: parsed.images,
        fileAttachments: parsed.fileAttachments.length > 0 ? parsed.fileAttachments : undefined,
        messageType: item.type,
      })
    }

    messages.push(...parsed.rawBlocks)
    if (messages.length === 0) {
      return []
    }

    return messages
  }

  if (item.type === 'reasoning') {
    return []
  }

  if (item.type === 'commandExecution') {
    const raw = item as Record<string, unknown>
    const status = normalizeCommandStatus(raw.status)
    const cmd = typeof raw.command === 'string' ? raw.command : ''
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : null
    const aggregatedOutput = typeof raw.aggregatedOutput === 'string' ? raw.aggregatedOutput : ''
    const exitCode = typeof raw.exitCode === 'number' ? raw.exitCode : null
    return [
      {
        id: item.id,
        role: 'system' as const,
        text: cmd,
        messageType: 'commandExecution',
        commandExecution: { command: cmd, cwd, status, aggregatedOutput, exitCode },
      },
    ]
  }

  if (item.type === 'dynamicToolCall' || item.type === 'mcpToolCall') {
    const toolCall = normalizeToolCall(item)
    return [
      {
        id: item.id,
        role: 'system',
        text: toolMessageText(item),
        messageType: 'toolCall',
        toolCall,
      },
    ]
  }

  return []
}

function normalizeToolCall(item: ThreadItem): ToolCallData {
  const raw = item as Record<string, unknown>
  const kind = item.type === 'mcpToolCall' ? 'mcp' : 'dynamic'
  const tool = typeof raw.tool === 'string' ? raw.tool : '(tool)'
  const server = typeof raw.server === 'string' ? raw.server : null
  const status = normalizeToolStatus(raw.status)
  const argumentsText = stringifyToolPayload(raw.arguments)

  if (kind === 'mcp') {
    const result = stringifyToolPayload(raw.result)
    const error = stringifyToolPayload(raw.error)
    return {
      kind,
      tool,
      server,
      status,
      argumentsText,
      outputText: result || error,
    }
  }

  const contentItems = Array.isArray(raw.contentItems) ? raw.contentItems : []
  return {
    kind,
    tool,
    server,
    status,
    argumentsText,
    outputText: stringifyDynamicToolContent(contentItems),
  }
}

function normalizeToolStatus(value: unknown): ToolCallData['status'] {
  if (value === 'inProgress' || value === 'in_progress') return 'inProgress'
  if (value === 'failed') return 'failed'
  return 'completed'
}

function stringifyToolPayload(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringifyDynamicToolContent(items: unknown[]): string {
  const chunks = items.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (record.type === 'inputText' && typeof record.text === 'string') return [record.text]
    if (record.type === 'inputImage' && typeof record.imageUrl === 'string') return [`[image] ${record.imageUrl}`]
    return []
  })
  return chunks.join('\n\n')
}

function normalizeCommandStatus(value: unknown): CommandExecutionData['status'] {
  if (value === 'completed' || value === 'failed' || value === 'declined' || value === 'interrupted') return value
  if (value === 'inProgress' || value === 'in_progress') return 'inProgress'
  return 'completed'
}

function pickThreadName(summary: Thread): string {
  const rawSummary = summary as Record<string, unknown>
  const direct = [
    typeof rawSummary.name === 'string' ? rawSummary.name : '',
    summary.preview,
  ]
  for (const candidate of direct) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return ''
}

function toThreadTitle(summary: Thread): string {
  const named = pickThreadName(summary)
  return named.length > 0 ? named : 'Untitled thread'
}

function isTurnInProgress(turn: Turn | null | undefined): boolean {
  return turn?.status === 'inProgress'
}

function readThreadInProgress(summary: Thread): boolean {
  const rawSummary = summary as Record<string, unknown>
  if (rawSummary.inProgress === true) return true
  if (rawSummary.status === 'inProgress' || rawSummary.turnStatus === 'inProgress') return true

  const turns = Array.isArray(summary.turns) ? summary.turns : []
  const lastTurn = turns.at(-1)
  return isTurnInProgress(lastTurn)
}

function toUiThread(summary: Thread): UiThread {
  const rawSummary = summary as Record<string, unknown>
  const cwd = typeof rawSummary.cwd === 'string' ? rawSummary.cwd : summary.cwd
  const hasWorktree =
    rawSummary.isWorktree === true ||
    rawSummary.worktree === true ||
    rawSummary.worktreeId !== undefined ||
    rawSummary.worktreePath !== undefined ||
    cwd.includes('/.codex/worktrees/') ||
    cwd.includes('/.git/worktrees/')

  return {
    id: summary.id,
    title: toThreadTitle(summary),
    projectName: toProjectName(summary.cwd),
    cwd: summary.cwd,
    hasWorktree,
    createdAtIso: toIso(summary.createdAt),
    updatedAtIso: toIso(summary.updatedAt),
    preview: summary.preview,
    unread: false,
    inProgress: readThreadInProgress(summary),
  }
}

function groupThreadsByProject(threads: UiThread[]): UiProjectGroup[] {
  const grouped = new Map<string, UiThread[]>()
  for (const thread of threads) {
    const rows = grouped.get(thread.projectName)
    if (rows) rows.push(thread)
    else grouped.set(thread.projectName, [thread])
  }

  return Array.from(grouped.entries())
    .map(([projectName, projectThreads]) => ({
      projectName,
      threads: projectThreads.sort(
        (a, b) => new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
      ),
    }))
    .sort((a, b) => {
      const aLast = new Date(a.threads[0]?.updatedAtIso ?? 0).getTime()
      const bLast = new Date(b.threads[0]?.updatedAtIso ?? 0).getTime()
      return bLast - aLast
    })
}

export function normalizeThreadGroupsV2(payload: ThreadListResponse): UiProjectGroup[] {
  const uiThreads = payload.data.map(toUiThread)
  return groupThreadsByProject(uiThreads)
}

export function normalizeThreadMessagesV2(payload: ThreadReadResponse): UiMessage[] {
  const turns = Array.isArray(payload.thread.turns) ? payload.thread.turns : []
  const messages: UiMessage[] = []
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex]
    const items = Array.isArray(turn.items) ? turn.items : []
    for (const item of items) {
      for (const msg of toUiMessages(item)) {
        messages.push({ ...msg, turnIndex })
      }
    }
  }
  return dedupeAdjacentUserMessages(messages)
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameFileAttachments(
  left: UiFileAttachment[] | undefined,
  right: UiFileAttachment[] | undefined,
): boolean {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((file, index) =>
    file.label === b[index]?.label && file.path === b[index]?.path)
}

function isDuplicateAdjacentUserMessage(previous: UiMessage | undefined, current: UiMessage): boolean {
  if (!previous || previous.role !== 'user' || current.role !== 'user') return false
  if (previous.turnIndex !== current.turnIndex) return false
  if (previous.text !== current.text) return false
  if (!sameStringArray(previous.images, current.images)) return false
  if (!sameFileAttachments(previous.fileAttachments, current.fileAttachments)) return false
  return previous.messageType === 'userMessage' && current.messageType === 'userMessage'
}

function dedupeAdjacentUserMessages(messages: UiMessage[]): UiMessage[] {
  const deduped: UiMessage[] = []
  for (const message of messages) {
    if (isDuplicateAdjacentUserMessage(deduped.at(-1), message)) continue
    deduped.push(message)
  }
  return deduped
}

export function readThreadInProgressFromResponse(payload: ThreadReadResponse): boolean {
  const turns = Array.isArray(payload.thread.turns) ? payload.thread.turns : []
  return isTurnInProgress(turns.at(-1))
}
