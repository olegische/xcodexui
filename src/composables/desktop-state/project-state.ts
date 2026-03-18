import type { Ref } from 'vue'
import { getWorkspaceRootsState, setWorkspaceRootsState } from '../../api/codexGateway'
import { IS_WASM_RUNTIME } from '../../config/runtime'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import {
  areStringArraysEqual,
  flattenThreads,
  mergeProjectOrder,
  mergeThreadGroups,
  orderGroupsByProjectOrder,
  reorderStringArray,
  toProjectNameFromWorkspaceRoot,
} from './thread-groups'

export function createProjectState(params: {
  sourceGroups: Ref<UiProjectGroup[]>
  projectGroups: Ref<UiProjectGroup[]>
  projectOrder: Ref<string[]>
  projectDisplayNameById: Ref<Record<string, string>>
  selectedThreadId: Ref<string>
  saveProjectOrder: (order: string[]) => void
  saveProjectDisplayNames: (labels: Record<string, string>) => void
  applyThreadFlags: () => void
  pruneThreadScopedState: (flatThreads: UiThread[]) => void
  setSelectedThreadId: (threadId: string) => void
}) {
  const {
    sourceGroups,
    projectGroups,
    projectOrder,
    projectDisplayNameById,
    selectedThreadId,
    saveProjectOrder,
    saveProjectDisplayNames,
    applyThreadFlags,
    pruneThreadScopedState,
    setSelectedThreadId,
  } = params

  let hasHydratedWorkspaceRootsState = false

  async function hydrateWorkspaceRootsStateIfNeeded(groups: UiProjectGroup[]): Promise<void> {
    if (IS_WASM_RUNTIME || hasHydratedWorkspaceRootsState) return
    hasHydratedWorkspaceRootsState = true
    try {
      const rootsState = await getWorkspaceRootsState()
      const hydratedOrder: string[] = []
      for (const rootPath of rootsState.order) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (!hydratedOrder.includes(projectName)) hydratedOrder.push(projectName)
      }
      if (hydratedOrder.length > 0) {
        const mergedOrder = mergeProjectOrder(hydratedOrder, groups)
        if (!areStringArraysEqual(projectOrder.value, mergedOrder)) {
          projectOrder.value = mergedOrder
          saveProjectOrder(projectOrder.value)
        }
      }
      if (Object.keys(rootsState.labels).length > 0) {
        const nextLabels = { ...projectDisplayNameById.value }
        let changed = false
        for (const [rootPath, label] of Object.entries(rootsState.labels)) {
          const projectName = toProjectNameFromWorkspaceRoot(rootPath)
          if (nextLabels[projectName] === label) continue
          nextLabels[projectName] = label
          changed = true
        }
        if (changed) {
          projectDisplayNameById.value = nextLabels
          saveProjectDisplayNames(nextLabels)
        }
      }
    } catch {
      // Keep local storage fallback when global state is unavailable.
    }
  }

  function renameProject(projectName: string, displayName: string): void {
    if (!projectName.length) return
    if ((projectDisplayNameById.value[projectName] ?? '') === displayName) return
    projectDisplayNameById.value = { ...projectDisplayNameById.value, [projectName]: displayName }
    saveProjectDisplayNames(projectDisplayNameById.value)
  }

  async function persistProjectOrderToWorkspaceRoots(): Promise<void> {
    if (IS_WASM_RUNTIME) return
    try {
      const rootsState = await getWorkspaceRootsState()
      const rootByProjectName = new Map<string, string>()
      for (const rootPath of rootsState.order) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (!rootByProjectName.has(projectName)) rootByProjectName.set(projectName, rootPath)
      }
      for (const group of sourceGroups.value) {
        const cwd = group.threads[0]?.cwd?.trim() ?? ''
        if (cwd) rootByProjectName.set(group.projectName, cwd)
      }
      const nextOrder: string[] = []
      for (const projectName of projectOrder.value) {
        const rootPath = rootByProjectName.get(projectName)
        if (rootPath && !nextOrder.includes(rootPath)) nextOrder.push(rootPath)
      }
      for (const rootPath of rootsState.order) {
        if (!nextOrder.includes(rootPath)) nextOrder.push(rootPath)
      }
      const nextActive = rootsState.active.filter((rootPath) => nextOrder.includes(rootPath))
      if (nextActive.length === 0 && nextOrder.length > 0) nextActive.push(nextOrder[0])
      await setWorkspaceRootsState({ order: nextOrder, labels: rootsState.labels, active: nextActive })
    } catch {
      // Keep local project order when global state persistence is unavailable.
    }
  }

  function removeProject(projectName: string): void {
    if (!projectName.length) return
    const nextProjectOrder = projectOrder.value.filter((name) => name !== projectName)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }
    sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)
    if (projectDisplayNameById.value[projectName] !== undefined) {
      const nextDisplayNames = { ...projectDisplayNameById.value }
      delete nextDisplayNames[projectName]
      projectDisplayNameById.value = nextDisplayNames
      saveProjectDisplayNames(nextDisplayNames)
    }
    applyThreadFlags()
    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)
    if (!flatThreads.some((thread) => thread.id === selectedThreadId.value)) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }
    void persistProjectOrderToWorkspaceRoots()
  }

  function reorderProject(projectName: string, toIndex: number): void {
    if (!projectName.length || sourceGroups.value.length === 0) return
    const visibleOrder = sourceGroups.value.map((group) => group.projectName)
    const fromIndex = visibleOrder.indexOf(projectName)
    if (fromIndex === -1) return
    const clampedToIndex = Math.max(0, Math.min(toIndex, visibleOrder.length - 1))
    const reorderedVisibleOrder = reorderStringArray(visibleOrder, fromIndex, clampedToIndex)
    if (reorderedVisibleOrder === visibleOrder) return
    projectOrder.value = mergeProjectOrder(reorderedVisibleOrder, sourceGroups.value)
    saveProjectOrder(projectOrder.value)
    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  function pinProjectToTop(projectName: string): void {
    const normalizedName = projectName.trim()
    if (!normalizedName) return
    const nextOrder = [normalizedName, ...projectOrder.value.filter((name) => name !== normalizedName)]
    if (areStringArraysEqual(projectOrder.value, nextOrder)) return
    projectOrder.value = nextOrder
    saveProjectOrder(projectOrder.value)
    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  return {
    hydrateWorkspaceRootsStateIfNeeded,
    renameProject,
    removeProject,
    reorderProject,
    pinProjectToTop,
    persistProjectOrderToWorkspaceRoots,
  }
}
