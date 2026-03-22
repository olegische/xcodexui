<template>
  <section class="runtime-settings-view">
    <div class="runtime-settings-header">
      <button class="runtime-settings-back" type="button" @click="$emit('back')">
        <IconTablerChevronLeft class="runtime-settings-back-icon" />
        <span>Back to app</span>
      </button>
      <div class="runtime-settings-heading">
        <div class="runtime-settings-title-row">
          <h2 class="runtime-settings-title">Runtime</h2>
          <span v-if="draft.runtimeMode === 'chaos'" class="runtime-settings-mode-badge">Chaos</span>
        </div>
        <p class="runtime-settings-subtitle">
          {{
            draft.runtimeMode === 'chaos'
              ? 'This mode enables higher-risk browser capabilities. Approval-gated tools may inspect or script the current page context, including browser-visible storage, DOM state, and same-origin app state.'
              : 'Browser-hosted XCodex WASM runtime configuration. Only the current provider config is stored locally in browser IndexedDB and handled directly by the browser runtime.'
          }}
        </p>
      </div>
    </div>

    <div class="settings-panel-card">
      <div class="settings-form-grid">
        <label class="settings-form-row">
          <span class="settings-form-copy">
            <span class="settings-form-title">Status</span>
            <span v-if="derivedRuntimeStatus.isError && derivedRuntimeStatus.detail" class="settings-form-description">{{ derivedRuntimeStatus.detail }}</span>
          </span>
          <span class="settings-chip" :class="{ 'is-error': derivedRuntimeStatus.isError }">
            {{ derivedRuntimeStatus.label }}
          </span>
        </label>

        <label class="settings-form-row">
          <span class="settings-form-copy">
            <span class="settings-form-title">Provider</span>
            <span class="settings-form-description">Select the runtime transport.</span>
          </span>
          <select
            :value="draft.transportMode"
            class="settings-select"
            @change="$emit('transport-mode-change', ($event.target as HTMLSelectElement).value as DemoTransportMode)"
          >
            <option value="xrouter-browser">Browser runtime router</option>
            <option value="openai">OpenAI</option>
            <option value="openai-compatible">Responses API-compatible</option>
          </select>
        </label>

        <label v-if="draft.transportMode === 'xrouter-browser'" class="settings-form-row">
          <span class="settings-form-copy">
            <span class="settings-form-title">Route</span>
            <span class="settings-form-description">Choose the provider route exposed by browser runtime.</span>
          </span>
          <select
            :value="draft.xrouterProvider"
            class="settings-select"
            @change="$emit('xrouter-provider-change', ($event.target as HTMLSelectElement).value as XrouterProvider)"
          >
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI-compatible</option>
            <option value="openrouter">OpenRouter</option>
            <option value="zai">ZAI</option>
          </select>
        </label>

        <label class="settings-form-row is-input">
          <span class="settings-form-copy">
            <span class="settings-form-title">API key</span>
            <span class="settings-form-description">Current API key for the browser runtime. OAuth is disabled.</span>
          </span>
          <input :value="draft.apiKey" class="settings-input" type="password" placeholder="Paste API key" @input="$emit('update:draft', { ...draft, apiKey: ($event.target as HTMLInputElement).value })" />
        </label>

        <label class="settings-form-row is-input">
          <span class="settings-form-copy">
            <span class="settings-form-title">Base URL</span>
            <span class="settings-form-description">Provider endpoint used by the runtime.</span>
          </span>
          <input :value="draft.providerBaseUrl" class="settings-input" type="text" placeholder="https://..." @input="$emit('update:draft', { ...draft, providerBaseUrl: ($event.target as HTMLInputElement).value })" />
        </label>

        <label class="settings-form-row is-input">
          <span class="settings-form-copy">
            <span class="settings-form-title">Model</span>
            <span class="settings-form-description">Default model id for new turns.</span>
          </span>
          <select
            v-if="runtimeModelOptions.length > 0"
            :value="draft.model"
            class="settings-select settings-select-model"
            @change="$emit('update:draft', { ...draft, model: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="option in runtimeModelOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <input
            v-else-if="runtimeModelAllowsManualInput"
            :value="draft.model"
            class="settings-input"
            type="text"
            placeholder="gpt-5 / deepseek-chat / ..."
            @input="$emit('update:draft', { ...draft, model: ($event.target as HTMLInputElement).value })"
          />
          <input
            v-else
            :value="draft.model"
            class="settings-input"
            type="text"
            placeholder="Models load after API key is set"
            disabled
          />
        </label>

        <label class="settings-form-row">
          <span class="settings-form-copy">
            <span class="settings-form-title">Security mode</span>
            <span class="settings-form-description">{{ selectedRuntimePolicy.description }}</span>
          </span>
          <select
            :value="draft.runtimeMode"
            class="settings-select"
            @change="$emit('runtime-mode-change', ($event.target as HTMLSelectElement).value as RuntimeMode)"
          >
            <option v-for="option in runtimePolicyOptions" :key="option.runtimeMode" :value="option.runtimeMode">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>

      <div class="settings-actions">
        <button class="settings-primary-action" type="button" :disabled="isSavingWasmSettings" @click="$emit('save')">
          {{ isSavingWasmSettings ? 'Saving…' : 'Save runtime' }}
        </button>
        <button class="settings-secondary-action" type="button" :disabled="isSavingWasmSettings" @click="$emit('reload')">
          Reload
        </button>
        <button v-if="hasStoredWasmProviderSecret" class="settings-danger-action" type="button" :disabled="isSavingWasmSettings" @click="$emit('delete-config')">
          Delete config
        </button>
      </div>

      <p v-if="wasmSettingsFeedback" class="settings-inline-note" :class="{ 'is-error': wasmSettingsFeedbackTone === 'error' }">
        {{ wasmSettingsFeedback }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DemoTransportMode, RuntimeMode, XrouterProvider } from 'xcodex-runtime/types'
