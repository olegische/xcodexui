import { buildBrowserRuntimeBootstrap } from '@browser-codex/wasm-browser-host/bootstrap'
import {
  createBrowserRuntimeHostFromDeps,
  createNormalizedModelTurnRunner,
} from '@browser-codex/wasm-browser-host/runtime-host'
import {
  createBrowserCodexRuntime,
  type BrowserCodexProtocolClient,
} from '@browser-codex/wasm-browser-codex-runtime'
import {
  createBrowserAwareToolExecutor,
  initializePageTelemetry,
} from '@browser-codex/wasm-browser-tools'
import { loadRuntimeModule } from '@browser-codex/app-webui-runtime/assets'
import { DEFAULT_CODEX_CONFIG, DEFAULT_DEMO_INSTRUCTIONS } from '@browser-codex/app-webui-runtime/constants'
import type {
  AuthState,
  CodexCompatibleConfig,
  ModelPreset,
} from '@browser-codex/app-webui-runtime/types'
import type { StoredThreadSession } from '@browser-codex/wasm-runtime-core'
import { activeProviderApiKey, formatError, getActiveProvider } from '@browser-codex/app-webui-runtime/utils'
import {
  applyWorkspacePatch,
  listWorkspaceDir,
  readWorkspaceFile,
  searchWorkspace,
} from '@browser-codex/app-webui-runtime/workspace'
import type { RpcNotification } from '../../api/codexRpcClient'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'
import {
  deleteStoredThreadSession,
  clearStoredAuthState,
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredThreadSession,
  loadStoredUserConfig,
  listStoredThreadSessions,
  saveStoredAuthState,
  saveStoredCodexConfig,
  saveStoredThreadSession,
  saveStoredUserConfig,
} from './storage'
import { webUiModelTransportAdapter } from './modelTransport'

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
const browserToolExecutor = createBrowserAwareToolExecutor()
let pageTelemetryInitialized = false

