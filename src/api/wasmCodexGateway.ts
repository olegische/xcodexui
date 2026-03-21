import type {
  ReasoningEffort,
  ThreadListResponse,
  ThreadReadResponse,
  ThreadRollbackResponse,
  ThreadSourceKind,
  ThreadStartResponse,
  TurnInterruptResponse,
  TurnStartResponse,
  UserInput,
} from './appServerDtos'
import type { RpcNotification } from './codexRpcClient'
import { normalizeThreadMessagesV2, readThreadInProgressFromResponse } from './normalizers/v2'
import type { UiMessage, UiProjectGroup } from '../types/codex'
import { BROWSER_WORKSPACE_ROOT } from '../config/runtime'
import { getWasmRuntimeContext } from '../runtime/wasm/runtime'
import {
  archiveIndexedThread,
  listIndexedThreads,
  patchIndexedThread,
  readIndexedThread,
  type WasmThreadIndexEntry,
} from '../runtime/wasm/threadIndex'
import * as wasmStorage from '../runtime/wasm/storage'

type CurrentModelConfig = {
  model: string
  reasoningEffort: ReasoningEffort | ''
}

type ThreadSearchResult = {
  threadIds: string[]
  indexedThreadCount: number
}

type SkillInfo = {
  name: string
  description: string
  path: string
  scope: string
  enabled: boolean
}

type WasmRuntimeRpcCaller = {
  requestTyped?: <T>(method: string, params: Record<string, unknown>) => Promise<T>
}

const THREAD_LIST_SOURCE_KINDS: ThreadSourceKind[] = [
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown',
]

function toIso(seconds: unknown): string {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString()
}

function toProjectName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts.at(-1) || cwd || 'workspace'
}

async function openWasmRuntimeDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open('codex-wasm-browser-terminal')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('failed to open wasm runtime db'))
  })
}

function buildTextWithAttachments(
  prompt: string,
  files: Array<{ label: string; path: string; fsPath: string }>,
): string {
  if (files.length === 0) return prompt
  let prefix = '# Files mentioned by the user:\n'
  for (const file of files) {
    prefix += `\n## ${file.label}: ${file.path}\n`
  }
  return `${prefix}\n## My request for Codex:\n\n${prompt}\n`
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | '' {
  const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  return typeof value === 'string' && allowed.includes(value as ReasoningEffort)
    ? value as ReasoningEffort
    : ''
}

async function callWasmRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { runtime } = await getWasmRuntimeContext()
  const caller = runtime as WasmRuntimeRpcCaller
  if (typeof caller.requestTyped !== 'function') {
    throw new Error(`wasm runtime does not support ${method}`)
  }
  return await caller.requestTyped<T>(method, params)
}

async function readStoredThreadSessionItemCount(threadId: string): Promise<number> {
  const db = await openWasmRuntimeDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('threadSessions', 'readonly')
    const request = tx.objectStore('threadSessions').get(threadId)
    request.onsuccess = () => {
      const session = request.result as { items?: unknown[] } | undefined
      resolve(Array.isArray(session?.items) ? session.items.length : 0)
    }
    request.onerror = () => reject(request.error ?? new Error(`failed to read wasm session ${threadId}`))
  })
}

function isStaleLoadedThreadPayload(payload: ThreadReadResponse): boolean {
  const turns = Array.isArray(payload.thread?.turns) ? payload.thread.turns : []
  return turns.length > 0
    && turns.every((turn) => Array.isArray(turn.items) && turn.items.length === 0)
    && turns.some((turn) => turn.status === 'inProgress')
}

