<template>
  <div class="content-grid">
    <div class="content-thread">
      <ThreadConversation
        :messages="filteredMessages"
        :is-loading="isLoadingMessages"
        :active-thread-id="composerThreadContextId"
        :scroll-state="selectedThreadScrollState"
        :live-overlay="liveOverlay"
        :is-turn-in-progress="isSelectedThreadInProgress"
        :is-wasm-runtime="isWasmRuntime"
        :allow-rollback="!isWasmRuntime"
        :is-rolling-back="isRollingBack"
        @update-scroll-state="$emit('update-scroll-state', $event)"
        @rollback="$emit('rollback', $event)"
      />
    </div>

    <div class="composer-with-queue">
      <QueuedMessages
        :messages="selectedThreadQueuedMessages"
        @steer="$emit('steer-queued-message', $event)"
        @delete="$emit('remove-queued-message', $event)"
      />
      <div v-if="showWasmRuntimeSetupCta" class="wasm-runtime-setup-card">
        <div class="wasm-runtime-setup-copy">
          <strong class="wasm-runtime-setup-title">{{ wasmRuntimeStatus.label }}</strong>
          <p class="wasm-runtime-setup-description">{{ wasmRuntimeStatus.detail }}</p>
        </div>
        <button class="wasm-runtime-setup-action" type="button" @click="$emit('open-runtime-settings')">
          Open runtime settings
        </button>
      </div>
      <ThreadPendingRequests
        v-else-if="selectedThreadServerRequests.length > 0"
        :pending-requests="selectedThreadServerRequests"
        @respond-server-request="$emit('respond-server-request', $event)"
      />
      <ThreadComposer
        v-else
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
        :is-turn-in-progress="isSelectedThreadInProgress"
        :is-interrupting-turn="isInterruptingTurn"
        :runtime-mode="runtimeMode"
        :has-queue-above="selectedThreadQueuedMessages.length > 0"
        :send-with-enter="sendWithEnter"
        :in-progress-submit-mode="inProgressSendMode"
        @submit="$emit('submit', $event)"
        @update:selected-model="$emit('select-model', $event)"
        @update:selected-reasoning-effort="$emit('select-reasoning-effort', $event)"
        @interrupt="$emit('interrupt-turn')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import QueuedMessages from '../content/QueuedMessages.vue'
import ThreadComposer from '../content/ThreadComposer.vue'
import ThreadConversation from '../content/ThreadConversation.vue'
import ThreadPendingRequests from '../content/ThreadPendingRequests.vue'
import type { SkillInfo } from '../../api/codexGateway'
import type {
  ReasoningEffort,
  ThreadScrollState,
  UiLiveOverlay,
  UiMessage,
  UiServerRequest,
} from '../../types/codex'
import type { QueuedMessage } from '../../composables/desktop-state/types'
import type { WasmRuntimeStatus } from '../../runtime/wasm/settings'
import type { RuntimeMode } from 'xcodex-runtime/types'

defineProps<{
  filteredMessages: UiMessage[]
  isLoadingMessages: boolean
  composerThreadContextId: string
  selectedThreadScrollState: ThreadScrollState | null
  liveOverlay: UiLiveOverlay | null
  selectedThreadServerRequests: UiServerRequest[]
  isSelectedThreadInProgress: boolean
  isWasmRuntime: boolean
  runtimeMode: RuntimeMode
  isRollingBack: boolean
  selectedThreadQueuedMessages: QueuedMessage[]
  showWasmRuntimeSetupCta: boolean
  wasmRuntimeStatus: WasmRuntimeStatus
  composerCwd: string
  models: string[]
  selectedModelId: string
  selectedReasoningEffort: ReasoningEffort | ''
  installedSkills: SkillInfo[]
  isInterruptingTurn: boolean
  sendWithEnter: boolean
  inProgressSendMode: 'steer' | 'queue'
}>()

defineEmits<{
  (event: 'update-scroll-state', payload: { threadId: string; state: ThreadScrollState }): void
  (event: 'respond-server-request', payload: { id: number; result?: unknown; error?: { code?: number; message: string } }): void
  (event: 'rollback', payload: { turnIndex: number }): void
  (event: 'steer-queued-message', payload: string): void
  (event: 'remove-queued-message', payload: string): void
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
  (event: 'interrupt-turn'): void
}>()
</script>

<style scoped>
@reference "tailwindcss";

.content-grid {
  @apply flex-1 min-h-0 flex flex-col gap-3;
}

.content-thread {
  @apply flex-1 min-h-0;
}

.composer-with-queue {
  @apply w-full;
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
</style>
