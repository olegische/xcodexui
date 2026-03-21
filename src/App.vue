<template>
  <DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" @close-sidebar="setSidebarCollapsed(true)">
    <template #sidebar>
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
            @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
            @toggle-auto-refresh="onToggleAutoRefreshTimer"
            @start-new-thread="onStartNewThreadFromToolbar"
          >
            <button
              class="sidebar-search-toggle"
              type="button"
              :aria-pressed="isSidebarSearchVisible"
              aria-label="Search threads"
              title="Search threads"
              @click="toggleSidebarSearch"
            >
              <IconTablerSearch class="sidebar-search-toggle-icon" />
            </button>
          </SidebarThreadControls>

          <div v-if="!isSidebarCollapsed && isSidebarSearchVisible" class="sidebar-search-bar">
            <IconTablerSearch class="sidebar-search-bar-icon" />
            <input
              ref="sidebarSearchInputRef"
              v-model="sidebarSearchQuery"
              class="sidebar-search-input"
              type="text"
              placeholder="Filter threads..."
              @keydown="onSidebarSearchKeydown"
            />
            <button
              v-if="sidebarSearchQuery.length > 0"
              class="sidebar-search-clear"
              type="button"
              aria-label="Clear search"
              @click="clearSidebarSearch"
            >
              <IconTablerX class="sidebar-search-clear-icon" />
            </button>
          </div>

          <button
            v-if="!isWasmRuntime && !isSidebarCollapsed"
            class="sidebar-skills-link"
            :class="{ 'is-active': isSkillsRoute }"
            type="button"
            @click="router.push({ name: 'skills' }); isMobile && setSidebarCollapsed(true)"
          >
            Skills Hub
          </button>

          <SidebarThreadTree :groups="projectGroups" :project-display-name-by-id="projectDisplayNameById"
            v-if="!isSidebarCollapsed"
            :selected-thread-id="selectedThreadId" :is-loading="isLoadingThreads"
            :search-query="sidebarSearchQuery"
            :search-matched-thread-ids="serverMatchedThreadIds"
            :allow-project-browse="!isWasmRuntime"
            :show-worktree-indicators="!isWasmRuntime"
            @select="onSelectThread"
            @archive="onArchiveThread" @start-new-thread="onStartNewThread" @rename-project="onRenameProject"
            @browse-project-files="onBrowseProjectFiles"
            @rename-thread="onRenameThread"
            @remove-project="onRemoveProject" @reorder-project="onReorderProject" />
        </div>

        <div v-if="!isSidebarCollapsed" class="sidebar-settings-area">
          <Transition name="settings-panel">
            <div v-if="isSettingsOpen" class="sidebar-settings-panel">
              <button class="sidebar-settings-row" type="button" @click="toggleSendWithEnter">
                <span class="sidebar-settings-label">Require ⌘ + enter to send</span>
                <span class="sidebar-settings-toggle" :class="{ 'is-on': !sendWithEnter }" />
              </button>
              <button class="sidebar-settings-row" type="button" @click="cycleInProgressSendMode">
                <span class="sidebar-settings-label">When busy, send as</span>
                <span class="sidebar-settings-value">{{ inProgressSendMode === 'steer' ? 'Steer' : 'Queue' }}</span>
              </button>
              <button class="sidebar-settings-row" type="button" @click="cycleDarkMode">
                <span class="sidebar-settings-label">Appearance</span>
                <span class="sidebar-settings-value">{{ darkMode === 'system' ? 'System' : darkMode === 'dark' ? 'Dark' : 'Light' }}</span>
              </button>
              <button v-if="isWasmRuntime" class="sidebar-settings-row" type="button" @click="openRuntimeSettings">
                <span class="sidebar-settings-label">Runtime</span>
                <IconTablerChevronRight class="sidebar-settings-row-chevron" />
              </button>
            </div>
          </Transition>
          <button class="sidebar-settings-button" type="button" @click="isSettingsOpen = !isSettingsOpen">
            <IconTablerSettings class="sidebar-settings-icon" />
            <span>Settings</span>
          </button>
        </div>
      </section>
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
          <template v-if="isRuntimeSettingsRoute">
            <section class="runtime-settings-view">
              <div class="runtime-settings-header">
                <button class="runtime-settings-back" type="button" @click="goBackFromRuntimeSettings">
                  <IconTablerChevronLeft class="runtime-settings-back-icon" />
                  <span>Back to app</span>
                </button>
                <div class="runtime-settings-heading">
                  <h2 class="runtime-settings-title">Runtime</h2>
                  <p class="runtime-settings-subtitle">Browser-hosted XCodex WASM runtime configuration. Only the current provider config is stored locally in browser IndexedDB and handled directly by the browser runtime.</p>
                </div>
              </div>

              <div class="settings-panel-card">
                <div class="settings-form-grid">
                  <label class="settings-form-row">
                    <span class="settings-form-copy">
                      <span class="settings-form-title">Status</span>
                      <span class="settings-form-description">{{ derivedRuntimeStatus.detail }}</span>
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
                      v-model="wasmSettingsDraft.transportMode"
                      class="settings-select"
                      @change="onWasmTransportModeChange(wasmSettingsDraft.transportMode)"
                    >
                      <option value="xrouter-browser">Browser runtime router</option>
                      <option value="openai">OpenAI</option>
                      <option value="openai-compatible">Responses API-compatible</option>
                    </select>
                  </label>

                  <label v-if="wasmSettingsDraft.transportMode === 'xrouter-browser'" class="settings-form-row">
                    <span class="settings-form-copy">
                      <span class="settings-form-title">Route</span>
                      <span class="settings-form-description">Choose the provider route exposed by browser runtime.</span>
                    </span>
                    <select
                      v-model="wasmSettingsDraft.xrouterProvider"
                      class="settings-select"
                      @change="onWasmXrouterProviderChange(wasmSettingsDraft.xrouterProvider)"
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
                    <input v-model="wasmSettingsDraft.apiKey" class="settings-input" type="password" placeholder="Paste API key" />
                  </label>

                  <label class="settings-form-row is-input">
                    <span class="settings-form-copy">
                      <span class="settings-form-title">Base URL</span>
                      <span class="settings-form-description">Provider endpoint used by the runtime.</span>
                    </span>
                    <input v-model="wasmSettingsDraft.providerBaseUrl" class="settings-input" type="text" placeholder="https://..." />
                  </label>

                  <label class="settings-form-row is-input">
                    <span class="settings-form-copy">
                      <span class="settings-form-title">Model</span>
                      <span class="settings-form-description">Default model id for new turns.</span>
                    </span>
                    <select v-if="runtimeModelOptions.length > 0" v-model="wasmSettingsDraft.model" class="settings-select">
                      <option v-for="option in runtimeModelOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                    <input v-else-if="runtimeModelAllowsManualInput" v-model="wasmSettingsDraft.model" class="settings-input" type="text" placeholder="gpt-5 / deepseek-chat / ..." />
                    <input v-else :value="wasmSettingsDraft.model" class="settings-input" type="text" placeholder="Models load after API key is set" disabled />
                  </label>
                </div>

                <div class="settings-actions">
                  <button class="settings-primary-action" type="button" :disabled="isSavingWasmSettings" @click="saveCurrentWasmRuntimeSettings">
                    {{ isSavingWasmSettings ? 'Saving…' : 'Save runtime' }}
                  </button>
                  <button class="settings-secondary-action" type="button" :disabled="isSavingWasmSettings" @click="reloadRuntimeSettingsScreen">
                    Reload
                  </button>
                  <button v-if="hasStoredWasmProviderSecret" class="settings-danger-action" type="button" :disabled="isSavingWasmSettings" @click="deleteCurrentWasmProviderConfig">
                    Delete config
                  </button>
                </div>

                <p v-if="wasmSettingsFeedback" class="settings-inline-note" :class="{ 'is-error': wasmSettingsFeedbackTone === 'error' }">
                  {{ wasmSettingsFeedback }}
                </p>
              </div>
            </section>
          </template>
          <template v-else-if="!isWasmRuntime && isSkillsRoute">
            <SkillsHub @skills-changed="onSkillsChanged" />
          </template>
          <template v-else-if="isHomeRoute">
            <div class="content-grid">
              <div class="new-thread-empty">
                <img
                  v-if="isWasmRuntime"
                  class="new-thread-logo"
                  :src="wasmHeroLogoSrc"
                  alt="XCodex WASM"
                />
                <p class="new-thread-hero">{{ isWasmRuntime ? 'Run in the browser' : "Let's build" }}</p>
                <ComposerDropdown class="new-thread-folder-dropdown" :model-value="newThreadCwd"
                  :options="newThreadFolderOptions" placeholder="Choose folder"
                  :enable-search="true"
                  :search-placeholder="isWasmRuntime ? 'Workspace path' : 'Quick search project'"
                  :show-add-action="!isWasmRuntime"
                  add-action-label="+ Add new project"
                  :default-add-value="defaultNewProjectName"
                  add-placeholder="Project name or absolute path"
                  :disabled="false" @update:model-value="onSelectNewThreadFolder"
                  @add="onAddNewProject" />
                <ComposerRuntimeDropdown
                  v-if="!isWasmRuntime"
                  class="new-thread-runtime-dropdown"
                  v-model="newThreadRuntime"
                  :include-worktree="!isWasmRuntime"
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
                  <button class="wasm-runtime-setup-action" type="button" @click="openRuntimeSettings">
                    Open runtime settings
                  </button>
                </div>
              </div>

                <ThreadComposer v-if="!showWasmRuntimeSetupCta" :active-thread-id="composerThreadContextId"
                  :cwd="composerCwd"
                :models="availableModelIds" :selected-model="selectedModelId"
                :selected-reasoning-effort="selectedReasoningEffort" :skills="installedSkills"
                :enable-skills="!isWasmRuntime"
                :enable-file-mentions="!isWasmRuntime"
                :enable-attachments="!isWasmRuntime"
                :enable-dictation="!isWasmRuntime"
                :is-turn-in-progress="false"
                :is-interrupting-turn="false" :send-with-enter="sendWithEnter" :in-progress-submit-mode="inProgressSendMode" @submit="onSubmitThreadMessage"
                @update:selected-model="onSelectModel" @update:selected-reasoning-effort="onSelectReasoningEffort" />
            </div>
          </template>
          <template v-else>
            <div class="content-grid">
              <div class="content-thread">
                <ThreadConversation :messages="filteredMessages" :is-loading="isLoadingMessages"
                  :active-thread-id="composerThreadContextId" :scroll-state="selectedThreadScrollState"
                  :live-overlay="liveOverlay"
                  :pending-requests="selectedThreadServerRequests"
                  :is-turn-in-progress="isSelectedThreadInProgress"
                  :allow-rollback="!isWasmRuntime"
                  :is-rolling-back="isRollingBack"
                  @update-scroll-state="onUpdateThreadScrollState"
                  @respond-server-request="onRespondServerRequest"
                  @rollback="onRollback" />
              </div>

              <div class="composer-with-queue">
                <QueuedMessages
                  :messages="selectedThreadQueuedMessages"
                  @steer="steerQueuedMessage"
                  @delete="removeQueuedMessage"
                />
                <div v-if="showWasmRuntimeSetupCta" class="wasm-runtime-setup-card">
                  <div class="wasm-runtime-setup-copy">
                    <strong class="wasm-runtime-setup-title">{{ wasmRuntimeStatus.label }}</strong>
                    <p class="wasm-runtime-setup-description">{{ wasmRuntimeStatus.detail }}</p>
                  </div>
                  <button class="wasm-runtime-setup-action" type="button" @click="openRuntimeSettings">
                    Open runtime settings
                  </button>
                </div>
                <ThreadComposer v-else :active-thread-id="composerThreadContextId"
                  :cwd="composerCwd"
                  :models="availableModelIds"
                  :selected-model="selectedModelId" :selected-reasoning-effort="selectedReasoningEffort"
                  :skills="installedSkills"
                  :enable-skills="!isWasmRuntime"
                  :enable-file-mentions="!isWasmRuntime"
                  :enable-attachments="!isWasmRuntime"
                  :enable-dictation="!isWasmRuntime"
                  :is-turn-in-progress="isSelectedThreadInProgress" :is-interrupting-turn="isInterruptingTurn"
                  :has-queue-above="selectedThreadQueuedMessages.length > 0"
                  :send-with-enter="sendWithEnter" :in-progress-submit-mode="inProgressSendMode"
                  @submit="onSubmitThreadMessage" @update:selected-model="onSelectModel"
                  @update:selected-reasoning-effort="onSelectReasoningEffort" @interrupt="onInterruptTurn" />
              </div>
            </div>
          </template>
        </section>
      </section>
    </template>
  </DesktopLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import SidebarThreadTree from './components/sidebar/SidebarThreadTree.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import ThreadConversation from './components/content/ThreadConversation.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import QueuedMessages from './components/content/QueuedMessages.vue'
