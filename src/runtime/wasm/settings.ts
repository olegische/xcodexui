import {
  activeProviderApiKey,
  detectTransportMode,
  getActiveProvider,
  materializeCodexConfig,
  XROUTER_PROVIDER_OPTIONS,
} from 'xcodex-runtime'
import type {
  AuthState,
  CodexCompatibleConfig,
  DemoTransportMode,
  XrouterProvider,
} from 'xcodex-runtime/types'
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

function findStoredProviderConfig(
  config: CodexCompatibleConfig,
  transportMode: DemoTransportMode,
  xrouterProvider: XrouterProvider,
) {
  return (
    Object.values(config.modelProviders).find((provider) => {
      if (transportMode === 'openai') return provider.providerKind === 'openai'
      if (transportMode === 'openai-compatible') return provider.providerKind === 'openai_compatible'
      return (
        provider.providerKind === 'xrouter_browser' &&
        (provider.metadata?.xrouterProvider ?? null) === xrouterProvider
      )
    }) ?? null
  )
}

function cloneConfigWithoutProviderSecret(
  config: CodexCompatibleConfig,
  transportMode: DemoTransportMode,
  xrouterProvider: XrouterProvider,
): CodexCompatibleConfig {
  const provider = findStoredProviderConfig(config, transportMode, xrouterProvider)
  if (!provider) return config

  const nextEnv = { ...config.env }
  delete nextEnv[provider.envKey]

  return {
    ...config,
    env: nextEnv,
  }
}

function storedApiKeyForSelection(input: {
  config: CodexCompatibleConfig
  authState: AuthState | null
  transportMode: DemoTransportMode
  xrouterProvider: XrouterProvider
}): string {
  const provider = findStoredProviderConfig(input.config, input.transportMode, input.xrouterProvider)
  if (provider) {
    const apiKey = input.config.env[provider.envKey]?.trim()
    if (apiKey) return apiKey
  }
  return input.transportMode === 'openai' ? fallbackApiKey(input.authState) : ''
}

export async function hasStoredWasmProviderConfig(
  draft: Pick<WasmRuntimeDraft, 'transportMode' | 'xrouterProvider'>,
): Promise<boolean> {
  const [authState, config] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  return storedApiKeyForSelection({
    config,
    authState,
    transportMode: draft.transportMode,
    xrouterProvider: draft.xrouterProvider,
  }).length > 0
}

export async function applyStoredWasmTransportDefaults(
  draft: WasmRuntimeDraft,
  transportMode: DemoTransportMode,
): Promise<WasmRuntimeDraft> {
  const [authState, config] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  const nextDraft = applyWasmTransportDefaults(draft, transportMode)
  const storedProvider = findStoredProviderConfig(config, transportMode, nextDraft.xrouterProvider)
  return {
    ...nextDraft,
    providerDisplayName: storedProvider?.name ?? nextDraft.providerDisplayName,
    providerBaseUrl: storedProvider?.baseUrl ?? nextDraft.providerBaseUrl,
    apiKey: storedApiKeyForSelection({
      config,
      authState,
      transportMode,
      xrouterProvider: nextDraft.xrouterProvider,
    }),
  }
}

export async function applyStoredWasmXrouterProvider(
  draft: WasmRuntimeDraft,
  provider: XrouterProvider,
): Promise<WasmRuntimeDraft> {
  const [authState, config] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  const nextDraft = applyWasmXrouterProvider(draft, provider)
  const storedProvider = findStoredProviderConfig(config, nextDraft.transportMode, provider)
  return {
    ...nextDraft,
    providerDisplayName: storedProvider?.name ?? nextDraft.providerDisplayName,
    providerBaseUrl: storedProvider?.baseUrl ?? nextDraft.providerBaseUrl,
    apiKey: storedApiKeyForSelection({
      config,
      authState,
      transportMode: nextDraft.transportMode,
      xrouterProvider: provider,
    }),
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

export async function deleteStoredWasmProviderConfig(
  draft: Pick<WasmRuntimeDraft, 'transportMode' | 'xrouterProvider'>,
): Promise<WasmRuntimeDraft> {
  const [authState, config] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  const nextConfig = cloneConfigWithoutProviderSecret(config, draft.transportMode, draft.xrouterProvider)
  const shouldClearOpenAiFallback = draft.transportMode === 'openai'
  const nextAuthState =
    shouldClearOpenAiFallback
      ? {
          authMode: authState?.authMode ?? ('apiKey' as const),
          openaiApiKey: null,
          accessToken: authState?.accessToken ?? null,
          refreshToken: authState?.refreshToken ?? null,
          chatgptAccountId: authState?.chatgptAccountId ?? null,
          chatgptPlanType: authState?.chatgptPlanType ?? null,
          lastRefreshAt: authState?.lastRefreshAt ?? null,
        }
      : authState

  if (shouldClearOpenAiFallback && nextAuthState) {
    await saveStoredAuthState(nextAuthState)
  }

  await saveStoredCodexConfig(nextConfig)

  return draftFromConfig(nextConfig, nextAuthState)
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

export async function listWasmModelsForDraft(
  draft: Pick<WasmRuntimeDraft, 'providerBaseUrl' | 'apiKey'>,
): Promise<string[]> {
  const apiKey = draft.apiKey.trim()
  const baseUrl = draft.providerBaseUrl.trim().replace(/\/+$/u, '')
  if (!apiKey || !baseUrl) return []

  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Model list failed with HTTP ${response.status}`)
  }

  const payload = await response.json() as { data?: Array<{ id?: unknown }> }
  return Array.isArray(payload.data)
    ? payload.data.map((row) => (typeof row?.id === 'string' ? row.id.trim() : '')).filter(Boolean)
    : []
}

function draftFromConfig(config: CodexCompatibleConfig, authState: AuthState | null): WasmRuntimeDraft {
  const provider = getActiveProvider(config)
  return {
    transportMode: detectTransportMode(config),
    providerDisplayName: provider.name,
    providerBaseUrl: provider.baseUrl,
    apiKey: activeProviderApiKey(config) || fallbackApiKey(authState),
    xrouterProvider: provider.metadata?.xrouterProvider ?? 'openrouter',
    model: config.model.trim(),
    modelReasoningEffort: config.modelReasoningEffort?.trim() || 'medium',
    personality: config.personality?.trim() || 'pragmatic',
  }
}