type StoredSession = Awaited<ReturnType<typeof wasmStorage.loadStoredThreadSession>>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toStoredSessionPayload(session: NonNullable<StoredSession>): ThreadReadResponse {
  const turns: Array<{
    id: string
    status: 'completed'
    error: null
    items: Array<Record<string, unknown>>
  }> = []
  let currentTurn: typeof turns[number] | null = null

  const pushTurn = (turnId: string) => {
    currentTurn = {
      id: turnId,
      status: 'completed',
      error: null,
      items: [],
    }
    turns.push(currentTurn)
  }

  session?.items.forEach((item, index) => {
    const record = asRecord(item)
    if (!record) return
    if (record.type === 'turn_context') {
      const payload = asRecord(record.payload)
      const turnId = typeof payload?.turn_id === 'string' && payload.turn_id.length > 0
        ? payload.turn_id
        : `${session.metadata.threadId}:turn:${turns.length}`
      pushTurn(turnId)
      return
    }
    const payload = asRecord(record.payload)
    if (record.type !== 'response_item' || payload?.type !== 'message') return
    if (!currentTurn) pushTurn(`${session.metadata.threadId}:turn:0`)
    const messagePayload = payload as {
      role?: string
      content?: Array<Record<string, unknown>>
    }
    const content = Array.isArray(messagePayload.content) ? messagePayload.content : []
    if (messagePayload.role === 'user') {
      const text = content
        .filter((part) => part.type === 'input_text' && typeof part.text === 'string')
        .map((part) => String(part.text))
        .join('\n')
        .trim()
      if (!text) return
      currentTurn?.items.push({
        id: `${session.metadata.threadId}:stored:user:${index}`,
        type: 'userMessage',
        content: [{ type: 'text', text, text_elements: [] }],
      })
      return
    }
    if (messagePayload.role === 'assistant') {
      const text = content
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => String(part.text))
        .join('\n')
        .trim()
      if (!text) return
      currentTurn?.items.push({
        id: `${session.metadata.threadId}:stored:assistant:${index}`,
        type: 'agentMessage',
        text,
      })
    }
  })

  return {
    thread: {
      id: session.metadata.threadId,
      preview: session.metadata.preview,
      name: session.metadata.name ?? null,
      ephemeral: false,
      modelProvider: session.metadata.modelProvider,
      createdAt: session.metadata.createdAt,
      updatedAt: session.metadata.updatedAt,
      status: 'idle' as const,
      path: null,
      cwd: session.metadata.cwd,
      cliVersion: '',
      source: 'unknown',
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      turns,
    },
  } as unknown as ThreadReadResponse
}

function extractActualThreadId(snapshot: { metadata: unknown; threadId: string }): string {
  if (
    snapshot.metadata !== null &&
    typeof snapshot.metadata === 'object' &&
    !Array.isArray(snapshot.metadata) &&
    typeof (snapshot.metadata as Record<string, unknown>).id === 'string'
  ) {
    return (snapshot.metadata as Record<string, unknown>).id as string
  }
  return snapshot.threadId
}

function readTrimmedString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function pickPreviewAndTitle(
  thread: unknown,
  current?: Pick<WasmThreadIndexEntry, 'title' | 'lastPreview'> | null,
): { preview: string; title: string } {
  const record =
    thread !== null && typeof thread === 'object' && !Array.isArray(thread)
      ? thread as Record<string, unknown>
      : {}
  const preview = readTrimmedString(record, 'preview')
  const name = readTrimmedString(record, 'name')
  const preservedTitle = current?.title?.trim() ?? ''
  return {
    preview: preview || current?.lastPreview || '',
    title: name || preview || preservedTitle,
  }
}

