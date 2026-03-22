import { computed, ref, type Ref } from 'vue'
import {
  createWorktree,
  getHomeDirectory,
  getProjectRootSuggestion,
  getWorkspaceRootsState,
  openProjectRoot,
} from '../api/codexGateway'
import { BROWSER_WORKSPACE_ROOT } from '../config/runtime'
import type { UiProjectGroup } from '../types/codex'

type UseNewThreadSetupOptions = {
  isWasmRuntime: boolean
  projectGroups: Ref<UiProjectGroup[]>
  projectDisplayNameById: Ref<Record<string, string>>
  pinProjectToTop: (projectName: string) => void
}

export function useNewThreadSetup(options: UseNewThreadSetupOptions) {
  const newThreadCwd = ref('')
  const newThreadRuntime = ref<'local' | 'worktree'>('local')
  const workspaceRootOptionsState = ref<{ order: string[]; labels: Record<string, string> }>({ order: [], labels: {} })
  const worktreeInitStatus = ref<{ phase: 'idle' | 'running' | 'error'; title: string; message: string }>({
    phase: 'idle',
    title: '',
    message: '',
  })
  const defaultNewProjectName = ref('New Project (1)')
  const homeDirectory = ref('')

  const newThreadFolderOptions = computed(() => {
    if (options.isWasmRuntime) {
      return [{ value: BROWSER_WORKSPACE_ROOT, label: 'Workspace' }]
    }

    const items: Array<{ value: string; label: string }> = []
    const seenCwds = new Set<string>()

    for (const cwdRaw of workspaceRootOptionsState.value.order) {
      const cwd = cwdRaw.trim()
      if (!cwd || seenCwds.has(cwd)) continue
      seenCwds.add(cwd)
      items.push({
        value: cwd,
        label: workspaceRootOptionsState.value.labels[cwd] || getPathLeafName(cwd),
      })
    }

    for (const group of options.projectGroups.value) {
      const cwd = group.threads[0]?.cwd?.trim() ?? ''
      if (!cwd || seenCwds.has(cwd)) continue
      seenCwds.add(cwd)
      items.push({
        value: cwd,
        label: options.projectDisplayNameById.value[group.projectName] ?? group.projectName,
      })
    }

    const selectedCwd = newThreadCwd.value.trim()
    if (selectedCwd && !seenCwds.has(selectedCwd)) {
      items.unshift({
        value: selectedCwd,
        label: getPathLeafName(selectedCwd),
      })
    }

    return items
  })

  function resetWorktreeInitStatus(): void {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
  }

  function onSelectNewThreadFolder(cwd: string): void {
    newThreadCwd.value = cwd.trim()
  }

  async function onAddNewProject(rawInput: string): Promise<void> {
    if (options.isWasmRuntime) return
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
        options.pinProjectToTop(getPathLeafName(normalizedPath))
        void loadWorkspaceRootOptionsState()
        void refreshDefaultProjectName()
      }
    } catch {
      // Error is surfaced on next request if path is invalid.
    }
  }

  async function resolveProjectBaseDirectory(): Promise<string> {
    if (options.isWasmRuntime) return BROWSER_WORKSPACE_ROOT
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

  async function refreshDefaultProjectName(): Promise<void> {
    if (options.isWasmRuntime) {
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

  async function loadHomeDirectory(): Promise<void> {
    if (options.isWasmRuntime) {
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
    if (options.isWasmRuntime) {
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

  async function submitFirstMessageForNewThread(
    text: string,
    imageUrls: string[],
    skills: Array<{ name: string; path: string }>,
    fileAttachments: Array<{ label: string; path: string; fsPath: string }>,
    sendMessageToNewThread: (
      text: string,
      cwd: string,
      imageUrls: string[],
      skills: Array<{ name: string; path: string }>,
      fileAttachments: Array<{ label: string; path: string; fsPath: string }>,
    ) => Promise<string | void>,
  ): Promise<string | void> {
    try {
      resetWorktreeInitStatus()
      let targetCwd = newThreadCwd.value || (options.isWasmRuntime ? BROWSER_WORKSPACE_ROOT : '')
      if (!options.isWasmRuntime && newThreadRuntime.value === 'worktree') {
        worktreeInitStatus.value = {
          phase: 'running',
          title: 'Creating worktree',
          message: 'Creating a worktree and running setup.',
        }
        try {
          const created = await createWorktree(newThreadCwd.value)
          targetCwd = created.cwd
          newThreadCwd.value = created.cwd
          resetWorktreeInitStatus()
        } catch {
          worktreeInitStatus.value = {
            phase: 'error',
            title: 'Worktree setup failed',
            message: 'Unable to create worktree. Try again or switch to Local project.',
          }
          return
        }
      }

      return await sendMessageToNewThread(text, targetCwd, imageUrls, skills, fileAttachments)
    } catch {
      return
    }
  }

  function getProjectBaseDirectory(): string {
    const selected = newThreadCwd.value.trim()
    if (selected) return getPathParent(selected)
    const first = newThreadFolderOptions.value[0]?.value?.trim() ?? ''
    if (first) return getPathParent(first)
    return homeDirectory.value.trim()
  }

  return {
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
  }
}

function looksLikePath(value: string): boolean {
  if (!value) return false
  if (value.startsWith('~/')) return true
  if (value.startsWith('/')) return true
  return /^[a-zA-Z]:[\\/]/.test(value)
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
