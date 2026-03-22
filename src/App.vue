<template>
  <DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" @close-sidebar="setSidebarCollapsed(true)">
    <template #sidebar>
      <AppSidebar
        :is-sidebar-collapsed="isSidebarCollapsed"
        :is-auto-refresh-enabled="isAutoRefreshEnabled"
        :auto-refresh-button-label="autoRefreshButtonLabel"
        :is-wasm-runtime="isWasmRuntime"
        :is-mobile="isMobile"
        :is-skills-route="isSkillsRoute"
        :project-groups="projectGroups"
        :project-display-name-by-id="projectDisplayNameById"
        :selected-thread-id="selectedThreadId"
        :is-loading-threads="isLoadingThreads"
        :sidebar-search-query="sidebarSearchQuery"
        :is-sidebar-search-visible="isSidebarSearchVisible"
        :server-matched-thread-ids="serverMatchedThreadIds"
        :set-sidebar-search-input-ref="setSidebarSearchInputRef"
        :is-settings-open="isSettingsOpen"
        :send-with-enter="sendWithEnter"
        :in-progress-send-mode="inProgressSendMode"
        :dark-mode="darkMode"
        :is-chaos-mode="isChaosMode"
        @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
        @toggle-auto-refresh="onToggleAutoRefreshTimer"
        @start-new-thread-from-toolbar="onStartNewThreadFromToolbar"
        @toggle-search="toggleSidebarSearch"
        @clear-search="clearSidebarSearch"
        @search-keydown="onSidebarSearchKeydown"
        @update:sidebar-search-query="sidebarSearchQuery = $event"
        @open-skills="onOpenSkills"
        @select-thread="onSelectThread"
        @archive-thread="onArchiveThread"
        @start-new-thread="onStartNewThread"
        @rename-project="onRenameProject"
        @browse-project-files="onBrowseProjectFiles"
        @rename-thread="onRenameThread"
        @remove-project="onRemoveProject"
        @reorder-project="onReorderProject"
        @toggle-send-with-enter="toggleSendWithEnter"
        @cycle-in-progress-send-mode="cycleInProgressSendMode"
        @cycle-dark-mode="cycleDarkMode"
        @open-runtime-settings="openRuntimeSettings"
        @toggle-settings="isSettingsOpen = !isSettingsOpen"
      />
    </template>

    <template #content>
      <section class="content-root">
        <ContentHeader v-if="!isRuntimeSettingsRoute" :title="contentTitle">
          <template #leading>
            <SidebarThreadControls
              v-if="isSidebarCollapsed || isMobile"
              class="sidebar-thread-controls-header-host"
              :is-sidebar-collapsed="isSidebarCollapsed"
              :is-auto-refresh-enabled="isAutoRefreshEnabled"
              :auto-refresh-button-label="autoRefreshButtonLabel"
              :show-auto-refresh-button="!isWasmRuntime"
              :show-new-thread-button="true"
              @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
              @toggle-auto-refresh="onToggleAutoRefreshTimer"
              @start-new-thread="onStartNewThreadFromToolbar"
            />
          </template>
        </ContentHeader>

        <section class="content-body">
          <RuntimeSettingsView
            v-if="isRuntimeSettingsRoute"
            :draft="wasmSettingsDraft"
            :runtime-policy-options="runtimePolicyOptions"
            :selected-runtime-policy="selectedRuntimePolicy"
            :derived-runtime-status="derivedRuntimeStatus"
            :runtime-model-options="runtimeModelOptions"
            :runtime-model-allows-manual-input="runtimeModelAllowsManualInput"
            :is-saving-wasm-settings="isSavingWasmSettings"
            :has-stored-wasm-provider-secret="hasStoredWasmProviderSecret"
            :wasm-settings-feedback="wasmSettingsFeedback"
            :wasm-settings-feedback-tone="wasmSettingsFeedbackTone"
            @back="goBackFromRuntimeSettings"
            @update:draft="wasmSettingsDraft = $event"
            @runtime-mode-change="onWasmRuntimeModeChange"
            @transport-mode-change="onWasmTransportModeChange"
            @xrouter-provider-change="onWasmXrouterProviderChange"
            @save="saveCurrentWasmRuntimeSettings"
            @reload="reloadRuntimeSettingsScreen"
            @delete-config="deleteCurrentWasmProviderConfig"
          />
          <SkillsHub v-else-if="!isWasmRuntime && isSkillsRoute" @skills-changed="onSkillsChanged" />
          <HomeView
            v-else-if="isHomeRoute"
            :is-wasm-runtime="isWasmRuntime"
            :is-chaos-mode="isChaosMode"
            :wasm-hero-logo-src="wasmHeroLogoSrc"
            :new-thread-cwd="newThreadCwd"
            :new-thread-folder-options="newThreadFolderOptions"
            :default-new-project-name="defaultNewProjectName"
            :new-thread-runtime="newThreadRuntime"
            :worktree-init-status="worktreeInitStatus"
            :show-wasm-runtime-setup-cta="showWasmRuntimeSetupCta"
            :wasm-runtime-status="wasmRuntimeStatus"
            :composer-thread-context-id="composerThreadContextId"
            :composer-cwd="composerCwd"
            :models="availableComposerModels"
            :selected-model-id="selectedModelId"
            :selected-reasoning-effort="selectedReasoningEffort"
            :installed-skills="installedSkills"
            :send-with-enter="sendWithEnter"
            :in-progress-send-mode="inProgressSendMode"
            @select-folder="onSelectNewThreadFolder"
            @add-project="onAddNewProject"
            @update:new-thread-runtime="newThreadRuntime = $event"
            @open-runtime-settings="openRuntimeSettings"
            @submit="onSubmitThreadMessage"
            @select-model="onSelectModel"
            @select-reasoning-effort="onSelectReasoningEffort"
          />
          <ThreadView
            v-else
            :filtered-messages="filteredMessages"
            :is-loading-messages="isLoadingMessages"
            :composer-thread-context-id="composerThreadContextId"
            :selected-thread-scroll-state="selectedThreadScrollState"
            :live-overlay="liveOverlay"
            :selected-thread-server-requests="selectedThreadServerRequests"
            :is-selected-thread-in-progress="isSelectedThreadInProgress"
            :is-wasm-runtime="isWasmRuntime"
            :is-chaos-mode="isChaosMode"
            :is-rolling-back="isRollingBack"
            :selected-thread-queued-messages="selectedThreadQueuedMessages"
            :show-wasm-runtime-setup-cta="showWasmRuntimeSetupCta"
            :wasm-runtime-status="wasmRuntimeStatus"
            :composer-cwd="composerCwd"
            :models="availableComposerModels"
            :selected-model-id="selectedModelId"
            :selected-reasoning-effort="selectedReasoningEffort"
            :installed-skills="installedSkills"
            :is-interrupting-turn="isInterruptingTurn"
            :send-with-enter="sendWithEnter"
            :in-progress-send-mode="inProgressSendMode"
            @update-scroll-state="onUpdateThreadScrollState"
            @respond-server-request="onRespondServerRequest"
            @rollback="onRollback"
            @steer-queued-message="steerQueuedMessage"
            @remove-queued-message="removeQueuedMessage"
            @open-runtime-settings="openRuntimeSettings"
            @submit="onSubmitThreadMessage"
            @select-model="onSelectModel"
            @select-reasoning-effort="onSelectReasoningEffort"
            @interrupt-turn="onInterruptTurn"
          />
        </section>
      </section>
    </template>
  </DesktopLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import SkillsHub from './components/content/SkillsHub.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import AppSidebar from './components/app/AppSidebar.vue'
