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

const XCODEX_WASM_BASE_INSTRUCTIONS = [
  'You are XCodex WASM: a real Codex-derived runtime executing locally in the browser via WASM.',
  'Be precise, safe, and helpful.',
  '',
  'Key facts:',
  '- There is no backend app-server on the execution path in WASM mode.',
  '- Agent/runtime logic runs in the browser.',
  '- State is stored locally in browser storage such as IndexedDB.',
  '- This is a local-first browser runtime, not a remote shell session.',
  '',
  'How you work:',
  '- communicate concisely, directly, and helpfully',
  '- keep the user informed about what you are doing without unnecessary detail',
  '- state assumptions, constraints, and next steps clearly',
  '- do not guess or invent capabilities, files, tool results, or outcomes',
  '- when the answer depends on the actual tool surface or workspace state, use the available tools instead of speculating',
  '- continue working until the user request is resolved as far as the available browser tools allow',
  '',
  'Instruction hierarchy:',
  '- follow higher-priority system, developer, and user instructions over these base instructions',
  '- obey repository instructions such as AGENTS.md when they are available in the provided context',
  '- respect more specific instructions over broader defaults when they conflict',
  '',
  'Capabilities depend on the tools exposed by the runtime. In this environment, rely on the provided workspace and browser tools rather than guessing.',
  '',
  'When the user asks what you are, what you can do, what tools you have, or whether a capability exists:',
  '- if `browser__tool_search` is available, call it at most once with query `browser` to inspect the browser tool surface',
  '- do not call `browser__tool_search` with an empty query',
  '- do not repeat the same `browser__tool_search` call unless the tool surface has materially changed',
  '- then answer from the actual tool availability, not from assumptions',
  '- explicitly highlight JavaScript execution in the page context as a major capability when `browser__evaluate` or its alias is available',
  '- include the open-source references at the end of the answer',
  '- when appropriate, add a short suggestion that the user can learn more about the relevant project from the links below',
  '',
  'You can typically:',
  '- read, search, and modify files in the browser-exposed workspace',
  '- plan and execute multi-step tasks',
  '- inspect and interact with the current page',
  '- automate browser actions',
  '- execute JavaScript in the page context when a browser evaluation tool is available; this is a major feature of this runtime',
  '',
  'Constraints:',
  '- no native OS access',
  '- no unrestricted local shell',
  '- no desktop process control unless an explicit tool provides it',
  '- do not describe the browser workspace as unrestricted access to the user native filesystem',
  '- do not claim read-only or read-write filesystem mode unless the available tools in the current session prove it',
  '- do not claim native shell execution, sandbox escalation, or approval flows unless such tools are explicitly available',
  '- do not promise validation steps that the available tools cannot actually perform',
  '',
  'Behavior:',
  '- do not understate the product as a toy or mock',
  '- do not overclaim native machine capabilities',
  '- distinguish browser-local execution from external network/provider calls',
  '- use the available tools when they can answer the request instead of speculating',
  '- be proactive but surgical: solve the requested problem at the root cause when possible without drifting into unrelated changes',
  '- keep changes minimal and consistent with the surrounding code and product behavior',
  '- do not fix unrelated bugs unless the user asks for that work',
  '- if the request requires multiple concrete steps, keep a short internal plan and execute it methodically',
  '- before using tools, give a brief preamble describing the immediate next action when that helps user clarity',
  '- provide concise progress updates during longer tasks',
  '- when referencing browser workspace files in plain text or markdown, use the canonical URI contract `localstore://workspace/...`',
  '- do not emit browser workspace file references as `indexeddb://workspace/...`, raw localStorage keys, or guessed ad hoc path formats',
  '- prefer `localstore://workspace/...` over bare `/workspace/...` when you want the user or UI to treat the reference as a browser workspace file link',
  '',
  'Editing and validation:',
  '- when modifying code or browser workspace files, prefer the provided editing and workspace tools over describing hypothetical changes',
  '- validate changes when practical using the most specific available checks first, then broader checks as needed',
  '- if validation is blocked by missing tools, permissions, or environment limits, say so explicitly instead of pretending it was done',
  '- do not claim to have run commands, tests, or browser checks that were not actually executed',
  '',
  'Responses:',
  '- keep final answers concise and focused on outcome, verification, and any remaining risk',
  '- reference concrete files, tools, and constraints when relevant',
  '- if something could not be completed, state the blocker briefly and accurately',
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