import ComposerDropdown from './components/content/ComposerDropdown.vue'
import ComposerRuntimeDropdown from './components/content/ComposerRuntimeDropdown.vue'
import SkillsHub from './components/content/SkillsHub.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerChevronLeft from './components/icons/IconTablerChevronLeft.vue'
import IconTablerChevronRight from './components/icons/IconTablerChevronRight.vue'
import IconTablerSettings from './components/icons/IconTablerSettings.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import { useDesktopState } from './composables/useDesktopState'
import { useMobile } from './composables/useMobile'
import { BROWSER_WORKSPACE_ROOT, IS_WASM_RUNTIME } from './config/runtime'
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
} from './runtime/wasm/settings'
import {
  createWorktree,
  getHomeDirectory,
  getProjectRootSuggestion,
  getWorkspaceRootsState,
  openProjectRoot,
  searchThreads,
} from './api/codexGateway'
import type { ReasoningEffort, ThreadScrollState } from './types/codex'
import type { DemoTransportMode, XrouterProvider } from 'xcodex-runtime/types'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'codex-web-local.sidebar-collapsed.v1'
const worktreeName = import.meta.env.VITE_WORKTREE_NAME ?? 'unknown'
const appVersion = import.meta.env.VITE_APP_VERSION ?? 'unknown'
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
  isSendingMessage,
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
const isRouteSyncInProgress = ref(false)
const hasInitialized = ref(false)
const newThreadCwd = ref('')
const newThreadRuntime = ref<'local' | 'worktree'>('local')
const workspaceRootOptionsState = ref<{ order: string[]; labels: Record<string, string> }>({ order: [], labels: {} })
const worktreeInitStatus = ref<{ phase: 'idle' | 'running' | 'error'; title: string; message: string }>({
  phase: 'idle',
  title: '',
  message: '',
})
const isSidebarCollapsed = ref(loadSidebarCollapsed())
const sidebarSearchQuery = ref('')
const isSidebarSearchVisible = ref(false)
const sidebarSearchInputRef = ref<HTMLInputElement | null>(null)
const serverMatchedThreadIds = ref<string[] | null>(null)
let threadSearchTimer: ReturnType<typeof setTimeout> | null = null
const defaultNewProjectName = ref('New Project (1)')
const homeDirectory = ref('')
const isSettingsOpen = ref(false)
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
const SEND_WITH_ENTER_KEY = 'codex-web-local.send-with-enter.v1'
const IN_PROGRESS_SEND_MODE_KEY = 'codex-web-local.in-progress-send-mode.v1'
const DARK_MODE_KEY = 'codex-web-local.dark-mode.v1'
const darkModeMediaQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const sendWithEnter = ref(loadBoolPref(SEND_WITH_ENTER_KEY, true))
const inProgressSendMode = ref<'steer' | 'queue'>(loadInProgressSendModePref())
const darkMode = ref<'system' | 'light' | 'dark'>(loadDarkModePref())
const prefersDarkMode = ref(darkModeMediaQuery?.matches ?? true)

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
const contentTitle = computed(() => {
  if (isSkillsRoute.value) return 'Skills'
  if (isHomeRoute.value) return 'New thread'
  return selectedThread.value?.title ?? 'Choose a thread'
})
const autoRefreshButtonLabel = computed(() =>
  isAutoRefreshEnabled.value
    ? `Auto refresh in ${String(autoRefreshSecondsLeft.value)}s`
    : 'Enable 4s refresh',
)
const filteredMessages = computed(() =>
  messages.value.filter((message) => {
    const type = normalizeMessageType(message.messageType, message.role)
    if (type === 'worked') return true
    if (type === 'turnActivity.live' || type === 'turnError.live' || type === 'agentReasoning.live') return false
    return true
  }),
)
const liveOverlay = computed(() => selectedLiveOverlay.value)
const composerThreadContextId = computed(() => (isHomeRoute.value ? '__new-thread__' : selectedThreadId.value))
const runtimeModelOptions = computed(() =>
  (isWasmRuntime ? wasmRuntimeModelIds.value : availableModelIds.value).map((modelId) => ({ value: modelId, label: modelId })),
)
const isEffectiveDarkMode = computed(() =>
  darkMode.value === 'dark' || (darkMode.value === 'system' && prefersDarkMode.value),
)
const wasmHeroLogoSrc = computed(() =>
  isEffectiveDarkMode.value ? '/logo-dark.svg?v=neutral950' : '/logo-white.svg?v=light',
)
const runtimeModelAllowsManualInput = computed(() =>
  isWasmRuntime && (
    wasmSettingsDraft.value.transportMode === 'openai-compatible'
    || (
      wasmSettingsDraft.value.transportMode === 'xrouter-browser'
      && wasmSettingsDraft.value.xrouterProvider === 'openai'
    )
  ),
)
const derivedRuntimeStatus = computed(() =>
  deriveWasmRuntimeStatus({
    providerName: wasmSettingsDraft.value.providerDisplayName,
    apiKey: wasmSettingsDraft.value.apiKey,
    model: wasmSettingsDraft.value.model,
  }),
)
const showWasmRuntimeSetupCta = computed(() =>
  isWasmRuntime
  && wasmRuntimeStatus.value.isError,
)
const composerCwd = computed(() => {
  if (isHomeRoute.value) return newThreadCwd.value.trim()
  return selectedThread.value?.cwd?.trim() ?? ''
})
const isSelectedThreadInProgress = computed(() => !isHomeRoute.value && selectedThread.value?.inProgress === true)
const newThreadFolderOptions = computed(() => {
  if (isWasmRuntime) {
    return [{ value: BROWSER_WORKSPACE_ROOT, label: 'Workspace' }]
  }

  const options: Array<{ value: string; label: string }> = []
  const seenCwds = new Set<string>()

  for (const cwdRaw of workspaceRootOptionsState.value.order) {
    const cwd = cwdRaw.trim()
    if (!cwd || seenCwds.has(cwd)) continue
    seenCwds.add(cwd)
    options.push({
      value: cwd,
      label: workspaceRootOptionsState.value.labels[cwd] || getPathLeafName(cwd),
    })
  }

  for (const group of projectGroups.value) {
    const cwd = group.threads[0]?.cwd?.trim() ?? ''
    if (!cwd || seenCwds.has(cwd)) continue
    seenCwds.add(cwd)
    options.push({
      value: cwd,
      label: projectDisplayNameById.value[group.projectName] ?? group.projectName,
    })
  }

  const selectedCwd = newThreadCwd.value.trim()
  if (selectedCwd && !seenCwds.has(selectedCwd)) {
    options.unshift({
      value: selectedCwd,
      label: getPathLeafName(selectedCwd),
    })
  }

  return options
})
onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  applyDarkMode()
  darkModeMediaQuery?.addEventListener('change', applyDarkMode)
  void initialize()
  if (isWasmRuntime) {
    newThreadCwd.value = BROWSER_WORKSPACE_ROOT
    defaultNewProjectName.value = 'Workspace'
    workspaceRootOptionsState.value = {
      order: [BROWSER_WORKSPACE_ROOT],
      labels: { [BROWSER_WORKSPACE_ROOT]: 'Workspace' },
    }
    void refreshWasmRuntimeSettings()
    return
  }
  void loadHomeDirectory()
  void loadWorkspaceRootOptionsState()
  void refreshDefaultProjectName()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeyDown)
  darkModeMediaQuery?.removeEventListener('change', applyDarkMode)
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
  if (wasmModelRefreshTimer) {
    clearTimeout(wasmModelRefreshTimer)
    wasmModelRefreshTimer = null
  }
  stopPolling()
})