import IconTablerChevronLeft from '../icons/IconTablerChevronLeft.vue'
import type {
  WasmRuntimeDraft,
  WasmRuntimePolicyPreset,
} from '../../runtime/wasm/settings'

defineProps<{
  draft: WasmRuntimeDraft
  runtimePolicyOptions: WasmRuntimePolicyPreset[]
  selectedRuntimePolicy: WasmRuntimePolicyPreset
  derivedRuntimeStatus: { label: string; detail: string; isError: boolean }
  runtimeModelOptions: Array<{ value: string; label: string }>
  runtimeModelAllowsManualInput: boolean
  isSavingWasmSettings: boolean
  hasStoredWasmProviderSecret: boolean
  wasmSettingsFeedback: string
  wasmSettingsFeedbackTone: 'neutral' | 'error'
}>()

defineEmits<{
  (event: 'back'): void
  (event: 'update:draft', payload: WasmRuntimeDraft): void
  (event: 'runtime-mode-change', payload: RuntimeMode): void
  (event: 'transport-mode-change', payload: DemoTransportMode): void
  (event: 'xrouter-provider-change', payload: XrouterProvider): void
  (event: 'save'): void
  (event: 'reload'): void
  (event: 'delete-config'): void
}>()
</script>

<style scoped>
@reference "tailwindcss";

.runtime-settings-view {
  @apply flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5;
}

.runtime-settings-header {
  @apply mb-4 flex flex-col gap-2;
}

.runtime-settings-back {
  @apply inline-flex items-center gap-2 self-start rounded-lg border-0 bg-transparent px-0 py-0 text-sm font-medium text-zinc-600 transition hover:text-zinc-900 cursor-pointer;
}

.runtime-settings-back-icon {
  @apply h-4 w-4;
}

.runtime-settings-heading {
  @apply flex flex-col gap-1;
}

.runtime-settings-title-row {
  @apply flex items-center gap-3;
}

.runtime-settings-title {
  @apply m-0 text-[1.45rem] font-semibold tracking-tight text-zinc-950;
}

.runtime-settings-mode-badge {
  @apply inline-flex items-center rounded-xl px-3 py-1 text-lg font-semibold leading-none text-white;
  background: #e33422;
}

.runtime-settings-subtitle {
  @apply m-0 text-[0.82rem] text-zinc-500;
}

.settings-panel-card {
  @apply w-full max-w-[82rem] overflow-hidden rounded-[1.4rem] border border-zinc-200 bg-zinc-50;
}

.settings-form-grid {
  @apply divide-y divide-zinc-200;
}

.settings-form-row {
  @apply flex flex-col items-start justify-between gap-3 px-5 py-3 sm:flex-row sm:items-center sm:gap-4;
}

.settings-form-row.is-input {
  @apply items-start;
}

.settings-form-copy {
  @apply flex min-w-0 w-full flex-col gap-1 sm:flex-1;
}

.settings-form-title {
  @apply text-[0.82rem] font-semibold text-zinc-900;
}

.settings-form-description {
  @apply text-[0.82rem] leading-6 text-zinc-500;
}

.settings-chip {
  @apply inline-flex shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-[0.72rem] font-medium text-white;
}

.settings-chip.is-error {
  @apply bg-[#d65d0e] text-white;
}

.settings-select,
.settings-input {
  @apply h-10 w-full min-w-0 shrink-0 rounded-[1rem] border border-zinc-200 bg-white px-4 text-[0.82rem] text-zinc-800 outline-none transition focus:border-zinc-400 sm:w-auto sm:min-w-[21rem];
}

.settings-select {
  @apply pr-11;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-position: right 12px center;
  background-repeat: no-repeat;
  background-size: 14px 14px;
}

.settings-select-model {
  @apply sm:w-[21rem];
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-actions {
  @apply flex justify-end gap-2 px-5 py-3;
}

.settings-primary-action {
  @apply rounded-[1rem] border border-zinc-900 bg-zinc-900 px-3 py-2 text-[0.82rem] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60;
}

.settings-secondary-action,
.settings-danger-action {
  @apply rounded-[1rem] border border-zinc-200 bg-white px-3 py-2 text-[0.82rem] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60;
}

.settings-inline-note {
  @apply m-0 border-t border-zinc-200 px-5 py-3 text-[0.82rem] text-zinc-500;
}

.settings-inline-note.is-error {
  @apply text-red-700;
}
</style>
