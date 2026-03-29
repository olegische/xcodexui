import { computed, onUnmounted, ref, watch } from 'vue'
import type { DemoTransportMode, RuntimeMode, XrouterProvider } from 'xcodex-runtime/types'
import {
  applyStoredWasmTransportDefaults,
  applyStoredWasmXrouterProvider,
  deleteStoredWasmProviderConfig,
  deriveWasmRuntimeStatus,
  getWasmRuntimePolicyPresetForDraft,
  getWasmRuntimePolicyPresetOptions,
  getWasmRuntimeStatus,
  hasStoredWasmProviderConfig,
  listWasmModelsForDraft,
  loadWasmRuntimeDraft,
  saveWasmRuntimeDraft,
  type WasmRuntimeDraft,
  type WasmRuntimeStatus,
} from '../runtime/wasm/settings'
import {
  consumeOpenRouterOauthCallback,
  isOpenRouterOauthSupported,
  startOpenRouterOauthFlow,
} from '../runtime/wasm/openrouterOAuth'
import { getRuntimeModePresentation } from '../runtime/wasm/runtimeModes'

type UseWasmRuntimeSettingsOptions = {
  enabled: boolean
  refreshAll: () => Promise<void>
}

let pendingOpenRouterOauthCallback: Promise<Awaited<ReturnType<typeof consumeOpenRouterOauthCallback>>> | null = null