watch(sidebarSearchQuery, (value) => {
  const query = value.trim()
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
  if (!query) {
    serverMatchedThreadIds.value = null
    return
  }

  threadSearchTimer = setTimeout(() => {
    void searchThreads(query, 1000)
      .then((result) => {
        if (sidebarSearchQuery.value.trim() !== query) return
        serverMatchedThreadIds.value = result.threadIds
      })
      .catch(() => {
        if (sidebarSearchQuery.value.trim() !== query) return
        serverMatchedThreadIds.value = null
      })
  }, 220)
})

watch(
  () => isSettingsOpen.value,
  (open) => {
    if (open && isWasmRuntime) {
      void refreshWasmRuntimeSettings()
    }
  },
)

watch(
  () => isRuntimeSettingsRoute.value,
  (active) => {
    if (active && isWasmRuntime) {
      void refreshWasmRuntimeSettings()
    }
  },
)

watch(
  () => isHomeRoute.value,
  (active) => {
    if (active && isWasmRuntime) {
      void refreshWasmRuntimeSettings()
    }
  },
)

watch(
  () => runtimeModelOptions.value,
  (options) => {
    if (!isWasmRuntime) return
    if (options.length === 0) {
      if (!runtimeModelAllowsManualInput.value && wasmSettingsDraft.value.model.trim()) {
        wasmSettingsDraft.value = {
          ...wasmSettingsDraft.value,
          model: '',
        }
      }
      return
    }
    const current = wasmSettingsDraft.value.model.trim()
    if (current && options.some((option) => option.value === current)) return
    wasmSettingsDraft.value = {
      ...wasmSettingsDraft.value,
      model: options[0].value,
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
    if (!isWasmRuntime) return
    if (wasmModelRefreshTimer) clearTimeout(wasmModelRefreshTimer)
    wasmModelRefreshTimer = setTimeout(() => {
      wasmModelRefreshTimer = null
      void refreshWasmRuntimeModelOptions()
    }, 150)
  },
)

function onSkillsChanged(): void {
  void refreshSkills()
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

async function refreshWasmRuntimeSettings(): Promise<void> {
  if (!isWasmRuntime) return
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
  if (!isWasmRuntime) return
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
  if (!isWasmRuntime || isSavingWasmSettings.value) return

  isSavingWasmSettings.value = true
  wasmSettingsFeedback.value = ''
  wasmSettingsFeedbackTone.value = 'neutral'

  try {
    await saveWasmRuntimeDraft(wasmSettingsDraft.value)
    await refreshAll()
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
  if (!isWasmRuntime || isSavingWasmSettings.value) return
  isSavingWasmSettings.value = true
  wasmSettingsFeedback.value = ''
  wasmSettingsFeedbackTone.value = 'neutral'
  try {
    await refreshAll()
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
  if (!isWasmRuntime || isSavingWasmSettings.value) return

  isSavingWasmSettings.value = true
  wasmSettingsFeedback.value = ''
  wasmSettingsFeedbackTone.value = 'neutral'

  try {
    wasmSettingsDraft.value = await deleteStoredWasmProviderConfig({
      transportMode: wasmSettingsDraft.value.transportMode,
      xrouterProvider: wasmSettingsDraft.value.xrouterProvider,
    })
    hasStoredWasmProviderSecret.value = false
    await refreshAll()
    await refreshWasmRuntimeSettings()
    wasmSettingsFeedback.value = 'Saved provider config deleted.'
  } catch (error) {
    wasmSettingsFeedback.value = error instanceof Error ? error.message : String(error)
    wasmSettingsFeedbackTone.value = 'error'
  } finally {
    isSavingWasmSettings.value = false
  }
}

function toggleSidebarSearch(): void {
  isSidebarSearchVisible.value = !isSidebarSearchVisible.value
  if (isSidebarSearchVisible.value) {
    nextTick(() => sidebarSearchInputRef.value?.focus())
  } else {
    sidebarSearchQuery.value = ''
  }
}

function clearSidebarSearch(): void {
  sidebarSearchQuery.value = ''
  sidebarSearchInputRef.value?.focus()
}

function onSidebarSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    isSidebarSearchVisible.value = false
    sidebarSearchQuery.value = ''
  }
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
  if (projectCwd) {
    newThreadCwd.value = projectCwd
  }
  if (isMobile.value) setSidebarCollapsed(true)
  if (isHomeRoute.value) return
  void router.push({ name: 'home' })
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
  if (cwd) {
    newThreadCwd.value = cwd
  }
  if (isMobile.value) setSidebarCollapsed(true)
  if (isHomeRoute.value) return
  void router.push({ name: 'home' })
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

function setSidebarCollapsed(nextValue: boolean): void {
  if (isSidebarCollapsed.value === nextValue) return
  isSidebarCollapsed.value = nextValue
  saveSidebarCollapsed(nextValue)
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'b') return
  event.preventDefault()
  setSidebarCollapsed(!isSidebarCollapsed.value)
}

function onSubmitThreadMessage(payload: { text: string; imageUrls: string[]; fileAttachments: Array<{ label: string; path: string; fsPath: string }>; skills: Array<{ name: string; path: string }>; mode: 'steer' | 'queue' }): void {
  const text = payload.text
  if (isHomeRoute.value) {
    void submitFirstMessageForNewThread(text, payload.imageUrls, payload.skills, payload.fileAttachments)
    return
  }
  void sendMessageToSelectedThread(text, payload.imageUrls, payload.skills, payload.mode, payload.fileAttachments)
}

function onSelectNewThreadFolder(cwd: string): void {
  newThreadCwd.value = cwd.trim()
}

async function onAddNewProject(rawInput: string): Promise<void> {
  if (isWasmRuntime) return
  const normalizedInput = rawInput.trim()
  if (!normalizedInput) return

  const isPath = looksLikePath(normalizedInput)
  const baseDir = await resolveProjectBaseDirectory()
  const targetPath = isPath
    ? normalizedInput
    : joinPath(baseDir, normalizedInput)
  if (!targetPath) return

  try {
    const normalizedPath = await openProjectRoot(targetPath, {
      createIfMissing: !isPath,
      label: isPath ? '' : normalizedInput,
    })
    if (normalizedPath) {
      newThreadCwd.value = normalizedPath
      pinProjectToTop(getPathLeafName(normalizedPath))
      void loadWorkspaceRootOptionsState()
      void refreshDefaultProjectName()
    }
  } catch {
    // Error is surfaced on next request if path is invalid.
  }
}

async function resolveProjectBaseDirectory(): Promise<string> {
  if (isWasmRuntime) return BROWSER_WORKSPACE_ROOT
  const baseDir = getProjectBaseDirectory()
  if (baseDir) return baseDir
  try {
    const loadedHomeDirectory = await getHomeDirectory()
    if (loadedHomeDirectory) {
      homeDirectory.value = loadedHomeDirectory
      return loadedHomeDirectory
    }
  } catch {
    // Fallback handled by empty return.
  }
  return ''
}

function looksLikePath(value: string): boolean {
  if (!value) return false
  if (value.startsWith('~/')) return true
  if (value.startsWith('/')) return true
  return /^[a-zA-Z]:[\\/]/.test(value)
}

async function refreshDefaultProjectName(): Promise<void> {
  if (isWasmRuntime) {
    defaultNewProjectName.value = 'Workspace'
    return
  }
  const baseDir = getProjectBaseDirectory()
  if (!baseDir) {
    defaultNewProjectName.value = 'New Project (1)'
    return
  }

  try {
    const suggestion = await getProjectRootSuggestion(baseDir)
    defaultNewProjectName.value = suggestion.name || 'New Project (1)'
  } catch {
    defaultNewProjectName.value = 'New Project (1)'
  }
}

function getProjectBaseDirectory(): string {
  const selected = newThreadCwd.value.trim()
  if (selected) return getPathParent(selected)
  const first = newThreadFolderOptions.value[0]?.value?.trim() ?? ''
  if (first) return getPathParent(first)
  return homeDirectory.value.trim()
}

async function loadHomeDirectory(): Promise<void> {
  if (isWasmRuntime) {
    homeDirectory.value = BROWSER_WORKSPACE_ROOT
    return
  }
  try {
    homeDirectory.value = await getHomeDirectory()
  } catch {
    homeDirectory.value = ''
  }
}

async function loadWorkspaceRootOptionsState(): Promise<void> {
  if (isWasmRuntime) {
    workspaceRootOptionsState.value = {
      order: [BROWSER_WORKSPACE_ROOT],
      labels: { [BROWSER_WORKSPACE_ROOT]: 'Workspace' },
    }
    return
  }
  try {
    const state = await getWorkspaceRootsState()
    workspaceRootOptionsState.value = {
      order: [...state.order],
      labels: { ...state.labels },
    }
  } catch {
    workspaceRootOptionsState.value = { order: [], labels: {} }
  }
}

function getPathParent(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const slashIndex = trimmed.lastIndexOf('/')
  if (slashIndex <= 0) return ''
  return trimmed.slice(0, slashIndex)
}

function getPathLeafName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const slashIndex = trimmed.lastIndexOf('/')
  if (slashIndex < 0) return trimmed
  return trimmed.slice(slashIndex + 1)
}

function joinPath(parent: string, child: string): string {
  const normalizedParent = parent.trim().replace(/\/+$/, '')
  const normalizedChild = child.trim().replace(/^\/+/, '')
  if (!normalizedParent || !normalizedChild) return ''
  return `${normalizedParent}/${normalizedChild}`
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

function loadBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = window.localStorage.getItem(key)
  if (v === null) return fallback
  return v === '1'
}

function loadDarkModePref(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(DARK_MODE_KEY)
  if (v === 'light' || v === 'dark') return v
  return 'system'
}

function loadInProgressSendModePref(): 'steer' | 'queue' {
  if (typeof window === 'undefined') return 'queue'
  const v = window.localStorage.getItem(IN_PROGRESS_SEND_MODE_KEY)
  return v === 'steer' ? 'steer' : 'queue'
}

function toggleSendWithEnter(): void {
  sendWithEnter.value = !sendWithEnter.value
  window.localStorage.setItem(SEND_WITH_ENTER_KEY, sendWithEnter.value ? '1' : '0')
}

function cycleInProgressSendMode(): void {
  inProgressSendMode.value = inProgressSendMode.value === 'steer' ? 'queue' : 'steer'
  window.localStorage.setItem(IN_PROGRESS_SEND_MODE_KEY, inProgressSendMode.value)
}

function cycleDarkMode(): void {
  const order: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark']
  const idx = order.indexOf(darkMode.value)
  darkMode.value = order[(idx + 1) % order.length]
  window.localStorage.setItem(DARK_MODE_KEY, darkMode.value)
  applyDarkMode()
}

function applyDarkMode(): void {
  const root = document.documentElement
  prefersDarkMode.value = darkModeMediaQuery?.matches ?? true
  if (darkMode.value === 'dark') {
    root.classList.add('dark')
  } else if (darkMode.value === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? '1' : '0')
}

function normalizeMessageType(rawType: string | undefined, role: string): string {
  const normalized = (rawType ?? '').trim()
  if (normalized.length > 0) {
    return normalized
  }
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
      if (selectedThreadId.value !== '') {
        await selectThread('')
      }
      return
    }

    if (route.name === 'thread') {
      const threadId = routeThreadId.value
      if (!threadId) return

      if (!knownThreadIdSet.value.has(threadId)) {
        await router.replace({ name: 'home' })
        return
      }

      if (selectedThreadId.value !== threadId) {
        await selectThread(threadId)
      }
      return
    }

  } finally {
    isRouteSyncInProgress.value = false
  }
}

