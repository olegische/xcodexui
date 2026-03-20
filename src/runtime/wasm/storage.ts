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