import HomeView from './components/app/HomeView.vue'
import RuntimeSettingsView from './components/app/RuntimeSettingsView.vue'
import ThreadView from './components/app/ThreadView.vue'
import { useDesktopState } from './composables/useDesktopState'
import { useMobile } from './composables/useMobile'
import { useAppShellPrefs } from './composables/useAppShellPrefs'
import { useNewThreadSetup } from './composables/useNewThreadSetup'
import { useSidebarThreadSearch } from './composables/useSidebarThreadSearch'
import { useWasmRuntimeSettings } from './composables/useWasmRuntimeSettings'
import { BROWSER_WORKSPACE_ROOT, IS_WASM_RUNTIME } from './config/runtime'
import type { ReasoningEffort, ThreadScrollState } from './types/codex'

const isWasmRuntime = IS_WASM_RUNTIME

const {
  projectGroups,
  projectDisplayNameById,
  selectedThread,
  selectedThreadScrollState,
  selectedThreadServerRequests,
  selectedLiveOverlay,
  selectedThreadId,
  availableModelIds,
  selectedModelId,
  selectedReasoningEffort,
  installedSkills,
  messages,
  isLoadingThreads,
  isLoadingMessages,
  isInterruptingTurn,
  isAutoRefreshEnabled,
  autoRefreshSecondsLeft,
  refreshAll,
  refreshSkills,
  selectThread,
  setThreadScrollState,
  archiveThreadById,
  renameThreadById,
  sendMessageToSelectedThread,
  sendMessageToNewThread,
  interruptSelectedThreadTurn,
  rollbackSelectedThread,
  isRollingBack,
  selectedThreadQueuedMessages,
  removeQueuedMessage,
  steerQueuedMessage,
  setSelectedModelId,
  setSelectedReasoningEffort,
  respondToPendingServerRequest,
  renameProject,
  removeProject,
  reorderProject,
  pinProjectToTop,
  toggleAutoRefreshTimer,
  startPolling,
  stopPolling,
} = useDesktopState()

