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

function pickPreviewAndTitle(thread: unknown): { preview: string; title: string } {
  const record =
    thread !== null && typeof thread === 'object' && !Array.isArray(thread)
      ? thread as Record<string, unknown>
      : {}
  const preview = typeof record.preview === 'string' ? record.preview.trim() : ''
  return {
    preview,
    title: preview || 'Untitled thread',
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
  const { preview, title } = pickPreviewAndTitle(thread)
  const cwd = typeof thread.cwd === 'string' && thread.cwd.trim().length > 0
    ? thread.cwd.trim()
    : BROWSER_WORKSPACE_ROOT
  const createdAtIso = toIso(thread.createdAt)
  const updatedAtIso = toIso(thread.updatedAt)
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
          title: entry.title || 'Untitled thread',
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
  const payload = await runtime.threadRead({
    threadId,
    includeTurns: true,
  })
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
