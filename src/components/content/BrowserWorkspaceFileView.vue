<template>
  <section class="browser-workspace-file-view">
    <div class="browser-workspace-file-toolbar">
      <button class="browser-workspace-file-button" type="button" @click="goBack">
        Back
      </button>
      <button
        class="browser-workspace-file-button"
        type="button"
        :disabled="isLoading || !content"
        @click="copyContent"
      >
        Copy
      </button>
    </div>

    <p class="browser-workspace-file-meta">{{ resolvedPath || uri }}</p>

    <p v-if="isLoading" class="browser-workspace-file-status">Loading file…</p>
    <p v-else-if="errorText" class="browser-workspace-file-error">{{ errorText }}</p>
    <pre v-else class="browser-workspace-file-content">{{ content }}</pre>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { readIndexedDbWorkspaceFile } from '../../runtime/wasm/browserWorkspaceLinks'

const props = defineProps<{
  uri: string
}>()

const router = useRouter()
const isLoading = ref(false)
const resolvedPath = ref('')
const content = ref('')
const errorText = ref('')

async function loadFile(uri: string): Promise<void> {
  if (!uri.trim()) {
    resolvedPath.value = ''
    content.value = ''
    errorText.value = 'Missing browser workspace file URI.'
    return
  }

  isLoading.value = true
  errorText.value = ''

  try {
    const result = await readIndexedDbWorkspaceFile(uri)
    resolvedPath.value = result.path
    content.value = result.content
  } catch (error) {
    resolvedPath.value = ''
    content.value = ''
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    isLoading.value = false
  }
}

function goBack(): void {
  void router.push({ name: 'home' })
}

async function copyContent(): Promise<void> {
  if (!content.value || typeof navigator === 'undefined' || !navigator.clipboard) return
  await navigator.clipboard.writeText(content.value)
}

watch(
  () => props.uri,
  (uri) => {
    void loadFile(uri)
  },
  { immediate: true },
)
</script>

<style scoped>
@reference "tailwindcss";

.browser-workspace-file-view {
  @apply mx-auto flex h-full w-full max-w-5xl flex-col gap-4 px-4 py-5;
}

.browser-workspace-file-toolbar {
  @apply flex items-center gap-2;
}

.browser-workspace-file-button {
  @apply inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50;
}

.browser-workspace-file-meta {
  @apply m-0 text-sm text-neutral-400 break-all;
}

.browser-workspace-file-status {
  @apply m-0 text-sm text-neutral-300;
}

.browser-workspace-file-error {
  @apply m-0 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100;
}

.browser-workspace-file-content {
  @apply min-h-0 flex-1 overflow-auto rounded-3xl border border-neutral-800 bg-neutral-950 p-5 text-sm leading-6 text-neutral-100;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