export async function getWasmRuntimeContext(): Promise<WasmRuntimeContext> {
  if (runtimeContextPromise) {
    return await runtimeContextPromise
  }

  runtimeContextPromise = (async () => {
    if (!pageTelemetryInitialized) {
      initializePageTelemetry()
      pageTelemetryInitialized = true
    }

    const runtimeModule = await loadRuntimeModule() as unknown
    const host = createBrowserRuntimeHostFromDeps({
      async loadBootstrap() {
        const [authState, config] = await Promise.all([
          loadStoredAuthState(),
          loadStoredCodexConfig(),
        ])
        const provider = getActiveProvider(config)
        const apiKey =
          authState?.authMode === 'apiKey' && authState.openaiApiKey !== null
            ? authState.openaiApiKey
            : activeProviderApiKey(config)
        return buildBrowserRuntimeBootstrap({
          codexHome: '/codex-home',
          cwd: BROWSER_WORKSPACE_ROOT,
          model: config.model.trim() || null,
          modelProviderId: config.modelProvider,
          modelProvider: {
            name: provider.name,
            baseUrl: provider.baseUrl,
            envKey: provider.envKey,
          },
          reasoningEffort: config.modelReasoningEffort,
          personality: config.personality,
          baseInstructions: DEFAULT_DEMO_INSTRUCTIONS.baseInstructions,
          developerInstructions: null,
          userInstructions: null,
          apiKey: apiKey || null,
          ephemeral: false,
        })
      },
      readFile: readWorkspaceFile,
      listDir: listWorkspaceDir,
      search: searchWorkspace,
      applyPatch: applyWorkspacePatch,
      async loadUserConfig() {
        const stored = await loadStoredUserConfig()
        if (stored === null) {
          return {
            filePath: '/codex-home/config.toml',
            version: '0',
            content: '',
          }
        }
        return stored
      },
      async saveUserConfig(request) {
        const record =
          request !== null && typeof request === 'object' && !Array.isArray(request)
            ? request as Record<string, unknown>
            : {}
        if (typeof record.content !== 'string') {
          throw new Error('saveUserConfig requires string content')
        }
        return await saveStoredUserConfig({
          filePath: typeof record.filePath === 'string' ? record.filePath : null,
          expectedVersion: typeof record.expectedVersion === 'string' ? record.expectedVersion : null,
          content: record.content,
        })
      },
      async loadThreadSession(request: unknown) {
        const record =
          request !== null && typeof request === 'object' && !Array.isArray(request)
            ? request as Record<string, unknown>
            : {}
        const threadId = typeof record.threadId === 'string' ? record.threadId : ''
        if (!threadId) {
          throw new Error('loadThreadSession requires threadId')
        }
        const session = await loadStoredThreadSession(threadId)
        if (session === null) {
          throw new Error(`thread session not found: ${threadId}`)
        }
        return { session }
      },
      async saveThreadSession(request: unknown) {
        const record =
          request !== null && typeof request === 'object' && !Array.isArray(request)
            ? request as Record<string, unknown>
            : {}
        const session =
          record.session !== null && typeof record.session === 'object' && !Array.isArray(record.session)
            ? record.session as StoredThreadSession
            : null
        if (session === null || session.metadata?.threadId?.length === 0 || !Array.isArray(session.items)) {
          throw new Error('saveThreadSession requires session metadata and items')
        }
        await saveStoredThreadSession(session)
        return null
      },
      async deleteThreadSession(request: unknown) {
        const record =
          request !== null && typeof request === 'object' && !Array.isArray(request)
            ? request as Record<string, unknown>
            : {}
        const threadId = typeof record.threadId === 'string' ? record.threadId : ''
        if (!threadId) {
          throw new Error('deleteThreadSession requires threadId')
        }
        await deleteStoredThreadSession(threadId)
        return null
      },
      async listThreadSessions() {
        const sessions = await listStoredThreadSessions()
        return { sessions }
      },
      async listDiscoverableApps() {
        return []
      },
      runNormalizedModelTurn: createNormalizedModelTurnRunner({
        scope: 'xcodexui-wasm',
        loadConfig: loadStoredCodexConfig,
        getProviderKind(config) {
          return getActiveProvider(config).providerKind
        },
        async runModelTurn(params) {
          return await webUiModelTransportAdapter.runModelTurn(params)
        },
      }),
    })

    const runtime = await createBrowserCodexRuntime<
      AuthState,
      CodexCompatibleConfig,
      { email: string | null; planType: string | null; chatgptAccountId: string | null; authMode: string | null } | null,
      ModelPreset,
      never
    >({
      runtimeModule: runtimeModule as Parameters<typeof createBrowserCodexRuntime>[0]['runtimeModule'],
      host,
      deps: {
        persistence: {
          loadAuthState: loadStoredAuthState,
          saveAuthState: saveStoredAuthState,
          clearAuthState: clearStoredAuthState,
          loadConfig: async () => await loadStoredCodexConfig().catch(() => structuredClone(DEFAULT_CODEX_CONFIG)),
        },
        dynamicTools: browserToolExecutor,
        async readAccount({ authState, config }) {
          const provider = getActiveProvider(config)
          if (authState === null || authState.openaiApiKey === null || authState.openaiApiKey.trim().length === 0) {
            return {
              account: null,
              requiresOpenaiAuth: provider.providerKind === 'openai',
            }
          }
          return {
            account: {
              email: null,
              planType: authState.chatgptPlanType,
              chatgptAccountId: authState.chatgptAccountId,
              authMode: authState.authMode,
            },
            requiresOpenaiAuth: false,
          }
        },
        async discoverModels({ config }) {
          return await webUiModelTransportAdapter.discoverModels(config)
        },
        async refreshAuth() {
          throw new Error('xcodexui wasm mode uses API keys only.')
        },
        formatError,
        async requestUserInput() {
          return { answers: [] }
        },
        logScope: 'xcodexui-wasm',
      },
    }) as WasmBrowserRuntime

    return {
      runtime,
      loadConfig: loadStoredCodexConfig,
      saveConfig: saveStoredCodexConfig,
      subscribe(listener) {
        return runtime.subscribeToNotifications((notification) => {
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
