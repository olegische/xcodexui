<template>
  <div class="content-grid">
    <div class="new-thread-empty">
      <img
        v-if="isWasmRuntime"
        class="new-thread-logo"
        :src="wasmHeroLogoSrc"
        alt="XCodex WASM"
      />
      <p class="new-thread-hero">{{ isWasmRuntime ? 'Run in the browser' : "Let's build" }}</p>
      <ComposerDropdown
        class="new-thread-folder-dropdown"
        :model-value="newThreadCwd"
        :options="newThreadFolderOptions"
        placeholder="Choose folder"
        :enable-search="true"
        :search-placeholder="isWasmRuntime ? 'Workspace path' : 'Quick search project'"
        :show-add-action="!isWasmRuntime"
        add-action-label="+ Add new project"
        :default-add-value="defaultNewProjectName"
        add-placeholder="Project name or absolute path"
        :disabled="false"
        @update:model-value="$emit('select-folder', $event)"
        @add="$emit('add-project', $event)"
      />
      <ComposerRuntimeDropdown
        v-if="!isWasmRuntime"
        class="new-thread-runtime-dropdown"
        :model-value="newThreadRuntime"
        :include-worktree="true"
        @update:model-value="$emit('update:new-thread-runtime', $event)"
      />
      <div
        v-if="!isWasmRuntime && worktreeInitStatus.phase !== 'idle'"
        class="worktree-init-status"
        :class="{
          'is-running': worktreeInitStatus.phase === 'running',
          'is-error': worktreeInitStatus.phase === 'error',
        }"
      >
        <strong class="worktree-init-status-title">{{ worktreeInitStatus.title }}</strong>
        <span class="worktree-init-status-message">{{ worktreeInitStatus.message }}</span>
      </div>
      <div v-if="showWasmRuntimeSetupCta" class="wasm-runtime-setup-card">
        <div class="wasm-runtime-setup-copy">
          <strong class="wasm-runtime-setup-title">{{ wasmRuntimeStatus.label }}</strong>
          <p class="wasm-runtime-setup-description">{{ wasmRuntimeStatus.detail }}</p>
        </div>
        <button class="wasm-runtime-setup-action" type="button" @click="$emit('open-runtime-settings')">
          Open runtime settings
        </button>
      </div>
      <div v-else-if="isWasmRuntime && runtimeMode === 'chaos'" class="runtime-mode-note runtime-mode-note-chaos">
        <strong class="runtime-mode-note-title">Chaos mode</strong>
        <p class="chaos-runtime-note-body">
          {{ runtimeModePresentation.description }}
        </p>
      </div>
    </div>

    <ThreadComposer
      v-if="!showWasmRuntimeSetupCta"
      :active-thread-id="composerThreadContextId"
      :cwd="composerCwd"
      :models="models"
      :selected-model="selectedModelId"
      :selected-reasoning-effort="selectedReasoningEffort"
      :skills="installedSkills"
      :enable-skills="!isWasmRuntime"
      :enable-file-mentions="!isWasmRuntime"
      :enable-attachments="!isWasmRuntime"
      :enable-dictation="!isWasmRuntime"
      :is-turn-in-progress="false"
      :is-interrupting-turn="false"
      :runtime-mode="runtimeMode"
      :send-with-enter="sendWithEnter"
      :in-progress-submit-mode="inProgressSendMode"
      @submit="$emit('submit', $event)"
      @update:selected-model="$emit('select-model', $event)"
      @update:selected-reasoning-effort="$emit('select-reasoning-effort', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ComposerDropdown from '../content/ComposerDropdown.vue'
import ComposerRuntimeDropdown from '../content/ComposerRuntimeDropdown.vue'
import ThreadComposer from '../content/ThreadComposer.vue'
import type { RuntimeMode } from 'xcodex-runtime/types'
import type { SkillInfo } from '../../api/codexGateway'
import { getRuntimeModePresentation } from '../../runtime/wasm/runtimeModes'
import type { ReasoningEffort } from '../../types/codex'
import type { WasmRuntimeStatus } from '../../runtime/wasm/settings'

