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
  RuntimeMode,
  XrouterProvider,
} from 'xcodex-runtime/types'
import { getWasmRuntimePolicyPreset, listWasmRuntimePolicyPresets, type WasmRuntimePolicyPreset } from './presets'
import { getWasmRuntimeContext, invalidateWasmRuntimeContext } from './runtime'
import {
  clearLegacyStoredWasmRuntimeState,
  loadStoredAuthState,
  loadStoredCodexConfig,
  saveStoredAuthState,
  saveStoredCodexConfig,
} from './storage'

export type WasmRuntimeDraft = {
  runtimeMode: RuntimeMode
  transportMode: DemoTransportMode
  providerDisplayName: string
  providerBaseUrl: string
  apiKey: string
  xrouterProvider: XrouterProvider
  model: string
  modelReasoningEffort: string
  personality: string
}

export { type WasmRuntimePolicyPreset }

export type WasmRuntimeStatus = {
  label: string
  detail: string
  isError: boolean
}

export type WasmProviderSetupGuide = {
  title: string
  description: string
  docsLabel: string
  docsUrl: string
  keyPlaceholder: string
  keyHelp: string
  baseUrlHelp: string
  steps: string[]
}

export function getWasmProviderSetupGuide(input: Pick<WasmRuntimeDraft, 'transportMode' | 'xrouterProvider'>): WasmProviderSetupGuide {
  if (input.transportMode === 'xrouter-browser') {
    switch (input.xrouterProvider) {
      case 'deepseek':
        return {
          title: 'Get a DeepSeek API key',
          description: 'DeepSeek does not use OAuth here. Create a platform key in DeepSeek, then paste it into this runtime.',
          docsLabel: 'Open DeepSeek API docs',
          docsUrl: 'https://api-docs.deepseek.com/api/deepseek-api',
          keyPlaceholder: 'Paste DeepSeek API key',
          keyHelp: 'Create a DeepSeek platform key first, then paste it here.',
          baseUrlHelp: 'Leave the default DeepSeek endpoint unless you run a proxy.',
          steps: [
            'Open the official DeepSeek API docs.',
            'Create or copy a DeepSeek API key from your platform account.',
            'Paste the key here and save the runtime settings.',
          ],
        }
      case 'zai':
        return {
          title: 'Get a Z.AI API key',
          description: 'Z.AI expects a bearer API key from the Open Platform. This runtime stores it locally in the browser only.',
          docsLabel: 'Open Z.AI developer docs',
          docsUrl: 'https://docs.z.ai/api-reference/introduction',
          keyPlaceholder: 'Paste Z.AI API key',
          keyHelp: 'Create a key in Z.AI Open Platform, then paste it here.',
          baseUrlHelp: 'Leave the default Z.AI endpoint unless you were given a custom gateway.',
          steps: [
            'Open the Z.AI developer docs.',
            'Sign in to Z.AI Open Platform and create an API key.',
            'Paste the key here and save the runtime settings.',
          ],
        }
      case 'openai':
        return {
          title: 'Use an OpenAI-compatible key',
          description: 'This route expects an OpenAI-compatible provider that speaks the standard bearer-token API.',
          docsLabel: 'Open runtime docs',
          docsUrl: 'https://platform.openai.com/docs/overview',
          keyPlaceholder: 'Paste OpenAI-compatible API key',
          keyHelp: 'Paste a bearer API key for the selected OpenAI-compatible provider.',
          baseUrlHelp: 'Point this to the provider base URL that exposes the OpenAI-compatible API.',
          steps: [
            'Create an API key in the provider you want to use.',
            'Paste the key here.',
            'Set the matching base URL if it is not already correct.',
          ],
        }
      case 'openrouter':
      default:
        return {
          title: 'Get an OpenRouter API key',
          description: 'OpenRouter keys come from your OpenRouter account, not from Codex. You usually need account credits before the key is useful.',
          docsLabel: 'Open OpenRouter docs',
          docsUrl: 'https://openrouter.ai/docs/faq',
          keyPlaceholder: 'Paste OpenRouter API key',
          keyHelp: 'Create an OpenRouter API key in your OpenRouter account, then paste it here.',
          baseUrlHelp: 'Leave the default OpenRouter endpoint unless you use your own proxy.',
          steps: [
            'Open the official OpenRouter docs.',
            'Create an account, add credits if needed, and generate an API key.',
            'Paste the key here and save the runtime settings.',
          ],
        }
    }
  }

  if (input.transportMode === 'openai') {
    return {
      title: 'Get an OpenAI API key',
      description: 'OpenAI keys are created in your OpenAI platform account and used as bearer tokens.',
      docsLabel: 'Open OpenAI docs',
      docsUrl: 'https://platform.openai.com/docs/overview',
      keyPlaceholder: 'Paste OpenAI API key',
      keyHelp: 'Create an OpenAI API key in the OpenAI platform, then paste it here.',
      baseUrlHelp: 'Leave the default OpenAI API endpoint unless you use a proxy.',
      steps: [
        'Open the OpenAI platform docs.',
        'Create an API key in your platform account.',
        'Paste the key here and save the runtime settings.',
      ],
    }
  }

  return {
    title: 'Connect an OpenAI-compatible server',
    description: 'This runtime expects a bearer API key and a base URL for a server that implements the OpenAI-compatible API.',
    docsLabel: 'Open OpenAI API docs',
    docsUrl: 'https://platform.openai.com/docs/overview',
    keyPlaceholder: 'Paste API key',
    keyHelp: 'Paste the bearer API key for your server.',
    baseUrlHelp: 'Set the exact base URL exposed by that server.',
    steps: [
      'Create or copy an API key from your provider.',
      'Paste the key here.',
      'Set the correct OpenAI-compatible base URL, then save.',
    ],
  }
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
      detail: `${providerName} is selected, but no API key is stored yet. Use the setup guide below to create one.`,
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

function createDefaultWasmRuntimeDraft(): WasmRuntimeDraft {
  const option = defaultProviderOption('openrouter')
  return {
    runtimeMode: 'default',
    transportMode: 'xrouter-browser',
    providerDisplayName: option.displayName,
    providerBaseUrl: option.baseUrl,
    apiKey: '',
    xrouterProvider: 'openrouter',
    model: '',
    modelReasoningEffort: 'medium',
    personality: 'pragmatic',
  }
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

function hasAnyStoredProviderSecret(
  config: CodexCompatibleConfig,
  authState: AuthState | null,
  transportMode: DemoTransportMode,
): boolean {
  if (transportMode === 'openai' && fallbackApiKey(authState).length > 0) return true

  return Object.values(config.modelProviders).some((provider) => {
    const apiKey = config.env[provider.envKey]?.trim()
    return Boolean(apiKey)
  })
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

  const policyPreset = getWasmRuntimePolicyPreset(draft.runtimeMode)

  const config = materializeCodexConfig({
    transportMode: draft.transportMode,
    model: draft.model.trim(),
    runtimeMode: policyPreset.runtimeMode,
    browserSecurity: policyPreset.browserSecurity,
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
      openaiApiKey: draft.transportMode === 'openai' ? apiKey : null,
      accessToken: null,
      refreshToken: null,
      chatgptAccountId: null,
      chatgptPlanType: null,
      lastRefreshAt: null,
    }),
    saveStoredCodexConfig(config),
    clearLegacyStoredWasmRuntimeState(),
  ])

  invalidateWasmRuntimeContext()

  return config
}