watch(
  () =>
    [
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
      if (route.name !== 'home') {
        await router.replace({ name: 'home' })
      }
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
    if (!isWasmRuntime) {
      void refreshDefaultProjectName()
    }
  },
  { immediate: true },
)

watch(
  () => newThreadCwd.value,
  () => {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    if (!isWasmRuntime) {
      void refreshDefaultProjectName()
    }
  },
)

watch(
  () => newThreadRuntime.value,
  (runtime) => {
    if (runtime === 'local') {
      worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    }
  },
)

watch(
  () => route.name,
  (name) => {
    if (name !== 'home') {
      worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    }
  },
)

watch(
  () => selectedThreadId.value,
  () => {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
  },
)

watch(isMobile, (mobile) => {
  if (mobile && !isSidebarCollapsed.value) {
    setSidebarCollapsed(true)
  }
})

async function submitFirstMessageForNewThread(
  text: string,
  imageUrls: string[] = [],
  skills: Array<{ name: string; path: string }> = [],
  fileAttachments: Array<{ label: string; path: string; fsPath: string }> = [],
): Promise<void> {
  try {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    let targetCwd = newThreadCwd.value || (isWasmRuntime ? BROWSER_WORKSPACE_ROOT : '')
    if (!isWasmRuntime && newThreadRuntime.value === 'worktree') {
      worktreeInitStatus.value = {
        phase: 'running',
        title: 'Creating worktree',
        message: 'Creating a worktree and running setup.',
      }
      try {
        const created = await createWorktree(newThreadCwd.value)
        targetCwd = created.cwd
        newThreadCwd.value = created.cwd
        worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
      } catch {
        worktreeInitStatus.value = {
          phase: 'error',
          title: 'Worktree setup failed',
          message: 'Unable to create worktree. Try again or switch to Local project.',
        }
        return
      }
    }
    const threadId = await sendMessageToNewThread(text, targetCwd, imageUrls, skills, fileAttachments)
    if (!threadId) return
    await router.replace({ name: 'thread', params: { threadId } })
  } catch {
    // Error is already reflected in state.
  }
}
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