const props = defineProps<{
  isWasmRuntime: boolean
  runtimeMode: RuntimeMode
  wasmHeroLogoSrc: string
  newThreadCwd: string
  newThreadFolderOptions: Array<{ value: string; label: string }>
  defaultNewProjectName: string
  newThreadRuntime: 'local' | 'worktree'
  worktreeInitStatus: { phase: 'idle' | 'running' | 'error'; title: string; message: string }
  showWasmRuntimeSetupCta: boolean
  wasmRuntimeStatus: WasmRuntimeStatus
  composerThreadContextId: string
  composerCwd: string
  models: string[]
  selectedModelId: string
  selectedReasoningEffort: ReasoningEffort | ''
  installedSkills: SkillInfo[]
  sendWithEnter: boolean
  inProgressSendMode: 'steer' | 'queue'
}>()

const runtimeModePresentation = computed(() => getRuntimeModePresentation(props.runtimeMode))

defineEmits<{
  (event: 'select-folder', payload: string): void
  (event: 'add-project', payload: string): void
  (event: 'update:new-thread-runtime', payload: 'local' | 'worktree'): void
  (event: 'open-runtime-settings'): void
  (event: 'submit', payload: {
    text: string
    imageUrls: string[]
    fileAttachments: Array<{ label: string; path: string; fsPath: string }>
    skills: Array<{ name: string; path: string }>
    mode: 'steer' | 'queue'
  }): void
  (event: 'select-model', payload: string): void
  (event: 'select-reasoning-effort', payload: ReasoningEffort | ''): void
}>()
</script>

<style scoped>
@reference "tailwindcss";

.content-grid {
  @apply flex-1 min-h-0 flex flex-col gap-3;
}

.new-thread-empty {
  @apply flex-1 min-h-0 flex flex-col items-center justify-center gap-0.5 px-3 sm:px-6;
}

.new-thread-logo {
  @apply mb-3 h-auto w-full max-w-[9rem] sm:mb-4 sm:max-w-[11rem];
}

.new-thread-hero {
  @apply m-0 text-2xl sm:text-[2.5rem] font-normal leading-[1.05] text-zinc-900;
}

.new-thread-folder-dropdown {
  @apply text-2xl sm:text-[2.5rem] text-zinc-500;
}

.new-thread-folder-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-auto text-2xl sm:text-[2.5rem] leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-value) {
  @apply leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-chevron) {
  @apply h-4 w-4 sm:h-5 sm:w-5 mt-0;
}

.new-thread-runtime-dropdown {
  @apply mt-3;
}

.worktree-init-status {
  @apply mt-3 flex w-full max-w-xl flex-col gap-1 rounded-xl border px-3 py-2 text-sm;
}

.worktree-init-status.is-running {
  @apply border-zinc-300 bg-zinc-50 text-zinc-700;
}

.worktree-init-status.is-error {
  @apply border-red-300 bg-red-50 text-red-800;
}

.worktree-init-status-title {
  @apply font-medium;
}

.worktree-init-status-message {
  @apply break-all;
}

.wasm-runtime-setup-card {
  @apply mt-4 flex w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 mx-auto;
}

.wasm-runtime-setup-copy {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}

.wasm-runtime-setup-title {
  @apply text-sm font-semibold text-amber-100;
}

.wasm-runtime-setup-description {
  @apply m-0 text-sm text-amber-50/80;
}

.wasm-runtime-setup-action {
  @apply inline-flex shrink-0 items-center rounded-full border border-amber-200/30 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 transition hover:bg-white cursor-pointer;
}

.runtime-mode-note-chaos {
  @apply mt-4 w-full max-w-xl rounded-2xl border px-4 py-3 mx-auto;
  border-color: #cc241d;
  background-color: #cc241d;
}

.runtime-mode-note-title {
  @apply text-white;
}

.chaos-runtime-note-body {
  @apply text-white;
}
</style>
