import {
  createBrowserCodexRuntimeContext,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_DEMO_INSTRUCTIONS,
  activeProviderApiKey,
  formatError,
  getActiveProvider,
} from 'xcodex-runtime'
import { createIndexedDbCodexStorage } from 'xcodex-runtime/storage'
import { createLocalStorageWorkspaceAdapter } from 'xcodex-runtime/workspace'
import type {
  AuthState,
  BrowserCodexProtocolClient,
  BrowserRuntimeContext,
  BrowserRuntimeStorage,
  CodexCompatibleConfig,
  ModelPreset,
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from 'xcodex-runtime/types'
import type { RpcNotification } from '../../api/codexRpcClient'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'

type WasmBrowserRuntime = BrowserCodexProtocolClient & {
  loadAuthState(): Promise<AuthState | null>
  saveAuthState(authState: AuthState): Promise<void>
  clearAuthState(): Promise<void>
  listModels(request: { cursor: string | null; limit: number | null }): Promise<{
    data: ModelPreset[]
    nextCursor: string | null
  }>
}

type WasmRuntimeContext = {
  runtime: WasmBrowserRuntime
  loadConfig: () => Promise<CodexCompatibleConfig>
  saveConfig: (config: CodexCompatibleConfig) => Promise<void>
  subscribe: (listener: (notification: RpcNotification) => void) => () => void
}
let runtimeContextPromise: Promise<WasmRuntimeContext> | null = null

const storage: BrowserRuntimeStorage<
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata
> = createIndexedDbCodexStorage({
  dbName: 'codex-wasm-browser-terminal',
  dbVersion: 6,
  defaultConfig: DEFAULT_CODEX_CONFIG,
  normalizeConfig(config) {
    return structuredClone(config)
  },
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

export async function getWasmRuntimeContext(): Promise<WasmRuntimeContext> {
  if (runtimeContextPromise) {
    return await runtimeContextPromise
  }

  runtimeContextPromise = (async () => {
    const context = await createBrowserCodexRuntimeContext({
      cwd: BROWSER_WORKSPACE_ROOT,
      storage,
      workspace: createLocalStorageWorkspaceAdapter({
        rootPath: BROWSER_WORKSPACE_ROOT,
      }),
      bootstrap: {
        baseInstructions: DEFAULT_DEMO_INSTRUCTIONS.baseInstructions,
        developerInstructions: null,
        userInstructions: null,
        ephemeral: false,
      },
      readAccount: async ({ authState, config }) => {
        const provider = getActiveProvider(config)
        const apiKey =
          authState?.authMode === 'apiKey' && authState.openaiApiKey !== null
            ? authState.openaiApiKey
            : activeProviderApiKey(config)
        if (apiKey.trim().length === 0) {
          return {
            account: null,
            requiresOpenaiAuth: provider.providerKind === 'openai',
          }
        }
        return {
          account: {
            email: null,
            planType: authState?.chatgptPlanType ?? null,
            chatgptAccountId: authState?.chatgptAccountId ?? null,
            authMode: authState?.authMode ?? null,
          },
          requiresOpenaiAuth: false,
        }
      },
      requestUserInput: async () => ({ answers: [] }),
    })

    const runtime = context.runtime as WasmBrowserRuntime

    return {
      runtime,
      loadConfig: context.loadConfig,
      saveConfig: context.saveConfig,
      subscribe(listener) {
        return runtime.subscribeToNotifications((notification: { method: string; params: unknown }) => {
          listener({
            method: notification.method,
            params: notification.params,
            atIso: new Date().toISOString(),
          })
        })
      },
    }
  })()

  return await runtimeContextPromise
}