const route = useRoute()
const router = useRouter()
const { isMobile } = useMobile()
const {
  isSidebarCollapsed,
  isSettingsOpen,
  sendWithEnter,
  inProgressSendMode,
  darkMode,
  prefersDarkMode,
  setSidebarCollapsed,
  toggleSendWithEnter,
  cycleInProgressSendMode,
  cycleDarkMode,
} = useAppShellPrefs()
const {
  sidebarSearchQuery,
  isSidebarSearchVisible,
  sidebarSearchInputRef,
  serverMatchedThreadIds,
  setSidebarSearchInputRef,
  toggleSidebarSearch,
  clearSidebarSearch,
  onSidebarSearchKeydown,
} = useSidebarThreadSearch()
const {
  wasmSettingsDraft,
  wasmRuntimeStatus,
  wasmSettingsFeedback,
  wasmSettingsFeedbackTone,
  hasStoredWasmProviderSecret,
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
  saveCurrentWasmRuntimeSettings,
  reloadRuntimeSettingsScreen,
  deleteCurrentWasmProviderConfig,
} = useWasmRuntimeSettings({ enabled: isWasmRuntime, refreshAll })
const {
  newThreadCwd,
  newThreadRuntime,
  worktreeInitStatus,
  defaultNewProjectName,
  newThreadFolderOptions,
  resetWorktreeInitStatus,
  onSelectNewThreadFolder,
  onAddNewProject,
  refreshDefaultProjectName,
  loadHomeDirectory,
  loadWorkspaceRootOptionsState,
  submitFirstMessageForNewThread,
} = useNewThreadSetup({
  isWasmRuntime,
  projectGroups,
  projectDisplayNameById,
  pinProjectToTop,
})

const isRouteSyncInProgress = ref(false)
const hasInitialized = ref(false)

const routeThreadId = computed(() => {
  const rawThreadId = route.params.threadId
  return typeof rawThreadId === 'string' ? rawThreadId : ''
})

const runtimeSettingsTab = computed(() => {
  const rawTab = route.params.tab
  return typeof rawTab === 'string' ? rawTab : ''
})

const knownThreadIdSet = computed(() => {
  const ids = new Set<string>()
  for (const group of projectGroups.value) {
    for (const thread of group.threads) {
      ids.add(thread.id)
    }
  }
  return ids
})

const isHomeRoute = computed(() => route.name === 'home')
const isSkillsRoute = computed(() => !isWasmRuntime && route.name === 'skills')
const isRuntimeSettingsRoute = computed(() => route.name === 'settings' && runtimeSettingsTab.value === 'runtime')
const isChaosMode = computed(() => isWasmRuntime && wasmSettingsDraft.value.runtimeMode === 'chaos')
const contentTitle = computed(() => {
  if (isSkillsRoute.value) return 'Skills'
  if (isHomeRoute.value) return 'New thread'
  return selectedThread.value?.title ?? 'Choose a thread'
})
const autoRefreshButtonLabel = computed(() =>
  isAutoRefreshEnabled.value ? `Auto refresh in ${String(autoRefreshSecondsLeft.value)}s` : 'Enable 4s refresh',
)
const filteredMessages = computed(() =>
  messages.value.filter((message) => {
    const type = normalizeMessageType(message.messageType, message.role)
    return !['turnActivity.live', 'turnError.live', 'agentReasoning.live'].includes(type)
  }),
)
const liveOverlay = computed(() => selectedLiveOverlay.value)
const composerThreadContextId = computed(() => (isHomeRoute.value ? '__new-thread__' : selectedThreadId.value))
const isEffectiveDarkMode = computed(() =>
  darkMode.value === 'dark' || (darkMode.value === 'system' && prefersDarkMode.value),
)
const wasmHeroLogoSrc = computed(() =>
  isEffectiveDarkMode.value ? '/logo-dark.svg?v=neutral950' : '/logo-white.svg?v=light',
)
const composerCwd = computed(() => {
  if (isHomeRoute.value) return newThreadCwd.value.trim()
  return selectedThread.value?.cwd?.trim() ?? ''
})
const isSelectedThreadInProgress = computed(() => !isHomeRoute.value && selectedThread.value?.inProgress === true)
const availableComposerModels = computed(() =>
  isWasmRuntime
    ? runtimeModelOptions.value.map((option) => option.value)
    : availableModelIds.value,
)

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  void initialize()

  if (isWasmRuntime) {
    newThreadCwd.value = BROWSER_WORKSPACE_ROOT
    defaultNewProjectName.value = 'Workspace'
    void refreshWasmRuntimeSettings()
    return
  }

  void loadHomeDirectory()
  void loadWorkspaceRootOptionsState()
  void refreshDefaultProjectName()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeyDown)
  stopPolling()
})

