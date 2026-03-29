import {
  createBrowserCodexRuntimeContext,
  createLocalStorageWorkspaceAdapter,
  activeProviderApiKey,
  getActiveProvider,
} from 'xcodex-runtime'
import type {
  AuthState,
  BrowserCodexProtocolClient,
  CodexCompatibleConfig,
  ModelPreset,
  RuntimeMode,
} from 'xcodex-runtime/types'
import type { RpcNotification } from '../../api/codexRpcClient'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'
import { requestBrowserToolApproval, subscribeBrowserToolApprovalNotifications } from './browserToolApprovalBridge'
import XCODEX_WASM_AGENT_INSTRUCTIONS from './prompt_wasm.md?raw'
import XCODEX_WASM_HELPER_INSTRUCTIONS from './prompt_wasm_helper.md?raw'
import { wasmRuntimeStorage } from './storage'

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

function createModeScopedInstructions(runtimeMode: RuntimeMode): string {
  const baseInstructions = runtimeMode === 'agent' || runtimeMode === 'chaos'
    ? XCODEX_WASM_AGENT_INSTRUCTIONS
    : XCODEX_WASM_HELPER_INSTRUCTIONS
  const modeInstructions = {
    chat: [
      'The active runtime mode is "chat".',
      'Treat this session as chat-only.',
      'Do not claim browser tools, workspace access, file reading, file editing, or page JavaScript execution.',
      'If the user asks what you can do, answer briefly and only as a chat assistant unless tools are visibly available in the current session.',
      'Do not mention workspace, files, coding help, or code editing.',
      'Only when the user asks about capabilities, tools, limitations, or what else is available, briefly explain that other runtime modes exist.',
      'For those capability answers in chat mode, mention this mode ladder briefly: chat for plain conversation, inspect for read-only page inspection, interact for page interaction without navigation, agent for browser interaction plus workspace access, chaos for full access.',
      'For those capability answers in chat mode, say the user can switch modes from Settings -> Runtime or by using the Runtime row in the sidebar settings area.',
      'Do not proactively advertise or explain other modes in normal conversation unless the user is asking about capabilities or limitations.',
    ],
    inspect: [
      'The active runtime mode is "inspect".',
      'You may describe read-only page inspection only when those tools are visibly available.',
      'Do not claim click, fill, navigate, workspace patching, or page JavaScript execution.',
      'Do not mention workspace, files, code editing, or writing code.',
    ],
    interact: [
      'The active runtime mode is "interact".',
      'You may describe page interaction only when those tools are visibly available.',
      'Do not claim navigation, workspace patching, or page JavaScript execution.',
      'Do not mention workspace, files, code editing, or writing code.',
    ],
    agent: [
      'The active runtime mode is "agent".',
      'You may describe browser interaction and workspace editing only when those tools are visibly available.',
      'Do not claim navigation or page JavaScript execution.',
    ],
    chaos: [
      'The active runtime mode is "chaos".',
      'You may describe the full browser and workspace surface only when those tools are visibly available.',
    ],
  } satisfies Record<RuntimeMode, string[]>

  return `${baseInstructions}\n\n# Active Runtime Mode\n${modeInstructions[runtimeMode].join('\n')}`
}

export function invalidateWasmRuntimeContext(): void {
  runtimeContextPromise = null
}

export async function getWasmRuntimeContext(): Promise<WasmRuntimeContext> {
  if (runtimeContextPromise) {
    return await runtimeContextPromise
  }

  runtimeContextPromise = (async () => {
    const initialConfig = await wasmRuntimeStorage.loadConfig()
    const context = await createBrowserCodexRuntimeContext({
      cwd: BROWSER_WORKSPACE_ROOT,
      storage: wasmRuntimeStorage,
      workspace: createLocalStorageWorkspaceAdapter({
        rootPath: BROWSER_WORKSPACE_ROOT,
      }),
      bootstrap: {
        baseInstructions: createModeScopedInstructions(initialConfig.runtime_mode ?? 'chat'),
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
      requestBrowserToolApproval,
      requestUserInput: async () => ({ answers: [] }),
    })

    const runtime = context.runtime as WasmBrowserRuntime

    return {
      runtime,
      loadConfig: context.loadConfig,
      saveConfig: context.saveConfig,
      subscribe(listener) {
        const unsubscribeRuntime = runtime.subscribeToNotifications((notification: { method: string; params: unknown }) => {
          listener({
            method: notification.method,
            params: notification.params,
            atIso: new Date().toISOString(),
          })
        })
        const unsubscribeBridge = subscribeBrowserToolApprovalNotifications(listener)
        return () => {
          unsubscribeRuntime()
          unsubscribeBridge()
        }
      },
    }
  })()

  return await runtimeContextPromise
}