async function syncThreadIndexFromThread(threadValue: unknown): Promise<WasmThreadIndexEntry> {
  const thread =
    threadValue !== null && typeof threadValue === 'object' && !Array.isArray(threadValue)
      ? threadValue as Record<string, unknown>
      : {}
  const actualThreadId =
    typeof thread.id === 'string' && thread.id.length > 0
      ? thread.id
      : extractActualThreadId({ threadId: 'thread', metadata: thread })
  const cwd = typeof thread.cwd === 'string' && thread.cwd.trim().length > 0
    ? thread.cwd.trim()
    : BROWSER_WORKSPACE_ROOT
  const createdAtIso = toIso(thread.createdAt)
  const updatedAtIso = toIso(thread.updatedAt)
  const currentEntry = actualThreadId ? await readIndexedThread(actualThreadId) : null
  const { preview, title } = pickPreviewAndTitle(thread, currentEntry)
  if (!currentEntry && !title && !preview) {
    return {
      id: actualThreadId,
      cwd,
      title: '',
      createdAtIso,
      updatedAtIso,
      archived: false,
      lastPreview: '',
    }
  }
  return await patchIndexedThread(actualThreadId, {
    cwd,
    title,
    createdAtIso,
    updatedAtIso,
    archived: false,
    lastPreview: preview,
  })
}

async function syncThreadIndexFromSnapshot(snapshot: { threadId: string; metadata: unknown }): Promise<WasmThreadIndexEntry> {
  return await syncThreadIndexFromThread(snapshot.metadata)
}

function groupIndexedThreads(entries: WasmThreadIndexEntry[]): UiProjectGroup[] {
  const visible = entries.filter((entry) => !entry.archived)
  const grouped = new Map<string, Array<typeof visible[number]>>()
  for (const entry of visible) {
    const projectName = toProjectName(entry.cwd)
    const rows = grouped.get(projectName)
    if (rows) rows.push(entry)
    else grouped.set(projectName, [entry])
  }
  return Array.from(grouped.entries())
    .map(([projectName, rows]) => ({
      projectName,
      threads: rows
        .sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso))
        .map((entry) => ({
          id: entry.id,
          title: entry.title || entry.lastPreview || 'Untitled thread',
          projectName,
          cwd: entry.cwd,
          hasWorktree: false,
          createdAtIso: entry.createdAtIso,
          updatedAtIso: entry.updatedAtIso,
          preview: entry.lastPreview,
          unread: false,
          inProgress: false,
        })),
    }))
    .sort((left, right) => {
      const leftTime = left.threads[0]?.updatedAtIso ?? ''
      const rightTime = right.threads[0]?.updatedAtIso ?? ''
      return rightTime.localeCompare(leftTime)
    })
}

export async function getThreadGroups(): Promise<UiProjectGroup[]> {
  await listThreadsRaw().catch(() => null)
  return groupIndexedThreads(await listIndexedThreads())
}

export async function getThreadMessages(threadId: string): Promise<UiMessage[]> {
  const detail = await getThreadDetail(threadId)
  return detail.messages
}

export async function getThreadDetail(threadId: string): Promise<{ messages: UiMessage[]; inProgress: boolean }> {
  const payload = await readThreadRaw(threadId)
  return {
    messages: normalizeThreadMessagesV2(payload),
    inProgress: readThreadInProgressFromResponse(payload),
  }
}

export function subscribeCodexNotifications(onNotification: (value: RpcNotification) => void): () => void {
  void getWasmRuntimeContext()
  const unsubscribePromise = getWasmRuntimeContext().then((context) => context.subscribe(onNotification))
  let settledUnsubscribe: (() => void) | null = null
  void unsubscribePromise.then((cleanup) => {
    settledUnsubscribe = cleanup
  })
  return () => {
    settledUnsubscribe?.()
  }
}

export async function replyToServerRequest(
  _id: number,
  _payload: { result?: unknown; error?: { code?: number; message: string } },
): Promise<void> {
  return
}

export async function getPendingServerRequests(): Promise<unknown[]> {
  return []
}

export async function resumeThread(threadId: string): Promise<void> {
  const { runtime } = await getWasmRuntimeContext()
  const response = await runtime.threadResume({
    threadId,
    persistExtendedHistory: true,
  })
  await syncThreadIndexFromThread(response.thread)
}

export async function archiveThread(threadId: string): Promise<void> {
  await callWasmRpc('thread/archive', { threadId })
  await archiveIndexedThread(threadId)
}

