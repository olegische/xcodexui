import {
  createIndexedDbRuntimeStorage,
  DEFAULT_CODEX_CONFIG,
  normalizeCodexConfig,
  PROVIDER_CONFIG_KEY,
  USER_CONFIG_STORAGE_KEY,
  type AuthState,
  type CodexCompatibleConfig,
} from '@browser-codex/wasm-runtime-client'
import type { StoredThreadSession, StoredThreadSessionMetadata } from '@browser-codex/wasm-runtime-core'

const storage = createIndexedDbRuntimeStorage<
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
    providerConfig: PROVIDER_CONFIG_KEY,
    userConfig: USER_CONFIG_STORAGE_KEY,
  },
  getSessionId(session) {
    return session.metadata.threadId
  },
  getSessionMetadata(session) {
    return session.metadata
  },
})

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
