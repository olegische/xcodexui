import type { Ref } from 'vue'
import { getAvailableModelIds, getCurrentModelConfig, generateThreadTitle, persistThreadTitle, setDefaultModel } from '../../api/codexGateway'
import type { ReasoningEffort, UiProjectGroup } from '../../types/codex'

export function createThreadPreferences(params: {
  selectedModelId: Ref<string>
  selectedReasoningEffort: Ref<ReasoningEffort | ''>
  availableModelIds: Ref<string[]>
  threadTitleById: Ref<Record<string, string>>
  modelFallbackId: string
  reasoningEffortOptions: ReasoningEffort[]
  applyThreadFlags: () => void
  getThreadTitleCache: () => Promise<{ titles: Record<string, string> }>
}) {
  const {
    selectedModelId,
    selectedReasoningEffort,
    availableModelIds,
    threadTitleById,
    modelFallbackId,
    reasoningEffortOptions,
    applyThreadFlags,
    getThreadTitleCache,
  } = params

  async function applyFallbackModelSelection(): Promise<void> {
    selectedModelId.value = modelFallbackId
    if (!availableModelIds.value.includes(modelFallbackId)) {
      availableModelIds.value = [...availableModelIds.value, modelFallbackId]
    }
    try {
      await setDefaultModel(modelFallbackId)
    } catch {
      // Keep local selection even when persisting default model fails.
    }
  }

  function buildPendingTurnDetails(_modelId: string, _effort: ReasoningEffort | ''): string[] {
    return []
  }

  async function refreshModelPreferences(): Promise<void> {
    try {
      const [modelIds, currentConfig] = await Promise.all([getAvailableModelIds(), getCurrentModelConfig()])
      availableModelIds.value = modelIds
      const hasSelectedModel = selectedModelId.value.length > 0 && modelIds.includes(selectedModelId.value)
      if (!hasSelectedModel) {
        if (currentConfig.model && modelIds.includes(currentConfig.model)) selectedModelId.value = currentConfig.model
        else if (modelIds.length > 0) selectedModelId.value = modelIds[0]
        else selectedModelId.value = ''
      }
      if (currentConfig.reasoningEffort && reasoningEffortOptions.includes(currentConfig.reasoningEffort)) {
        selectedReasoningEffort.value = currentConfig.reasoningEffort
      }
    } catch {
      // Keep chat UI usable even if model metadata is temporarily unavailable.
    }
  }

  async function loadThreadTitleCacheIfNeeded(): Promise<void> {
    if (Object.keys(threadTitleById.value).length > 0) return
    try {
      const cache = await getThreadTitleCache()
      if (Object.keys(cache.titles).length > 0) threadTitleById.value = cache.titles
    } catch {
      // Title cache is optional; keep UI functional.
    }
  }

  async function requestThreadTitleGeneration(threadId: string, prompt: string, cwd: string | null): Promise<void> {
    if (threadTitleById.value[threadId]) return
    const trimmed = prompt.trim()
    if (!trimmed) return
    const truncated = trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed
    try {
      const title = await generateThreadTitle(truncated, cwd)
      if (!title || threadTitleById.value[threadId]) return
      threadTitleById.value = { ...threadTitleById.value, [threadId]: title }
      applyThreadFlags()
      void persistThreadTitle(threadId, title)
    } catch {
      // Title generation is best-effort.
    }
  }

  return {
    applyFallbackModelSelection,
    buildPendingTurnDetails,
    refreshModelPreferences,
    loadThreadTitleCacheIfNeeded,
    requestThreadTitleGeneration,
  }
}