export async function renameThread(threadId: string, threadName: string): Promise<void> {
  await patchIndexedThread(threadId, {
    title: threadName.trim() || 'Untitled thread',
    updatedAtIso: new Date().toISOString(),
  })
}

export async function rollbackThread(threadId: string, _numTurns: number): Promise<UiMessage[]> {
  const payload = await rollbackThreadRaw(threadId, _numTurns)
  return normalizeThreadMessagesV2(payload)
}

export async function startThread(cwd?: string, model?: string): Promise<string> {
  const payload = await startThreadRaw(cwd, model)
  const entry = await syncThreadIndexFromThread(payload.thread)
  return entry.id
}

export async function startThreadTurn(
  threadId: string,
  text: string,
  _imageUrls: string[] = [],
  model?: string,
  effort?: ReasoningEffort,
  _skills?: Array<{ name: string; path: string }>,
  fileAttachments: Array<{ label: string; path: string; fsPath: string }> = [],
): Promise<void> {
  const payloadInput = buildProtocolTurnInput(text, _imageUrls, _skills ?? [], fileAttachments)
  await startThreadTurnRaw(threadId, payloadInput, {
    model,
    effort,
  })
  const payload = await readThreadRaw(threadId).catch(() => null)
  if (payload !== null) {
    await syncThreadIndexFromThread(payload.thread)
  }
}

function buildProtocolTurnInput(
  text: string,
  imageUrls: string[],
  skills: Array<{ name: string; path: string }>,
  fileAttachments: Array<{ label: string; path: string; fsPath: string }>,
): UserInput[] {
  const finalText = buildTextWithAttachments(text, fileAttachments)
  const input: UserInput[] = [{ type: 'text', text: finalText, text_elements: [] }]
  for (const imageUrl of imageUrls) {
    const normalizedUrl = imageUrl.trim()
    if (!normalizedUrl) continue
    input.push({
      type: 'image',
      url: normalizedUrl,
    })
  }
  for (const skill of skills) {
    input.push({ type: 'skill', name: skill.name, path: skill.path })
  }
  return input
}

export async function listThreadsRaw(): Promise<ThreadListResponse> {
  const { runtime } = await getWasmRuntimeContext()
  const payload = await runtime.threadList({
    archived: false,
    limit: 100,
    sortKey: 'updated_at',
    sourceKinds: THREAD_LIST_SOURCE_KINDS,
  })
  await Promise.all(payload.data.map(async (thread: unknown) => {
    await syncThreadIndexFromThread(thread)
  }))
  return payload
}

