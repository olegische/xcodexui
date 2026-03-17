import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'

export type WasmThreadIndexEntry = {
  id: string
  cwd: string
  title: string
  createdAtIso: string
  updatedAtIso: string
  archived: boolean
  lastPreview: string
}

const DB_NAME = 'xcodexui-wasm'
const DB_VERSION = 1
const STORE_NAME = 'threads'

function nowIso(): string {
  return new Date().toISOString()
}

async function openDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('failed to open wasm thread index db'))
  })
}

export async function listIndexedThreads(): Promise<WasmThreadIndexEntry[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result as WasmThreadIndexEntry[] : []
      resolve(rows.sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso)))
    }
    request.onerror = () => reject(request.error ?? new Error('failed to list wasm threads'))
  })
}

export async function readIndexedThread(threadId: string): Promise<WasmThreadIndexEntry | null> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(threadId)
    request.onsuccess = () => resolve((request.result as WasmThreadIndexEntry | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error(`failed to read wasm thread ${threadId}`))
  })
}

export async function saveIndexedThread(entry: WasmThreadIndexEntry): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const request = tx.objectStore(STORE_NAME).put(entry, entry.id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`failed to save wasm thread ${entry.id}`))
  })
}

export async function patchIndexedThread(
  threadId: string,
  patch: Partial<WasmThreadIndexEntry>,
): Promise<WasmThreadIndexEntry> {
  const current =
    (await readIndexedThread(threadId)) ??
    {
      id: threadId,
      cwd: BROWSER_WORKSPACE_ROOT,
      title: 'Untitled thread',
      createdAtIso: nowIso(),
      updatedAtIso: nowIso(),
      archived: false,
      lastPreview: '',
    } satisfies WasmThreadIndexEntry
  const next: WasmThreadIndexEntry = {
    ...current,
    ...patch,
    id: threadId,
  }
  await saveIndexedThread(next)
  return next
}

export async function archiveIndexedThread(threadId: string): Promise<void> {
  await patchIndexedThread(threadId, {
    archived: true,
    updatedAtIso: nowIso(),
  })
}