watch(
  () => isSettingsOpen.value,
  (open) => {
    if (open && isWasmRuntime) void refreshWasmRuntimeSettings()
  },
)

watch(
  () => isRuntimeSettingsRoute.value,
  (active) => {
    if (active && isWasmRuntime) void refreshWasmRuntimeSettings()
  },
)

watch(
  () => isHomeRoute.value,
  (active) => {
    if (active && isWasmRuntime) void refreshWasmRuntimeSettings()
  },
)

watch(
  () => [
    route.name,
    routeThreadId.value,
    isLoadingThreads.value,
    knownThreadIdSet.value.has(routeThreadId.value),
    selectedThreadId.value,
  ] as const,
  async () => {
    if (!hasInitialized.value) return
    await syncThreadSelectionWithRoute()
  },
)

watch(
  () => selectedThreadId.value,
  async (threadId) => {
    if (!hasInitialized.value) return
    if (isRouteSyncInProgress.value) return
    if (isHomeRoute.value || isSkillsRoute.value || isRuntimeSettingsRoute.value) return

    if (!threadId) {
      if (route.name !== 'home') await router.replace({ name: 'home' })
      return
    }

    if (route.name === 'thread' && routeThreadId.value === threadId) return
    await router.replace({ name: 'thread', params: { threadId } })
  },
)

watch(
  () => newThreadFolderOptions.value,
  (options) => {
    if (options.length === 0) {
      newThreadCwd.value = isWasmRuntime ? BROWSER_WORKSPACE_ROOT : ''
      return
    }

    const hasSelected = options.some((option) => option.value === newThreadCwd.value)
    if (!hasSelected) {
      newThreadCwd.value = options[0].value
    }

    if (!isWasmRuntime) void refreshDefaultProjectName()
  },
  { immediate: true },
)

watch(
  () => newThreadCwd.value,
  () => {
    resetWorktreeInitStatus()
    if (!isWasmRuntime) void refreshDefaultProjectName()
  },
)

watch(
  () => newThreadRuntime.value,
  (runtime) => {
    if (runtime === 'local') resetWorktreeInitStatus()
  },
)

watch(
  () => route.name,
  (name) => {
    if (name !== 'home') resetWorktreeInitStatus()
  },
)

watch(
  () => selectedThreadId.value,
  () => {
    resetWorktreeInitStatus()
  },
)

watch(isMobile, (mobile) => {
  if (mobile && !isSidebarCollapsed.value) setSidebarCollapsed(true)
})

function onSkillsChanged(): void {
  void refreshSkills()
}

function onOpenSkills(): void {
  void router.push({ name: 'skills' })
  if (isMobile.value) setSidebarCollapsed(true)
}

function openRuntimeSettings(): void {
  isSettingsOpen.value = false
  void router.push({ name: 'settings', params: { tab: 'runtime' } })
  if (isMobile.value) setSidebarCollapsed(true)
}

function goBackFromRuntimeSettings(): void {
  if (selectedThreadId.value) {
    void router.push({ name: 'thread', params: { threadId: selectedThreadId.value } })
    return
  }
  void router.push({ name: 'home' })
}

function onSelectThread(threadId: string): void {
  if (!threadId) return
  if (route.name === 'thread' && routeThreadId.value === threadId) return
  void router.push({ name: 'thread', params: { threadId } })
  if (isMobile.value) setSidebarCollapsed(true)
}

function onArchiveThread(threadId: string): void {
  void archiveThreadById(threadId)
}

function onStartNewThread(projectName: string): void {
  const projectGroup = projectGroups.value.find((group) => group.projectName === projectName)
  const projectCwd = projectGroup?.threads[0]?.cwd?.trim() ?? ''
  if (projectCwd) newThreadCwd.value = projectCwd
  if (isMobile.value) setSidebarCollapsed(true)
  if (!isHomeRoute.value) void router.push({ name: 'home' })
}