export async function readThreadRaw(threadId: string): Promise<ThreadReadResponse> {
  const { runtime } = await getWasmRuntimeContext()
  let payload: ThreadReadResponse
  try {
    payload = await runtime.threadRead({
      threadId,
      includeTurns: true,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('thread/read requires a loaded thread')) {
      const storedSession = await wasmStorage.loadStoredThreadSession(threadId).catch(() => null)
      if (storedSession) {
        payload = toStoredSessionPayload(storedSession)
      } else {
        throw error
      }
    } else {
      throw error
    }
  }
  if (isStaleLoadedThreadPayload(payload)) {
    const storedSession = await wasmStorage.loadStoredThreadSession(threadId).catch(() => null)
    const storedItemCount = Array.isArray(storedSession?.items) ? storedSession.items.length : 0
    if (storedItemCount > 0 && storedSession) {
      await callWasmRpc('thread/unsubscribe', { threadId }).catch(() => null)
      payload = toStoredSessionPayload(storedSession)
    }
  }
  await syncThreadIndexFromThread(payload.thread)
  return payload
}

export async function rollbackThreadRaw(threadId: string, numTurns: number): Promise<ThreadRollbackResponse> {
  const { runtime } = await getWasmRuntimeContext()
  const payload = await runtime.threadRollback({ threadId, numTurns })
  await syncThreadIndexFromThread(payload.thread)
  return payload
}

export async function startThreadRaw(cwd?: string, model?: string): Promise<ThreadStartResponse> {
  const { runtime } = await getWasmRuntimeContext()
  const payload = await runtime.threadStart({
    cwd: cwd?.trim() || BROWSER_WORKSPACE_ROOT,
    model: typeof model === 'string' && model.trim().length > 0 ? model.trim() : null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  })
  await syncThreadIndexFromThread(payload.thread)
  return payload
}

export async function startThreadTurnRaw(
  threadId: string,
  input: UserInput[],
  overrides?: { model?: string; effort?: ReasoningEffort },
): Promise<TurnStartResponse> {
  const context = await getWasmRuntimeContext()
  const currentConfig = await context.loadConfig()
  const nextConfig = {
    ...currentConfig,
    model: typeof overrides?.model === 'string' && overrides.model.trim().length > 0 ? overrides.model.trim() : currentConfig.model,
    modelReasoningEffort:
      typeof overrides?.effort === 'string' && overrides.effort.length > 0 ? overrides.effort : currentConfig.modelReasoningEffort,
  }
  await context.saveConfig(nextConfig)
  return await context.runtime.turnStart({
    threadId,
    input,
    model: nextConfig.model || null,
    effort: typeof nextConfig.modelReasoningEffort === 'string' && nextConfig.modelReasoningEffort.length > 0
      ? nextConfig.modelReasoningEffort as ReasoningEffort
      : null,
  })
}

export async function interruptThreadTurn(threadId: string, turnId?: string): Promise<void> {
  if (!turnId) return
  await interruptThreadTurnRaw(threadId, turnId)
}

export async function interruptThreadTurnRaw(threadId: string, turnId: string): Promise<TurnInterruptResponse> {
  const { runtime } = await getWasmRuntimeContext()
  return await runtime.turnInterrupt({ threadId, turnId })
}

export async function setDefaultModel(model: string): Promise<void> {
  const context = await getWasmRuntimeContext()
  const config = await context.loadConfig()
  await context.saveConfig({
    ...config,
    model: model.trim(),
  })
}

export async function getAvailableModelIds(): Promise<string[]> {
  const { runtime } = await getWasmRuntimeContext()
  const payload = await runtime.listModels({ cursor: null, limit: 200 })
  return payload.data.map((row: { id: string }) => row.id).filter(Boolean)
}

export async function getCurrentModelConfig(): Promise<CurrentModelConfig> {
  const context = await getWasmRuntimeContext()
  const config = await context.loadConfig()
  return {
    model: config.model ?? '',
    reasoningEffort: normalizeReasoningEffort(config.modelReasoningEffort),
  }
}

export async function getThreadTitleCache(): Promise<{ titles: Record<string, string>; order: string[] }> {
  const entries = await listIndexedThreads()
  return {
    titles: Object.fromEntries(entries.map((entry) => [entry.id, entry.title])),
    order: entries.map((entry) => entry.id),
  }
}

export async function persistThreadTitle(id: string, title: string): Promise<void> {
  await patchIndexedThread(id, { title: title.trim() || 'Untitled thread' })
}

export async function generateThreadTitle(_prompt: string, _cwd: string | null): Promise<string> {
  return ''
}

export async function searchThreads(query: string, limit = 200): Promise<ThreadSearchResult> {
  const normalized = query.trim().toLowerCase()
  const entries = await listIndexedThreads()
  if (!normalized) {
    return {
      threadIds: entries.filter((entry) => !entry.archived).slice(0, limit).map((entry) => entry.id),
      indexedThreadCount: entries.length,
    }
  }
  return {
    threadIds: entries
      .filter((entry) =>
        !entry.archived &&
        (entry.title.toLowerCase().includes(normalized) || entry.lastPreview.toLowerCase().includes(normalized)),
      )
      .slice(0, limit)
      .map((entry) => entry.id),
    indexedThreadCount: entries.length,
  }
}

export async function getSkillsList(_cwds?: string[]): Promise<SkillInfo[]> {
  return []
}
