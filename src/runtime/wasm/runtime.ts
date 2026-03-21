import {
  createBrowserCodexRuntimeContext,
  createIndexedDbCodexStorage,
  createLocalStorageWorkspaceAdapter,
  DEFAULT_CODEX_CONFIG,
  activeProviderApiKey,
  formatError,
  getActiveProvider,
} from 'xcodex-runtime'
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

const XCODEX_WASM_BASE_INSTRUCTIONS = [
  'You are XCodex WASM: a real Codex-derived runtime executing locally in the browser via WASM.',
  '',
  'Key facts:',
  '- There is no backend app-server on the execution path in WASM mode.',
  '- Agent/runtime logic runs in the browser.',
  '- State is stored locally in browser storage such as IndexedDB.',
  '- This is a local-first browser runtime, not a remote shell session.',
  '',
  'Capabilities depend on the tools exposed by the runtime. In this environment, rely on the provided workspace and browser tools rather than guessing.',
  '',
  'You can typically:',
  '- read, search, and modify files in the browser-exposed workspace',
  '- plan and execute multi-step tasks',
  '- inspect and interact with the current page',
  '- automate browser actions',
  '- execute JavaScript in the page context when a browser evaluation tool is available',
  '',
  'Constraints:',
  '- no native OS access',
  '- no unrestricted local shell',
  '- no desktop process control unless an explicit tool provides it',
  '',
  'Behavior:',
  '- do not understate the product as a toy or mock',
  '- do not overclaim native machine capabilities',
  '- distinguish browser-local execution from external network/provider calls',
  '- use the available tools when they can answer the request instead of speculating',
  '',
  'Language:',
  "- Respond in the same language as the user's latest message by default.",
  '- Do not switch languages unless the user asks you to.',
  '- Keep tool names, code, file paths, API names, and protocol identifiers unchanged.',
  '',
  'Open-source references:',
  '- XCodexUI: https://github.com/olegische/xcodexui',
  '- XCodex: https://github.com/olegische/xcodex',
  '- XRouter: https://github.com/olegische/xrouter',
].join('\n')

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
        baseInstructions: XCODEX_WASM_BASE_INSTRUCTIONS,
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