function onBrowseProjectFiles(projectName: string): void {
  if (isWasmRuntime) return
  const projectGroup = projectGroups.value.find((group) => group.projectName === projectName)
  const projectCwd = projectGroup?.threads[0]?.cwd?.trim() ?? ''
  if (!projectCwd || typeof window === 'undefined') return
  window.open(`/codex-local-browse${encodeURI(projectCwd)}`, '_blank', 'noopener,noreferrer')
}

function onStartNewThreadFromToolbar(): void {
  const cwd = selectedThread.value?.cwd?.trim() ?? ''
  if (cwd) newThreadCwd.value = cwd
  if (isMobile.value) setSidebarCollapsed(true)
  if (!isHomeRoute.value) void router.push({ name: 'home' })
}

function onRenameProject(payload: { projectName: string; displayName: string }): void {
  renameProject(payload.projectName, payload.displayName)
}

function onRenameThread(payload: { threadId: string; title: string }): void {
  void renameThreadById(payload.threadId, payload.title)
}

function onRemoveProject(projectName: string): void {
  removeProject(projectName)
}

function onReorderProject(payload: { projectName: string; toIndex: number }): void {
  reorderProject(payload.projectName, payload.toIndex)
}

function onUpdateThreadScrollState(payload: { threadId: string; state: ThreadScrollState }): void {
  setThreadScrollState(payload.threadId, payload.state)
}

function onRespondServerRequest(payload: { id: number; result?: unknown; error?: { code?: number; message: string } }): void {
  void respondToPendingServerRequest(payload)
}

function onToggleAutoRefreshTimer(): void {
  toggleAutoRefreshTimer()
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'b') return
  event.preventDefault()
  setSidebarCollapsed(!isSidebarCollapsed.value)
}

function onSubmitThreadMessage(payload: {
  text: string
  imageUrls: string[]
  fileAttachments: Array<{ label: string; path: string; fsPath: string }>
  skills: Array<{ name: string; path: string }>
  mode: 'steer' | 'queue'
}): void {
  const text = payload.text
  if (isHomeRoute.value) {
    void submitFirstMessageForNewThread(
      text,
      payload.imageUrls,
      payload.skills,
      payload.fileAttachments,
      sendMessageToNewThread,
    ).then(async (threadId) => {
      if (!threadId) return
      await router.replace({ name: 'thread', params: { threadId } })
    })
    return
  }

  void sendMessageToSelectedThread(text, payload.imageUrls, payload.skills, payload.mode, payload.fileAttachments)
}

function onSelectModel(modelId: string): void {
  setSelectedModelId(modelId)
}

function onSelectReasoningEffort(effort: ReasoningEffort | ''): void {
  setSelectedReasoningEffort(effort)
}

function onInterruptTurn(): void {
  void interruptSelectedThreadTurn()
}

function onRollback(payload: { turnIndex: number }): void {
  void rollbackSelectedThread(payload.turnIndex)
}

function normalizeMessageType(rawType: string | undefined, role: string): string {
  const normalized = (rawType ?? '').trim()
  if (normalized.length > 0) return normalized
  return role.trim() || 'message'
}

async function initialize(): Promise<void> {
  if (isWasmRuntime && route.name === 'skills') {
    await router.replace({ name: 'home' })
  }
  await refreshAll()
  hasInitialized.value = true
  await syncThreadSelectionWithRoute()
  startPolling()
}

async function syncThreadSelectionWithRoute(): Promise<void> {
  if (isRouteSyncInProgress.value) return
  isRouteSyncInProgress.value = true

  try {
    if (route.name === 'home' || route.name === 'settings' || (!isWasmRuntime && route.name === 'skills')) {
      if (selectedThreadId.value !== '') await selectThread('')
      return
    }

    if (route.name !== 'thread') return

    const threadId = routeThreadId.value
    if (!threadId) return

    if (!knownThreadIdSet.value.has(threadId)) {
      await router.replace({ name: 'home' })
      return
    }

    if (selectedThreadId.value !== threadId) {
      await selectThread(threadId)
    }
  } finally {
    isRouteSyncInProgress.value = false
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.content-root {
  @apply h-full min-h-0 w-full flex flex-col overflow-y-hidden overflow-x-visible bg-white;
}

.sidebar-thread-controls-header-host {
  @apply ml-1;
}

.content-body {
  @apply flex-1 min-h-0 w-full flex flex-col gap-2 sm:gap-3 pt-1 pb-2 sm:pb-4 overflow-y-hidden overflow-x-visible;
}
</style>
