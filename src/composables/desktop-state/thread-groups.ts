import type { UiProjectGroup, UiThread } from '../../types/codex'

export function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

export function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export function reorderStringArray(items: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export function mergeProjectOrder(previousOrder: string[], incomingGroups: UiProjectGroup[]): string[] {
  const nextOrder = [...new Set([...previousOrder, ...incomingGroups.map((group) => group.projectName)])]
  return areStringArraysEqual(previousOrder, nextOrder) ? previousOrder : nextOrder
}

export function orderGroupsByProjectOrder(incoming: UiProjectGroup[], projectOrder: string[]): UiProjectGroup[] {
  const incomingByName = new Map(incoming.map((group) => [group.projectName, group]))
  const ordered = projectOrder.map((projectName) => incomingByName.get(projectName) ?? { projectName, threads: [] })
  for (const group of incoming) {
    if (!projectOrder.includes(group.projectName)) ordered.push(group)
  }
  return ordered
}

export function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return first.id === second.id
    && first.title === second.title
    && first.projectName === second.projectName
    && first.cwd === second.cwd
    && first.hasWorktree === second.hasWorktree
    && first.createdAtIso === second.createdAtIso
    && first.updatedAtIso === second.updatedAtIso
    && first.preview === second.preview
    && first.unread === second.unread
    && first.inProgress === second.inProgress
}

export function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  return first.length === second.length && first.every((thread, index) => areThreadFieldsEqual(thread, second[index]))
}

export function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  return first.length === second.length && first.every((group, index) =>
    group.projectName === second[index].projectName && areThreadArraysEqual(group.threads, second[index].threads),
  )
}

export function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  let changed = false
  const next: Record<string, T> = {}
  for (const [threadId, value] of Object.entries(stateMap)) {
    if (!threadIds.has(threadId)) {
      changed = true
      continue
    }
    next[threadId] = value
  }
  return changed ? next : stateMap
}

export function mergeThreadGroups(previous: UiProjectGroup[], incoming: UiProjectGroup[]): UiProjectGroup[] {
  if (areGroupArraysEqual(previous, incoming)) return previous
  return incoming.map((group) => ({ projectName: group.projectName, threads: [...group.threads] }))
}

export function mergeIncomingWithLocalInProgressThreads(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
  isThreadInProgress: (threadId: string) => boolean,
): UiProjectGroup[] {
  const merged = mergeThreadGroups(previous, incoming)
  const incomingIds = new Set(flattenThreads(incoming).map((thread) => thread.id))
  for (const thread of flattenThreads(previous)) {
    if (!isThreadInProgress(thread.id) || incomingIds.has(thread.id)) continue
    const existingGroup = merged.find((group) => group.projectName === thread.projectName)
    if (existingGroup) {
      const mergedGroupIndex = merged.findIndex((group) => group.projectName === thread.projectName)
      merged[mergedGroupIndex] = { projectName: existingGroup.projectName, threads: [thread, ...existingGroup.threads] }
      continue
    }
    merged.push({ projectName: thread.projectName, threads: [thread] })
  }
  return merged
}

export function toProjectName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts.at(-1) || cwd || 'unknown-project'
}

export function toProjectNameFromWorkspaceRoot(value: string): string {
  const normalized = value.replace(/\\/gu, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) || normalized
}

export function toOptimisticThreadTitle(message: string): string {
  const firstLine = message.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
  return firstLine ? firstLine.slice(0, 80) : 'Untitled thread'
}