.content-root {
  @apply h-full min-h-0 w-full flex flex-col overflow-y-hidden overflow-x-visible bg-white;
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

.sidebar-thread-controls-header-host {
  @apply ml-1;
}

.content-body {
  @apply flex-1 min-h-0 w-full flex flex-col gap-2 sm:gap-3 pt-1 pb-2 sm:pb-4 overflow-y-hidden overflow-x-visible;
}

.content-error {
  @apply m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700;
}

.content-grid {
  @apply flex-1 min-h-0 flex flex-col gap-3;
}

.content-thread {
  @apply flex-1 min-h-0;
}

.composer-with-queue {
  @apply w-full;
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

.sidebar-settings-row-chevron {
  @apply h-4 w-4 text-zinc-400;
}

.sidebar-settings-value {
  @apply text-xs text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5;
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

.runtime-settings-title {
  @apply m-0 text-[1.45rem] font-semibold tracking-tight text-zinc-950;
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
.settings-input,
.settings-select-button {
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

.settings-select-button {
  @apply inline-flex items-center justify-between text-left;
}

.settings-actions {
  @apply flex justify-end gap-2 px-5 py-3;
}

.settings-primary-action {
  @apply rounded-[1rem] border border-zinc-900 bg-zinc-900 px-3 py-2 text-[0.82rem] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60;
}

.settings-secondary-action {
  @apply rounded-[1rem] border border-zinc-200 bg-white px-3 py-2 text-[0.82rem] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60;
}

.settings-danger-action {
  @apply rounded-[1rem] border border-zinc-200 bg-white px-3 py-2 text-[0.82rem] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60;
}

.settings-inline-note {
  @apply m-0 border-t border-zinc-200 px-5 py-3 text-[0.82rem] text-zinc-500;
}

.settings-inline-note.is-error {
  @apply text-red-700;
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
