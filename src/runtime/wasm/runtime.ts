import { buildBrowserRuntimeBootstrap } from '@browser-codex/wasm-browser-host/bootstrap'
import {
  createBrowserRuntimeHostFromDeps,
  createNormalizedModelTurnRunner,
} from '@browser-codex/wasm-browser-host/runtime-host'
import { createBrowserCodexRuntime } from '@browser-codex/wasm-browser-codex-runtime'
import {
  createBrowserAwareToolExecutor,
  initializePageTelemetry,
} from '@browser-codex/wasm-browser-tools'
import { threadToSessionSnapshot, turnIdFromNotification } from '@browser-codex/wasm-runtime-core'
import { loadRuntimeModule } from '@browser-codex/app-webui-runtime/assets'
import { DEFAULT_CODEX_CONFIG, DEFAULT_DEMO_INSTRUCTIONS } from '@browser-codex/app-webui-runtime/constants'
import type {
  AuthState,
  CodexCompatibleConfig,
  ModelPreset,
} from '@browser-codex/app-webui-runtime/types'
import { activeProviderApiKey, formatError, getActiveProvider, normalizeHostValue } from '@browser-codex/app-webui-runtime/utils'
import {
  applyWorkspacePatch,
  listWorkspaceDir,
  readWorkspaceFile,
  searchWorkspace,
} from '@browser-codex/app-webui-runtime/workspace'
import type { RpcNotification } from '../../api/codexRpcClient'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'
import { emitWasmNotification, subscribeWasmNotifications } from './notificationBus'
import {
  clearStoredAuthState,
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredSession,
  loadStoredUserConfig,
  saveStoredAuthState,
  saveStoredCodexConfig,
  saveStoredSession,
  saveStoredUserConfig,
} from './storage'
import { webUiModelTransportAdapter } from './modelTransport'

type RuntimeEvent = {
  method: string
  params: unknown
}

type SessionSnapshot = {
  threadId: string
  metadata: unknown
  items: unknown[]
}

type RuntimeDispatch = {
  value: SessionSnapshot
  events: RuntimeEvent[]
}

type WasmBrowserRuntime = {
  loadAuthState(): Promise<AuthState | null>
  saveAuthState(authState: AuthState): Promise<void>
  clearAuthState(): Promise<void>
  listModels(request: { cursor: string | null; limit: number | null }): Promise<{
    data: ModelPreset[]
    nextCursor: string | null
  }>
  startThread(request: { threadId: string; metadata: unknown }): Promise<RuntimeDispatch>
  resumeThread(request: { threadId: string }): Promise<RuntimeDispatch>
  runTurn(request: {
    threadId: string
    turnId: string
    input: unknown
    modelPayload: unknown
  }): Promise<RuntimeDispatch>
  cancelModelTurn(requestId: string): Promise<void>
}

type WasmRuntimeContext = {
  runtime: WasmBrowserRuntime
  loadConfig: () => Promise<CodexCompatibleConfig>
  saveConfig: (config: CodexCompatibleConfig) => Promise<void>
  loadSession: (threadId: string) => Promise<SessionSnapshot | null>
  subscribe: (listener: (notification: RpcNotification) => void) => () => void
}
let runtimeContextPromise: Promise<WasmRuntimeContext> | null = null
const browserToolExecutor = createBrowserAwareToolExecutor()
let pageTelemetryInitialized = false

function actualThreadIdFromSnapshot(snapshot: SessionSnapshot): string | null {
  if (
    snapshot.metadata !== null &&
    typeof snapshot.metadata === 'object' &&
    !Array.isArray(snapshot.metadata) &&
    typeof (snapshot.metadata as Record<string, unknown>).id === 'string'
  ) {
    return (snapshot.metadata as Record<string, unknown>).id as string
  }
  return null
}

function turnIdFromRuntimeEvent(event: RuntimeEvent): string | null {
  const params =
    event.params === null ||
    typeof event.params === 'string' ||
    typeof event.params === 'number' ||
    typeof event.params === 'boolean' ||
    Array.isArray(event.params) ||
    typeof event.params === 'object'
      ? event.params
      : null

  return turnIdFromNotification({
    method: event.method,
    params,
  } as Parameters<typeof turnIdFromNotification>[0])
}

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
      RuntimeDispatch,
      RuntimeEvent,
      SessionSnapshot,
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
          loadSession: loadStoredSession,
          saveSession: saveStoredSession,
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
        normalizeThread(thread) {
          return normalizeHostValue(thread) as Record<string, unknown>
        },
        threadToSnapshot(thread) {
          return threadToSessionSnapshot(thread) as unknown as SessionSnapshot
        },
        withRequestedThreadId(snapshot, requestedThreadId) {
          return {
            ...snapshot,
            threadId: requestedThreadId,
          }
        },
        buildDispatch(snapshot, events) {
          return {
            value: snapshot,
            events,
          }
        },
        mapNotificationToEvent(notification) {
          return {
            method: notification.method,
            params: ('params' in notification ? notification.params : null) as RuntimeEvent['params'],
          }
        },
        emitRuntimeEvents(events) {
          for (const event of events) {
            emitWasmNotification(event.method, event.params)
          }
        },
        turnIdFromRuntimeEvent(event) {
          return turnIdFromRuntimeEvent(event)
        },
        isTurnCompletedEvent(event) {
          return event.method === 'turn/completed'
        },
        formatError,
        async requestUserInput() {
          return { answers: [] }
        },
        actualThreadIdFromSnapshot,
        logScope: 'xcodexui-wasm',
      },
    })

    return {
      runtime,
      loadConfig: loadStoredCodexConfig,
      saveConfig: saveStoredCodexConfig,
      loadSession: loadStoredSession,
      subscribe(listener) {
        return subscribeWasmNotifications(listener)
      },
    }
  })()

  return await runtimeContextPromise
}
