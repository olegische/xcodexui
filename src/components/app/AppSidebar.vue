<template>
  <section class="sidebar-root">
    <div class="sidebar-scrollable">
      <SidebarThreadControls
        v-if="!isSidebarCollapsed"
        class="sidebar-thread-controls-host"
        :is-sidebar-collapsed="isSidebarCollapsed"
        :is-auto-refresh-enabled="isAutoRefreshEnabled"
        :auto-refresh-button-label="autoRefreshButtonLabel"
        :show-auto-refresh-button="!isWasmRuntime"
        :show-new-thread-button="true"
        @toggle-sidebar="$emit('toggle-sidebar')"
        @toggle-auto-refresh="$emit('toggle-auto-refresh')"
        @start-new-thread="$emit('start-new-thread-from-toolbar')"
      >
        <button
          class="sidebar-search-toggle"
          type="button"
          :aria-pressed="isSidebarSearchVisible"
          aria-label="Search threads"
          title="Search threads"
          @click="$emit('toggle-search')"
        >
          <IconTablerSearch class="sidebar-search-toggle-icon" />
        </button>
      </SidebarThreadControls>

      <div v-if="!isSidebarCollapsed && isSidebarSearchVisible" class="sidebar-search-bar">
        <IconTablerSearch class="sidebar-search-bar-icon" />
        <input
          :ref="setSidebarSearchInputRef"
          :value="sidebarSearchQuery"
          class="sidebar-search-input"
          type="text"
          placeholder="Filter threads..."
          @input="$emit('update:sidebar-search-query', ($event.target as HTMLInputElement).value)"
          @keydown="$emit('search-keydown', $event)"
        />
        <button
          v-if="sidebarSearchQuery.length > 0"
          class="sidebar-search-clear"
          type="button"
          aria-label="Clear search"
          @click="$emit('clear-search')"
        >
          <IconTablerX class="sidebar-search-clear-icon" />
        </button>
      </div>

      <button
        v-if="!isWasmRuntime && !isSidebarCollapsed"
        class="sidebar-skills-link"
        :class="{ 'is-active': isSkillsRoute }"
        type="button"
        @click="$emit('open-skills')"
      >
        Skills Hub
      </button>

      <SidebarThreadTree
        v-if="!isSidebarCollapsed"
        :groups="projectGroups"
        :project-display-name-by-id="projectDisplayNameById"
        :selected-thread-id="selectedThreadId"
        :is-loading="isLoadingThreads"
        :search-query="sidebarSearchQuery"
        :search-matched-thread-ids="serverMatchedThreadIds"
        :allow-project-browse="!isWasmRuntime"
        :show-worktree-indicators="!isWasmRuntime"
        @select="$emit('select-thread', $event)"
        @archive="$emit('archive-thread', $event)"
        @start-new-thread="$emit('start-new-thread', $event)"
        @rename-project="$emit('rename-project', $event)"
        @browse-project-files="$emit('browse-project-files', $event)"
        @rename-thread="$emit('rename-thread', $event)"
        @remove-project="$emit('remove-project', $event)"
        @reorder-project="$emit('reorder-project', $event)"
      />
    </div>

    <div v-if="!isSidebarCollapsed" class="sidebar-settings-area">
      <Transition name="settings-panel">
        <div v-if="isSettingsOpen" class="sidebar-settings-panel">
          <button class="sidebar-settings-row" type="button" @click="$emit('toggle-send-with-enter')">
            <span class="sidebar-settings-label">Require ⌘ + enter to send</span>
            <span class="sidebar-settings-toggle" :class="{ 'is-on': !sendWithEnter }" />
          </button>
          <button class="sidebar-settings-row" type="button" @click="$emit('cycle-in-progress-send-mode')">
            <span class="sidebar-settings-label">When busy, send as</span>
            <span class="sidebar-settings-value">{{ inProgressSendMode === 'steer' ? 'Steer' : 'Queue' }}</span>
          </button>
          <button class="sidebar-settings-row" type="button" @click="$emit('cycle-dark-mode')">
            <span class="sidebar-settings-label">Appearance</span>
            <span class="sidebar-settings-value">{{ darkModeLabel }}</span>
          </button>
          <button v-if="isWasmRuntime" class="sidebar-settings-row" type="button" @click="$emit('open-runtime-settings')">
            <span class="sidebar-settings-main">
              <span class="sidebar-settings-label">Runtime</span>
              <span
                v-if="isChaosMode"
                class="sidebar-settings-value sidebar-settings-value-danger"
                style="background-color: #cc241d; color: #ffffff;"
              >Chaos</span>
            </span>
            <IconTablerChevronRight class="sidebar-settings-row-chevron" />
          </button>
        </div>
      </Transition>
      <button class="sidebar-settings-button" type="button" @click="$emit('toggle-settings')">
        <IconTablerSettings class="sidebar-settings-icon" />
        <span>Settings</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SidebarThreadTree from '../sidebar/SidebarThreadTree.vue'
import SidebarThreadControls from '../sidebar/SidebarThreadControls.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import type { UiProjectGroup } from '../../types/codex'

