import {
  DEFAULT_CODEX_CONFIG,
  createIndexedDbCodexStorage,
  normalizeCodexConfig,
} from 'xcodex-runtime'
import type {
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from 'xcodex-runtime/types'

const WASM_STORAGE_DB_NAME = 'codex-wasm-browser-terminal'
const LEGACY_STORAGE_KEY = 'current'
const STORE_NAMES = {
  authState: 'authState',
  providerConfig: 'providerConfig',
  userConfig: 'userConfig',
} as const

const storage = createIndexedDbCodexStorage<
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata
>({
  dbName: 'codex-wasm-browser-terminal',
  dbVersion: 6,
  defaultConfig: DEFAULT_CODEX_CONFIG,
  normalizeConfig: normalizeCodexConfig,
  legacySessionStoreName: 'sessions',
  keys: {
    providerConfig: 'currentProviderConfig',
    userConfig: 'currentUserConfig',
  },
  getSessionId(session) {
    return session.metadata.threadId
  },
  getSessionMetadata(session) {
    return session.metadata
  },
})

async function withStorageStore(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(WASM_STORAGE_DB_NAME)

    request.onerror = () => reject(request.error ?? new Error(`failed to open ${WASM_STORAGE_DB_NAME}`))
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve()
        return
      }

      const transaction = db.transaction(storeName, mode)
      const store = transaction.objectStore(storeName)

      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => {
        const error = transaction.error ?? new Error(`failed to access ${storeName}`)
        db.close()
        reject(error)
      }
      transaction.onabort = () => {
        const error = transaction.error ?? new Error(`aborted while accessing ${storeName}`)
        db.close()
        reject(error)
      }

      run(store)
    }
  })
}

export async function clearLegacyStoredWasmRuntimeState(): Promise<void> {
  await Promise.all([
    withStorageStore(STORE_NAMES.authState, 'readwrite', (store) => {
      store.delete(LEGACY_STORAGE_KEY)
    }),
    withStorageStore(STORE_NAMES.providerConfig, 'readwrite', (store) => {
      store.delete(LEGACY_STORAGE_KEY)
    }),
    withStorageStore(STORE_NAMES.userConfig, 'readwrite', (store) => {
      store.delete(LEGACY_STORAGE_KEY)
    }),
  ])
}

export const loadStoredThreadSession = storage.loadSession
export const saveStoredThreadSession = storage.saveSession
export const deleteStoredThreadSession = storage.deleteSession
export const listStoredThreadSessions = storage.listSessions
export const loadStoredAuthState = storage.loadAuthState
export const saveStoredAuthState = storage.saveAuthState
export const clearStoredAuthState = storage.clearAuthState
export const loadStoredCodexConfig = storage.loadConfig
export const saveStoredCodexConfig = storage.saveConfig
export const clearStoredCodexConfig = storage.clearConfig
export const loadStoredUserConfig = storage.loadUserConfig
export const saveStoredUserConfig = storage.saveUserConfig
