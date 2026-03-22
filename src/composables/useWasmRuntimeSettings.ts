import { computed, onUnmounted, ref, watch } from 'vue'
import type { DemoTransportMode, XrouterProvider } from 'xcodex-runtime/types'
import {
  applyStoredWasmTransportDefaults,
  applyStoredWasmXrouterProvider,
  deleteStoredWasmProviderConfig,
  deriveWasmRuntimeStatus,
  getWasmRuntimeStatus,
  hasStoredWasmProviderConfig,
  listWasmModelsForDraft,
  loadWasmRuntimeDraft,
  saveWasmRuntimeDraft,
  type WasmRuntimeDraft,
  type WasmRuntimeStatus,
} from '../runtime/wasm/settings'

type UseWasmRuntimeSettingsOptions = {
  enabled: boolean
  refreshAll: () => Promise<void>
}

export function useWasmRuntimeSettings(options: UseWasmRuntimeSettingsOptions) {
  const wasmSettingsDraft = ref<WasmRuntimeDraft>({
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

  async function refreshWasmRuntimeSettings(): Promise<void> {
    if (!options.enabled) return
    try {
      const [draft, status] = await Promise.all([loadWasmRuntimeDraft(), getWasmRuntimeStatus()])
      wasmSettingsDraft.value = draft
      wasmRuntimeStatus.value = status
      void refreshWasmRuntimeModelOptions(draft)
      hasStoredWasmProviderSecret.value = await hasStoredWasmProviderConfig({
        transportMode: draft.transportMode,
        xrouterProvider: draft.xrouterProvider,
      })
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

    isSavingWasmSettings.value = true
    wasmSettingsFeedback.value = ''
    wasmSettingsFeedbackTone.value = 'neutral'

    try {
      await saveWasmRuntimeDraft(wasmSettingsDraft.value)
      await options.refreshAll()
      await refreshWasmRuntimeSettings()
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
    runtimeModelAllowsManualInput,
    runtimeModelOptions,
    derivedRuntimeStatus,
    showWasmRuntimeSetupCta,
    isSavingWasmSettings,
    refreshWasmRuntimeSettings,
    onWasmTransportModeChange,
    onWasmXrouterProviderChange,
    saveCurrentWasmRuntimeSettings,
    reloadRuntimeSettingsScreen,
    deleteCurrentWasmProviderConfig,
  }
}
