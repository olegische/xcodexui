import { DEFAULT_CODEX_CONFIG, PROVIDER_CONFIG_KEY, USER_CONFIG_STORAGE_KEY } from '@browser-codex/app-webui-runtime/constants'
import type { AuthState, CodexCompatibleConfig } from '@browser-codex/app-webui-runtime/types'
import type { StoredThreadSession, StoredThreadSessionMetadata } from '@browser-codex/wasm-runtime-core'
import { normalizeCodexConfig } from '@browser-codex/app-webui-runtime/utils'

const DB_NAME = 'codex-wasm-browser-terminal'
const DB_VERSION = 6

type StoredUserConfig = {
  filePath: string
  version: string
  content: string
}

async function openDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains('sessions')) db.deleteObjectStore('sessions')
      if (!db.objectStoreNames.contains('threadSessions')) db.createObjectStore('threadSessions')
      if (!db.objectStoreNames.contains('authState')) db.createObjectStore('authState')
      if (!db.objectStoreNames.contains('providerConfig')) db.createObjectStore('providerConfig')
      if (!db.objectStoreNames.contains('userConfig')) db.createObjectStore('userConfig')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('failed to open wasm browser db'))
  })
}

export async function loadStoredThreadSession(threadId: string): Promise<StoredThreadSession | null> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('threadSessions', 'readonly')
    const request = tx.objectStore('threadSessions').get(threadId)
    request.onsuccess = () => resolve((request.result as StoredThreadSession | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('failed to load thread session'))
  })
}

export async function saveStoredThreadSession(session: StoredThreadSession): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('threadSessions', 'readwrite')
    const request = tx.objectStore('threadSessions').put(session, session.metadata.threadId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to save thread session'))
  })
}

export async function deleteStoredThreadSession(threadId: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('threadSessions', 'readwrite')
    const request = tx.objectStore('threadSessions').delete(threadId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to delete thread session'))
  })
}

export async function listStoredThreadSessions(): Promise<StoredThreadSessionMetadata[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('threadSessions', 'readonly')
    const request = tx.objectStore('threadSessions').getAll()
    request.onsuccess = () => {
      const sessions = Array.isArray(request.result) ? request.result as StoredThreadSession[] : []
      resolve(sessions.map((session) => session.metadata))
    }
    request.onerror = () => reject(request.error ?? new Error('failed to list thread sessions'))
  })
}

export async function loadStoredAuthState(): Promise<AuthState | null> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('authState', 'readonly')
    const request = tx.objectStore('authState').get('current')
    request.onsuccess = () => resolve((request.result as AuthState | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('failed to load auth state'))
  })
}

export async function saveStoredAuthState(authState: AuthState): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('authState', 'readwrite')
    const request = tx.objectStore('authState').put(authState, 'current')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to save auth state'))
  })
}

export async function clearStoredAuthState(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('authState', 'readwrite')
    const request = tx.objectStore('authState').delete('current')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to clear auth state'))
  })
}

export async function loadStoredCodexConfig(): Promise<CodexCompatibleConfig> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('providerConfig', 'readonly')
    const request = tx.objectStore('providerConfig').get(PROVIDER_CONFIG_KEY)
    request.onsuccess = () =>
      resolve(normalizeCodexConfig((request.result as CodexCompatibleConfig | undefined) ?? DEFAULT_CODEX_CONFIG))
    request.onerror = () => reject(request.error ?? new Error('failed to load provider config'))
  })
}

export async function saveStoredCodexConfig(codexConfig: CodexCompatibleConfig): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('providerConfig', 'readwrite')
    const request = tx.objectStore('providerConfig').put(codexConfig, PROVIDER_CONFIG_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to save provider config'))
  })
}

export async function clearStoredCodexConfig(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('providerConfig', 'readwrite')
    const request = tx.objectStore('providerConfig').delete(PROVIDER_CONFIG_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('failed to clear provider config'))
  })
}

export async function loadStoredUserConfig(): Promise<StoredUserConfig | null> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('userConfig', 'readonly')
    const request = tx.objectStore('userConfig').get(USER_CONFIG_STORAGE_KEY)
    request.onsuccess = () => resolve((request.result as StoredUserConfig | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('failed to load user config'))
  })
}

export async function saveStoredUserConfig(input: {
  filePath?: string | null
  expectedVersion?: string | null
  content: string
}): Promise<StoredUserConfig> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('userConfig', 'readwrite')
    const store = tx.objectStore('userConfig')
    const readRequest = store.get(USER_CONFIG_STORAGE_KEY)
    readRequest.onerror = () => reject(readRequest.error ?? new Error('failed to read current user config'))
    readRequest.onsuccess = () => {
      const current = (readRequest.result as StoredUserConfig | undefined) ?? null
      if (
        input.expectedVersion !== null &&
        input.expectedVersion !== undefined &&
        current !== null &&
        current.version !== input.expectedVersion
      ) {
        reject(new Error(`user config version mismatch: expected ${input.expectedVersion}, got ${current.version}`))
        return
      }
      if (
        input.expectedVersion !== null &&
        input.expectedVersion !== undefined &&
        current === null &&
        input.expectedVersion !== '0'
      ) {
        reject(new Error(`user config version mismatch: expected ${input.expectedVersion}, got <missing>`))
        return
      }
      const nextVersion = current === null ? 1 : Number.parseInt(current.version, 10) + 1
      const next: StoredUserConfig = {
        filePath: input.filePath?.trim() || '/codex-home/config.toml',
        version: String(Number.isFinite(nextVersion) ? nextVersion : Date.now()),
        content: input.content,
      }
      const writeRequest = store.put(next, USER_CONFIG_STORAGE_KEY)
      writeRequest.onerror = () => reject(writeRequest.error ?? new Error('failed to save user config'))
      writeRequest.onsuccess = () => resolve(next)
    }
  })
}
