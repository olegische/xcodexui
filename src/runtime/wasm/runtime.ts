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
} from 'xcodex-runtime/types'
import type { RpcNotification } from '../../api/codexRpcClient'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'
import { requestBrowserToolApproval, subscribeBrowserToolApprovalNotifications } from './browserToolApprovalBridge'
import XCODEX_WASM_BASE_INSTRUCTIONS from './prompt_wasm.md?raw'
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

export function invalidateWasmRuntimeContext(): void {
  runtimeContextPromise = null
}

export async function getWasmRuntimeContext(): Promise<WasmRuntimeContext> {
  if (runtimeContextPromise) {
    return await runtimeContextPromise
  }

  runtimeContextPromise = (async () => {
    const context = await createBrowserCodexRuntimeContext({
      cwd: BROWSER_WORKSPACE_ROOT,
      storage: wasmRuntimeStorage,
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
