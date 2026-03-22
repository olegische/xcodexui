import {
  DEFAULT_CODEX_CONFIG,
  activeProviderApiKey,
  createIndexedDbCodexStorage,
  detectTransportMode,
  getActiveProvider,
  materializeCodexConfig,
  normalizeCodexConfig,
} from 'xcodex-runtime'
import type {
  AuthState,
  BrowserRuntimeStorage,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from 'xcodex-runtime/types'
import { getWasmRuntimePolicyPreset } from './presets'

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

function hasExplicitBrowserSecurity(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.allowed_origins)
    && typeof record.allow_localhost === 'boolean'
    && typeof record.allow_private_network === 'boolean'
}

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

async function readStorageValue<T>(storeName: string, key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null

  return await new Promise<T | null>((resolve, reject) => {
    const request = indexedDB.open(WASM_STORAGE_DB_NAME)

    request.onerror = () => reject(request.error ?? new Error(`failed to open ${WASM_STORAGE_DB_NAME}`))
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve(null)
        return
      }

      const transaction = db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const readRequest = store.get(key)

      readRequest.onsuccess = () => {
        db.close()
        resolve((readRequest.result as T | undefined) ?? null)
      }
      readRequest.onerror = () => {
        const error = readRequest.error ?? new Error(`failed to read ${storeName}`)
        db.close()
        reject(error)
      }
    }
  })
}

function shouldMigrateLegacyConfig(rawConfig: CodexCompatibleConfig | null): boolean {
  if (!rawConfig) return false

  const record = rawConfig as Record<string, unknown>
  return typeof record.runtime_mode !== 'string' || !hasExplicitBrowserSecurity(record.browser_security)
}

function migrateLegacyConfig(rawConfig: CodexCompatibleConfig): CodexCompatibleConfig {
  const normalized = normalizeCodexConfig(rawConfig)
  const provider = getActiveProvider(normalized)
  const preset = getWasmRuntimePolicyPreset(normalized.runtime_mode ?? 'default')

  return materializeCodexConfig({
    transportMode: detectTransportMode(normalized),
    model: normalized.model.trim(),
    runtimeMode: preset.runtimeMode,
    browserSecurity: preset.browserSecurity,
    modelReasoningEffort: normalized.modelReasoningEffort,
    personality: normalized.personality,
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: activeProviderApiKey(normalized),
    xrouterProvider: provider.metadata?.xrouterProvider ?? 'deepseek',
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

export async function loadStoredCodexConfig(): Promise<CodexCompatibleConfig> {
  const rawConfig = await readStorageValue<CodexCompatibleConfig>(STORE_NAMES.providerConfig, 'currentProviderConfig')
  if (!shouldMigrateLegacyConfig(rawConfig)) {
    return await storage.loadConfig()
  }

  const migratedConfig = migrateLegacyConfig(rawConfig!)
  await storage.saveConfig(migratedConfig)
  return migratedConfig
}

export const wasmRuntimeStorage: BrowserRuntimeStorage<
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata
> = {
  ...storage,
  loadConfig: loadStoredCodexConfig,
}

export const loadStoredThreadSession = storage.loadSession
export const saveStoredThreadSession = storage.saveSession
export const deleteStoredThreadSession = storage.deleteSession
export const listStoredThreadSessions = storage.listSessions
export const loadStoredAuthState = storage.loadAuthState
export const saveStoredAuthState = storage.saveAuthState
export const clearStoredAuthState = storage.clearAuthState
export const saveStoredCodexConfig = storage.saveConfig
export const clearStoredCodexConfig = storage.clearConfig
export const loadStoredUserConfig = storage.loadUserConfig
export const saveStoredUserConfig = storage.saveUserConfig