export async function deleteStoredWasmProviderConfig(
  draft: Pick<WasmRuntimeDraft, 'transportMode' | 'xrouterProvider'>,
): Promise<WasmRuntimeDraft> {
  const [authState, config] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()])
  const nextConfig = cloneConfigWithoutProviderSecret(config, draft.transportMode, draft.xrouterProvider)
  const nextAuthState = {
    authMode: authState?.authMode ?? ('apiKey' as const),
    openaiApiKey: draft.transportMode === 'openai' ? null : authState?.openaiApiKey ?? null,
    accessToken: authState?.accessToken ?? null,
    refreshToken: authState?.refreshToken ?? null,
    chatgptAccountId: authState?.chatgptAccountId ?? null,
    chatgptPlanType: authState?.chatgptPlanType ?? null,
    lastRefreshAt: authState?.lastRefreshAt ?? null,
  }

  if (draft.transportMode !== 'openai') {
    nextAuthState.openaiApiKey = null
  }

  await Promise.all([
    saveStoredAuthState(nextAuthState),
    saveStoredCodexConfig(nextConfig),
    clearLegacyStoredWasmRuntimeState(),
  ])

  invalidateWasmRuntimeContext()

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
  const draft = draftFromConfig(config, authState)

  return deriveWasmRuntimeStatus({
    providerName: draft.providerDisplayName,
    apiKey: draft.apiKey,
    model: draft.model,
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

export function getWasmRuntimePolicyPresetForDraft(draft: Pick<WasmRuntimeDraft, 'runtimeMode'>): WasmRuntimePolicyPreset {
  return getWasmRuntimePolicyPreset(draft.runtimeMode)
}

export function getWasmRuntimePolicyPresetOptions(): WasmRuntimePolicyPreset[] {
  return listWasmRuntimePolicyPresets()
}

function draftFromConfig(config: CodexCompatibleConfig, authState: AuthState | null): WasmRuntimeDraft {
  const transportMode = detectTransportMode(config)
  const provider = getActiveProvider(config)
  const apiKey = storedApiKeyForSelection({
    config,
    authState,
    transportMode,
    xrouterProvider: provider.metadata?.xrouterProvider ?? 'openrouter',
  })

  if (!apiKey && !hasAnyStoredProviderSecret(config, authState, transportMode)) {
    return {
      ...createDefaultWasmRuntimeDraft(),
      runtimeMode: normalizeRuntimeMode(config.runtime_mode),
    }
  }

  return {
    runtimeMode: normalizeRuntimeMode(config.runtime_mode),
    transportMode,
    providerDisplayName: provider.name,
    providerBaseUrl: provider.baseUrl,
    apiKey,
    xrouterProvider: provider.metadata?.xrouterProvider ?? 'openrouter',
    model: config.model.trim(),
    modelReasoningEffort: config.modelReasoningEffort?.trim() || 'medium',
    personality: config.personality?.trim() || 'pragmatic',
  }
}

function normalizeRuntimeMode(value: unknown): RuntimeMode {
  return value === 'demo' || value === 'chaos' ? value : 'default'
}
