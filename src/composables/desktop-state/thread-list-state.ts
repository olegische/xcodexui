import type { Ref } from 'vue'
import type { ThreadScrollState, UiProjectGroup, UiThread } from '../../types/codex'
import {
  areStringArraysEqual,
  flattenThreads,
  mergeIncomingWithLocalInProgressThreads,
  mergeProjectOrder,
  mergeThreadGroups,
  orderGroupsByProjectOrder,
  pruneThreadStateMap,
  toOptimisticThreadTitle,
  toProjectName,
} from './thread-groups'

export function createThreadListState(params: {
  sourceGroups: Ref<UiProjectGroup[]>
  projectGroups: Ref<UiProjectGroup[]>
  projectOrder: Ref<string[]>
  selectedThreadId: Ref<string>
  readStateByThreadId: Ref<Record<string, string>>
  scrollStateByThreadId: Ref<Record<string, ThreadScrollState>>
  loadedMessagesByThreadId: Ref<Record<string, boolean>>
  loadedVersionByThreadId: Ref<Record<string, string>>
  resumedThreadById: Ref<Record<string, boolean>>
  ledgerByThreadId: Ref<Record<string, unknown>>
  turnSummaryByThreadId: Ref<Record<string, unknown>>
  turnActivityByThreadId: Ref<Record<string, unknown>>
  turnErrorByThreadId: Ref<Record<string, unknown>>
  eventUnreadByThreadId: Ref<Record<string, boolean>>
  pendingServerRequestsByThreadId: Ref<Record<string, unknown[]>>
  globalServerRequestScope: string
  threadTitleById: Ref<Record<string, string>>
  hasLoadedThreads: Ref<boolean>
  isLoadingThreads: Ref<boolean>
  isThreadInProgress: (threadId: string) => boolean
  setSelectedThreadId: (threadId: string) => void
  saveProjectOrder: (order: string[]) => void
  saveReadStateMap: (state: Record<string, string>) => void
  saveThreadScrollStateMap: (state: Record<string, ThreadScrollState>) => void
  hydrateWorkspaceRootsStateIfNeeded: (groups: UiProjectGroup[]) => Promise<void>
  getThreadGroups: () => Promise<UiProjectGroup[]>
  loadThreadTitleCacheIfNeeded: () => Promise<void>
}) {
  const {
    sourceGroups,
    projectGroups,
    projectOrder,
    selectedThreadId,
    readStateByThreadId,
    scrollStateByThreadId,
    loadedMessagesByThreadId,
    loadedVersionByThreadId,
    resumedThreadById,
    ledgerByThreadId,
    turnSummaryByThreadId,
    turnActivityByThreadId,
    turnErrorByThreadId,
    eventUnreadByThreadId,
    pendingServerRequestsByThreadId,
    globalServerRequestScope,
    threadTitleById,
    hasLoadedThreads,
    isLoadingThreads,
    isThreadInProgress,
    setSelectedThreadId,
    saveProjectOrder,
    saveReadStateMap,
    saveThreadScrollStateMap,
    hydrateWorkspaceRootsStateIfNeeded,
    getThreadGroups,
    loadThreadTitleCacheIfNeeded,
  } = params

  function applyThreadFlags(): void {
    const titles = threadTitleById.value
    const flaggedGroups: UiProjectGroup[] = sourceGroups.value.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const cachedTitle = titles[thread.id]
        const inProgress = isThreadInProgress(thread.id)
        const isSelected = selectedThreadId.value === thread.id
        const lastReadIso = readStateByThreadId.value[thread.id]
        const unreadByEvent = eventUnreadByThreadId.value[thread.id] === true
        const unread = !isSelected && !inProgress && (unreadByEvent || lastReadIso !== thread.updatedAtIso)
        return {
          ...thread,
          title: cachedTitle || thread.title,
          inProgress,
          unread,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string): void {
    const nowIso = new Date().toISOString()
    const normalizedCwd = cwd.trim()
    const projectName = toProjectName(normalizedCwd)
    const nextThread: UiThread = {
      id: threadId,
      title: toOptimisticThreadTitle(firstMessageText),
      projectName,
      cwd: normalizedCwd,
      hasWorktree: normalizedCwd.includes('/.codex/worktrees/') || normalizedCwd.includes('/.git/worktrees/'),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      preview: firstMessageText,
      unread: false,
      inProgress: false,
    }
    const existingGroupIndex = sourceGroups.value.findIndex((group) => group.projectName === projectName)
    if (existingGroupIndex >= 0) {
      const existingGroup = sourceGroups.value[existingGroupIndex]
      const remainingThreads = existingGroup.threads.filter((thread) => thread.id !== threadId)
      const nextGroups = [...sourceGroups.value]
      nextGroups.splice(existingGroupIndex, 1, { projectName, threads: [nextThread, ...remainingThreads] })
      sourceGroups.value = nextGroups
    } else {
      sourceGroups.value = [{ projectName, threads: [nextThread] }, ...sourceGroups.value]
    }
    const nextProjectOrder = mergeProjectOrder(projectOrder.value, sourceGroups.value)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }
    applyThreadFlags()
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    const nextReadState = pruneThreadStateMap(readStateByThreadId.value, activeThreadIds)
    if (nextReadState !== readStateByThreadId.value) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
    const nextScrollState = pruneThreadStateMap(scrollStateByThreadId.value, activeThreadIds)
    if (nextScrollState !== scrollStateByThreadId.value) {
      scrollStateByThreadId.value = nextScrollState
      saveThreadScrollStateMap(nextScrollState)
    }
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    ledgerByThreadId.value = pruneThreadStateMap(ledgerByThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    eventUnreadByThreadId.value = pruneThreadStateMap(eventUnreadByThreadId.value, activeThreadIds)
    const nextPending: Record<string, unknown[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === globalServerRequestScope || activeThreadIds.has(threadId)) nextPending[threadId] = requests
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  async function loadThreads(): Promise<void> {
    if (!hasLoadedThreads.value) isLoadingThreads.value = true
    try {
      const [groups] = await Promise.all([getThreadGroups(), loadThreadTitleCacheIfNeeded()])
      await hydrateWorkspaceRootsStateIfNeeded(groups)
      const nextProjectOrder = mergeProjectOrder(projectOrder.value, groups)
      if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
        projectOrder.value = nextProjectOrder
        saveProjectOrder(projectOrder.value)
      }
      const orderedGroups = orderGroupsByProjectOrder(groups, projectOrder.value)
      const merged = mergeIncomingWithLocalInProgressThreads(sourceGroups.value, orderedGroups, isThreadInProgress)
      sourceGroups.value = mergeThreadGroups(sourceGroups.value, merged)
      applyThreadFlags()
      hasLoadedThreads.value = true
      const flatThreads = flattenThreads(projectGroups.value)
      pruneThreadScopedState(flatThreads)
      if (!flatThreads.some((thread) => thread.id === selectedThreadId.value)) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
    } finally {
      isLoadingThreads.value = false
    }
  }

  return {
    applyThreadFlags,
    insertOptimisticThread,
    pruneThreadScopedState,
    loadThreads,
  }
}