const props = defineProps<{
  isSidebarCollapsed: boolean
  isAutoRefreshEnabled: boolean
  autoRefreshButtonLabel: string
  isWasmRuntime: boolean
  isMobile: boolean
  isSkillsRoute: boolean
  projectGroups: UiProjectGroup[]
  projectDisplayNameById: Record<string, string>
  selectedThreadId: string
  isLoadingThreads: boolean
  sidebarSearchQuery: string
  isSidebarSearchVisible: boolean
  serverMatchedThreadIds: string[] | null
  setSidebarSearchInputRef: (value: Element | { $el?: Element } | null, refs?: Record<string, unknown>) => void
  isSettingsOpen: boolean
  sendWithEnter: boolean
  inProgressSendMode: 'steer' | 'queue'
  darkMode: 'system' | 'light' | 'dark'
  isChaosMode?: boolean
}>()

defineEmits<{
  (event: 'toggle-sidebar'): void
  (event: 'toggle-auto-refresh'): void
  (event: 'start-new-thread-from-toolbar'): void
  (event: 'toggle-search'): void
  (event: 'clear-search'): void
  (event: 'search-keydown', payload: KeyboardEvent): void
  (event: 'update:sidebar-search-query', payload: string): void
  (event: 'open-skills'): void
  (event: 'select-thread', payload: string): void
  (event: 'archive-thread', payload: string): void
  (event: 'start-new-thread', payload: string): void
  (event: 'rename-project', payload: { projectName: string; displayName: string }): void
  (event: 'browse-project-files', payload: string): void
  (event: 'rename-thread', payload: { threadId: string; title: string }): void
  (event: 'remove-project', payload: string): void
  (event: 'reorder-project', payload: { projectName: string; toIndex: number }): void
  (event: 'toggle-send-with-enter'): void
  (event: 'cycle-in-progress-send-mode'): void
  (event: 'cycle-dark-mode'): void
  (event: 'open-runtime-settings'): void
  (event: 'toggle-settings'): void
}>()

const darkModeLabel = computed(() =>
  props.darkMode === 'system' ? 'System' : props.darkMode === 'dark' ? 'Dark' : 'Light',
)
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-root {
  @apply h-full flex flex-col select-none;
}

.sidebar-root input,
.sidebar-root textarea {
  @apply select-text;
}

.sidebar-scrollable {
  @apply flex-1 min-h-0 overflow-y-auto py-4 px-2 flex flex-col gap-2;
}

.sidebar-thread-controls-host {
  @apply mt-1 -translate-y-px px-2 pb-1;
}

.sidebar-search-toggle {
  @apply h-6.75 w-6.75 rounded-md border border-transparent bg-transparent text-zinc-600 flex items-center justify-center transition hover:border-zinc-200 hover:bg-zinc-50;
}

.sidebar-search-toggle[aria-pressed='true'] {
  @apply border-zinc-300 bg-zinc-100 text-zinc-700;
}

.sidebar-search-toggle-icon {
  @apply w-4 h-4;
}

.sidebar-search-bar {
  @apply flex items-center gap-1.5 mx-2 px-2 py-1 rounded-md border border-zinc-200 bg-white transition-colors focus-within:border-zinc-400;
}

.sidebar-search-bar-icon {
  @apply w-3.5 h-3.5 text-zinc-400 shrink-0;
}

.sidebar-search-input {
  @apply flex-1 min-w-0 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 outline-none border-none p-0;
}

.sidebar-search-clear {
  @apply w-4 h-4 rounded text-zinc-400 flex items-center justify-center transition hover:text-zinc-600;
}

.sidebar-search-clear-icon {
  @apply w-3.5 h-3.5;
}

.sidebar-skills-link {
  @apply mx-2 flex items-center rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 cursor-pointer;
}

.sidebar-skills-link.is-active {
  @apply bg-zinc-200 text-zinc-900 font-medium;
}

.sidebar-settings-area {
  @apply shrink-0 bg-zinc-100 pt-2 px-2 pb-2;
}

.sidebar-settings-button {
  @apply flex items-center gap-2 w-full rounded-lg border-0 bg-transparent px-2 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 cursor-pointer;
}

.sidebar-settings-icon {
  @apply w-4.5 h-4.5;
}

.sidebar-settings-panel {
  @apply mb-1 rounded-lg border border-zinc-200 bg-white overflow-hidden;
}

.sidebar-settings-row {
  @apply flex items-center justify-between w-full px-3 py-2.5 text-sm text-zinc-700 border-0 bg-transparent transition hover:bg-zinc-50 cursor-pointer;
}

.sidebar-settings-row + .sidebar-settings-row {
  @apply border-t border-zinc-100;
}

.sidebar-settings-label {
  @apply text-left;
}

.sidebar-settings-main {
  @apply flex items-center gap-2;
}

.sidebar-settings-row-chevron {
  @apply h-4 w-4 text-zinc-400;
}

.sidebar-settings-value {
  @apply text-xs text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5;
}

.sidebar-settings-value-danger {
  color: white;
  background-color: #cc241d;
}

.sidebar-settings-toggle {
  @apply relative w-9 h-5 rounded-full bg-zinc-300 transition-colors shrink-0;
}

.sidebar-settings-toggle::after {
  content: '';
  @apply absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm;
}

.sidebar-settings-toggle.is-on {
  @apply bg-zinc-800;
}

.sidebar-settings-toggle.is-on::after {
  transform: translateX(16px);
}

.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: all 150ms ease;
}

.settings-panel-enter-from,
.settings-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