export function useWasmRuntimeSettings(options: UseWasmRuntimeSettingsOptions) {
  const wasmSettingsDraft = ref<WasmRuntimeDraft>({
    runtimeMode: 'chat',
    transportMode: 'xrouter-browser',
    providerDisplayName: 'OpenRouter via Browser Runtime',
    providerBaseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    xrouterProvider: 'openrouter',
    model: '',
    modelReasoningEffort: 'medium',
    personality: 'pragmatic',
  })
  const wasmRuntimeStatus = ref<WasmRuntimeStatus>({
    label: 'Loading…',
    detail: '',
    isError: false,
  })
  const wasmSettingsFeedback = ref('')
  const wasmSettingsFeedbackTone = ref<'neutral' | 'error'>('neutral')
  const hasStoredWasmProviderSecret = ref(false)
  const wasmRuntimeModelIds = ref<string[]>([])
  const isSavingWasmSettings = ref(false)
  const isConnectingOpenRouterOauth = ref(false)
  const savedRuntimeMode = ref<RuntimeMode>('chat')
  const runtimePolicyOptions = getWasmRuntimePolicyPresetOptions()

  let wasmModelRefreshToken = 0
  let wasmModelRefreshTimer: ReturnType<typeof setTimeout> | null = null

  const runtimeModelAllowsManualInput = computed(() =>
    options.enabled && (
      wasmSettingsDraft.value.transportMode === 'openai-compatible'
      || (
        wasmSettingsDraft.value.transportMode === 'xrouter-browser'
        && wasmSettingsDraft.value.xrouterProvider === 'openai'
      )
    ),
  )

  const runtimeModelOptions = computed(() =>
    wasmRuntimeModelIds.value.map((modelId) => ({ value: modelId, label: modelId })),
  )

  const derivedRuntimeStatus = computed(() =>
    deriveWasmRuntimeStatus({
      providerName: wasmSettingsDraft.value.providerDisplayName,
      apiKey: wasmSettingsDraft.value.apiKey,
      model: wasmSettingsDraft.value.model,
    }),
  )

  const showWasmRuntimeSetupCta = computed(() =>
    options.enabled && wasmRuntimeStatus.value.isError,
  )

  const selectedRuntimePolicy = computed(() =>
    getWasmRuntimePolicyPresetForDraft(wasmSettingsDraft.value),
  )

  async function refreshWasmRuntimeSettings(): Promise<void> {
    if (!options.enabled) return
    try {
      const oauthResult = await maybeConsumeOpenRouterOauthCallback()
      if (oauthResult.status === 'success') {
        await finalizeOpenRouterOauth(oauthResult.key, options.refreshAll)
      }

      const [draft, status] = await Promise.all([loadWasmRuntimeDraft(), getWasmRuntimeStatus()])
      wasmSettingsDraft.value = draft
      savedRuntimeMode.value = draft.runtimeMode
      wasmRuntimeStatus.value = status
      void refreshWasmRuntimeModelOptions(wasmSettingsDraft.value)
      hasStoredWasmProviderSecret.value = await hasStoredWasmProviderConfig({
        transportMode: wasmSettingsDraft.value.transportMode,
        xrouterProvider: wasmSettingsDraft.value.xrouterProvider,
      })

      if (oauthResult.status === 'success') {
        wasmSettingsFeedback.value = 'OpenRouter connected. The runtime config was saved automatically.'
        wasmSettingsFeedbackTone.value = 'neutral'
      }
    } catch (error) {
      wasmRuntimeStatus.value = {
        label: 'Settings unavailable',
        detail: error instanceof Error ? error.message : String(error),
        isError: true,
      }
    }
  }

  async function refreshWasmRuntimeModelOptions(draft = wasmSettingsDraft.value): Promise<void> {
    if (!options.enabled) return
    const refreshToken = ++wasmModelRefreshToken
    try {
      const modelIds = await listWasmModelsForDraft({
        providerBaseUrl: draft.providerBaseUrl,
        apiKey: draft.apiKey,
      })
      if (refreshToken !== wasmModelRefreshToken) return
      wasmRuntimeModelIds.value = modelIds
    } catch {
      if (refreshToken !== wasmModelRefreshToken) return
      wasmRuntimeModelIds.value = []
    }
  }

  function onWasmTransportModeChange(mode: DemoTransportMode): void {
    void (async () => {
      const nextDraft = await applyStoredWasmTransportDefaults(wasmSettingsDraft.value, mode)
      wasmSettingsDraft.value = {
        ...nextDraft,
        model: runtimeModelAllowsManualInput.value ? '' : nextDraft.model,
      }
      hasStoredWasmProviderSecret.value = await hasStoredWasmProviderConfig({
        transportMode: nextDraft.transportMode,
        xrouterProvider: nextDraft.xrouterProvider,
      })
    })()
  }

  function onWasmRuntimeModeChange(runtimeMode: RuntimeMode): void {
    wasmSettingsDraft.value = {
      ...wasmSettingsDraft.value,
      runtimeMode,
    }
  }

  function onWasmXrouterProviderChange(provider: XrouterProvider): void {
    void (async () => {
      const nextDraft = await applyStoredWasmXrouterProvider(wasmSettingsDraft.value, provider)
      const allowsManualInput =
        nextDraft.transportMode === 'openai-compatible'
        || (nextDraft.transportMode === 'xrouter-browser' && nextDraft.xrouterProvider === 'openai')
      wasmSettingsDraft.value = {
        ...nextDraft,
        model: allowsManualInput ? '' : nextDraft.model,
      }
      hasStoredWasmProviderSecret.value = await hasStoredWasmProviderConfig({
        transportMode: nextDraft.transportMode,
        xrouterProvider: nextDraft.xrouterProvider,
      })
    })()
  }

  async function saveCurrentWasmRuntimeSettings(): Promise<void> {
    if (!options.enabled || isSavingWasmSettings.value) return

    const nextMode = wasmSettingsDraft.value.runtimeMode
    const confirmationText = getRuntimeModePresentation(nextMode).confirmationText
    if (
      confirmationText
      && savedRuntimeMode.value !== nextMode
      && typeof window !== 'undefined'
    ) {
      const confirmed = window.confirm(confirmationText)
      if (!confirmed) {
        wasmSettingsFeedback.value = `${getRuntimeModePresentation(nextMode).label} mode change cancelled.`
        wasmSettingsFeedbackTone.value = 'neutral'
        return
      }
    }

    isSavingWasmSettings.value = true
    wasmSettingsFeedback.value = ''
    wasmSettingsFeedbackTone.value = 'neutral'

    try {
      await saveWasmRuntimeDraft(wasmSettingsDraft.value)
      await options.refreshAll()
      await refreshWasmRuntimeSettings()
      savedRuntimeMode.value = wasmSettingsDraft.value.runtimeMode
      wasmSettingsFeedback.value = 'Runtime settings saved.'
    } catch (error) {
      wasmSettingsFeedback.value = error instanceof Error ? error.message : String(error)
      wasmSettingsFeedbackTone.value = 'error'
    } finally {
      isSavingWasmSettings.value = false
    }
  }

  async function reloadRuntimeSettingsScreen(): Promise<void> {
    if (!options.enabled || isSavingWasmSettings.value) return
    isSavingWasmSettings.value = true
    wasmSettingsFeedback.value = ''
    wasmSettingsFeedbackTone.value = 'neutral'

    try {
      await options.refreshAll()
      await refreshWasmRuntimeSettings()
      wasmSettingsFeedback.value = 'Runtime settings reloaded.'
    } catch (error) {
      wasmSettingsFeedback.value = error instanceof Error ? error.message : String(error)
      wasmSettingsFeedbackTone.value = 'error'
    } finally {
      isSavingWasmSettings.value = false
    }
  }

  async function deleteCurrentWasmProviderConfig(): Promise<void> {
    if (!options.enabled || isSavingWasmSettings.value) return

    isSavingWasmSettings.value = true
    wasmSettingsFeedback.value = ''
    wasmSettingsFeedbackTone.value = 'neutral'

    try {
      wasmSettingsDraft.value = await deleteStoredWasmProviderConfig({
        transportMode: wasmSettingsDraft.value.transportMode,
        xrouterProvider: wasmSettingsDraft.value.xrouterProvider,
      })
      hasStoredWasmProviderSecret.value = false
      await options.refreshAll()
      await refreshWasmRuntimeSettings()
      wasmSettingsFeedback.value = 'Saved provider config deleted.'
    } catch (error) {
      wasmSettingsFeedback.value = error instanceof Error ? error.message : String(error)
      wasmSettingsFeedbackTone.value = 'error'
    } finally {
      isSavingWasmSettings.value = false
    }
  }

  async function connectOpenRouterOauth(): Promise<void> {
    if (!options.enabled || isSavingWasmSettings.value || isConnectingOpenRouterOauth.value) return

    if (!isOpenRouterOauthSupported()) {
      wasmSettingsFeedback.value = 'OpenRouter OAuth is not supported in this browser. Paste an API key manually instead.'
      wasmSettingsFeedbackTone.value = 'error'
      return
    }

    isConnectingOpenRouterOauth.value = true
    wasmSettingsFeedback.value = ''
    wasmSettingsFeedbackTone.value = 'neutral'

    try {
      await startOpenRouterOauthFlow()
    } catch (error) {
      wasmSettingsFeedback.value = error instanceof Error ? error.message : String(error)
      wasmSettingsFeedbackTone.value = 'error'
      isConnectingOpenRouterOauth.value = false
    }
  }

  watch(
    () => runtimeModelOptions.value,
    (modelOptions) => {
      if (!options.enabled) return
      if (modelOptions.length === 0) {
        if (!runtimeModelAllowsManualInput.value && wasmSettingsDraft.value.model.trim()) {
          wasmSettingsDraft.value = {
            ...wasmSettingsDraft.value,
            model: '',
          }
        }
        return
      }

      const current = wasmSettingsDraft.value.model.trim()
      if (current && modelOptions.some((option) => option.value === current)) return
      wasmSettingsDraft.value = {
        ...wasmSettingsDraft.value,
        model: modelOptions[0].value,
      }
    },
    { immediate: true },
  )

  watch(
    () => [
      wasmSettingsDraft.value.transportMode,
      wasmSettingsDraft.value.xrouterProvider,
      wasmSettingsDraft.value.providerBaseUrl.trim(),
      wasmSettingsDraft.value.apiKey.trim(),
    ],
    () => {
      if (!options.enabled) return
      if (wasmModelRefreshTimer) clearTimeout(wasmModelRefreshTimer)
      wasmModelRefreshTimer = setTimeout(() => {
        wasmModelRefreshTimer = null
        void refreshWasmRuntimeModelOptions()
      }, 150)
    },
  )

  onUnmounted(() => {
    if (!wasmModelRefreshTimer) return
    clearTimeout(wasmModelRefreshTimer)
    wasmModelRefreshTimer = null
  })

  return {
    wasmSettingsDraft,
    wasmRuntimeStatus,
    wasmSettingsFeedback,
    wasmSettingsFeedbackTone,
    hasStoredWasmProviderSecret,
    isConnectingOpenRouterOauth,
    runtimeModelAllowsManualInput,
    runtimeModelOptions,
    runtimePolicyOptions,
    selectedRuntimePolicy,
    derivedRuntimeStatus,
    showWasmRuntimeSetupCta,
    isSavingWasmSettings,
    refreshWasmRuntimeSettings,
    onWasmRuntimeModeChange,
    onWasmTransportModeChange,
    onWasmXrouterProviderChange,
    connectOpenRouterOauth,
    saveCurrentWasmRuntimeSettings,
    reloadRuntimeSettingsScreen,
    deleteCurrentWasmProviderConfig,
  }
}

async function maybeConsumeOpenRouterOauthCallback() {
  if (pendingOpenRouterOauthCallback === null) {
    pendingOpenRouterOauthCallback = consumeOpenRouterOauthCallback()
      .finally(() => {
        pendingOpenRouterOauthCallback = null
      })
  }

  const result = await pendingOpenRouterOauthCallback
  if (result.status === 'error') {
    throw new Error(result.message)
  }
  return result
}

async function finalizeOpenRouterOauth(
  apiKey: string,
  refreshAll: () => Promise<void>,
): Promise<void> {
  const currentDraft = await loadWasmRuntimeDraft()
  const baseDraft: WasmRuntimeDraft = {
    ...currentDraft,
    transportMode: 'xrouter-browser',
    xrouterProvider: 'openrouter',
    providerDisplayName: 'OpenRouter via Browser Runtime',
    providerBaseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
  }

  const modelIds = await listWasmModelsForDraft({
    providerBaseUrl: baseDraft.providerBaseUrl,
    apiKey,
  }).catch(() => [])

  const nextDraft: WasmRuntimeDraft = {
    ...baseDraft,
    model: baseDraft.model.trim() || modelIds[0] || '',
  }

  await saveWasmRuntimeDraft(nextDraft)
  await refreshAll()
}
