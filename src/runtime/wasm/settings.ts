import {
  activeProviderApiKey,
  detectTransportMode,
  getActiveProvider,
  materializeCodexConfig,
  XROUTER_PROVIDER_OPTIONS,
  type AuthState,
  type CodexCompatibleConfig,
  type DemoTransportMode,
  type XrouterProvider,
} from '@browser-codex/wasm-runtime-client'
import { getWasmRuntimeContext } from './runtime'
import { loadStoredAuthState, loadStoredCodexConfig, saveStoredAuthState, saveStoredCodexConfig } from './storage'

export type WasmRuntimeDraft = {
  transportMode: DemoTransportMode
  providerDisplayName: string
  providerBaseUrl: string
  apiKey: string
  xrouterProvider: XrouterProvider
  model: string
  modelReasoningEffort: string
  personality: string
}

export type WasmRuntimeStatus = {
  label: string
  detail: string
  isError: boolean
}

export function deriveWasmRuntimeStatus(input: {
  providerName: string
  apiKey: string
  model: string
  hasUnsavedChanges?: boolean
}): WasmRuntimeStatus {
  const providerName = input.providerName.trim() || 'Runtime'
  const apiKey = input.apiKey.trim()
  const model = input.model.trim()

  if (!apiKey) {
    return {
      label: 'API key required',
      detail: `${providerName} is selected, but no API key is stored.`,
      isError: true,
    }
  }

  if (!model) {
    return {
      label: 'Model required',
      detail: `${providerName} is configured. Pick a model in settings.`,
      isError: true,
    }
  }

  return {
    label: input.hasUnsavedChanges ? 'Ready to save' : 'Ready',
    detail: `${providerName} · ${model}`,
    isError: false,
  }
}

function defaultProviderOption(provider: XrouterProvider) {
  return XROUTER_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? XROUTER_PROVIDER_OPTIONS[0]
}

function fallbackApiKey(authState: AuthState | null): string {
  if (authState?.authMode !== 'apiKey') return ''
  return authState.openaiApiKey?.trim() ?? ''
}

export function applyWasmTransportDefaults(
  draft: WasmRuntimeDraft,
  transportMode: DemoTransportMode,
): WasmRuntimeDraft {
  if (transportMode === 'xrouter-browser') {
    const option = defaultProviderOption(draft.xrouterProvider)
    return {
      ...draft,
      transportMode,
      providerDisplayName: option.displayName,
      providerBaseUrl: option.baseUrl,
    }
  }

  if (transportMode === 'openai') {
    return {
      ...draft,
      transportMode,
      providerDisplayName: 'OpenAI',
      providerBaseUrl: 'https://api.openai.com/v1',
    }
  }

  return {
    ...draft,
    transportMode,
    providerDisplayName: 'OpenAI-Compatible Server',
    providerBaseUrl: draft.providerBaseUrl.trim(),
  }
}

export function applyWasmXrouterProvider(
  draft: WasmRuntimeDraft,
  provider: XrouterProvider,
): WasmRuntimeDraft {
  const option = defaultProviderOption(provider)
  return {
    ...draft,
    xrouterProvider: provider,
    providerDisplayName: option.displayName,
    providerBaseUrl: option.baseUrl,
  }
}

export async function loadWasmRuntimeDraft(): Promise<WasmRuntimeDraft> {
  const [authState, codexConfig] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  return draftFromConfig(codexConfig, authState)
}

export async function saveWasmRuntimeDraft(draft: WasmRuntimeDraft): Promise<CodexCompatibleConfig> {
  const apiKey = draft.apiKey.trim()
  if (apiKey.length === 0) {
    throw new Error('Enter an API key before saving runtime settings.')
  }

  const config = materializeCodexConfig({
    transportMode: draft.transportMode,
    model: draft.model.trim(),
    modelReasoningEffort: draft.modelReasoningEffort.trim() || null,
    personality: draft.personality.trim() || 'pragmatic',
    displayName: draft.providerDisplayName.trim(),
    baseUrl: draft.providerBaseUrl.trim(),
    apiKey,
    xrouterProvider: draft.xrouterProvider,
  })

  await Promise.all([
    saveStoredAuthState({
      authMode: 'apiKey',
      openaiApiKey: apiKey,
      accessToken: null,
      refreshToken: null,
      chatgptAccountId: null,
      chatgptPlanType: null,
      lastRefreshAt: null,
    }),
    saveStoredCodexConfig(config),
  ])

  return config
}

export async function getWasmRuntimeStatus(): Promise<WasmRuntimeStatus> {
  try {
    await getWasmRuntimeContext()
  } catch (error) {
    return {
      label: 'Bootstrap failed',
      detail: error instanceof Error ? error.message : String(error),
      isError: true,
    }
  }

  const [authState, config] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  const provider = getActiveProvider(config)
  const apiKey = activeProviderApiKey(config) || fallbackApiKey(authState)

  return deriveWasmRuntimeStatus({
    providerName: provider.name,
    apiKey,
    model: config.model ?? '',
  })
}

function draftFromConfig(config: CodexCompatibleConfig, authState: AuthState | null): WasmRuntimeDraft {
  const provider = getActiveProvider(config)
  return {
    transportMode: detectTransportMode(config),
    providerDisplayName: provider.name,
    providerBaseUrl: provider.baseUrl,
    apiKey: activeProviderApiKey(config) || fallbackApiKey(authState),
    xrouterProvider: provider.metadata?.xrouterProvider ?? 'deepseek',
    model: config.model.trim(),
    modelReasoningEffort: config.modelReasoningEffort?.trim() || 'medium',
    personality: config.personality?.trim() || 'pragmatic',
  }
}
