import type { ThreadScrollState } from '../../types/codex'

const READ_STATE_STORAGE_KEY = 'codex-web-local.thread-read-state.v1'
const SCROLL_STATE_STORAGE_KEY = 'codex-web-local.thread-scroll-state.v1'
const SELECTED_THREAD_STORAGE_KEY = 'codex-web-local.selected-thread-id.v1'
const PROJECT_ORDER_STORAGE_KEY = 'codex-web-local.project-order.v1'
const PROJECT_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.project-display-name.v1'
const AUTO_REFRESH_ENABLED_STORAGE_KEY = 'codex-web-local.auto-refresh-enabled.v1'

export function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

export function loadJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

export function saveJsonStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function normalizeThreadScrollState(value: unknown): ThreadScrollState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rawState = value as Record<string, unknown>
  if (typeof rawState.scrollTop !== 'number' || !Number.isFinite(rawState.scrollTop)) return null
  if (typeof rawState.isAtBottom !== 'boolean') return null
  const normalized: ThreadScrollState = {
    scrollTop: Math.max(0, rawState.scrollTop),
    isAtBottom: rawState.isAtBottom,
  }
  if (typeof rawState.scrollRatio === 'number' && Number.isFinite(rawState.scrollRatio)) {
    normalized.scrollRatio = clamp(rawState.scrollRatio, 0, 1)
  }
  return normalized
}

export function loadReadStateMap(): Record<string, string> {
  const parsed = loadJsonStorage<unknown>(READ_STATE_STORAGE_KEY, {})
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
}

export function saveReadStateMap(state: Record<string, string>): void {
  saveJsonStorage(READ_STATE_STORAGE_KEY, state)
}

export function loadAutoRefreshEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(AUTO_REFRESH_ENABLED_STORAGE_KEY) === '1'
}

export function saveAutoRefreshEnabled(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTO_REFRESH_ENABLED_STORAGE_KEY, value ? '1' : '0')
}

export function loadThreadScrollStateMap(): Record<string, ThreadScrollState> {
  const parsed = loadJsonStorage<unknown>(SCROLL_STATE_STORAGE_KEY, {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const normalizedMap: Record<string, ThreadScrollState> = {}
  for (const [threadId, state] of Object.entries(parsed as Record<string, unknown>)) {
    const normalizedState = normalizeThreadScrollState(state)
    if (threadId && normalizedState) normalizedMap[threadId] = normalizedState
  }
  return normalizedMap
}

export function saveThreadScrollStateMap(state: Record<string, ThreadScrollState>): void {
  saveJsonStorage(SCROLL_STATE_STORAGE_KEY, state)
}

export function loadSelectedThreadId(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(SELECTED_THREAD_STORAGE_KEY) ?? ''
}

export function saveSelectedThreadId(threadId: string): void {
  if (typeof window === 'undefined') return
  if (!threadId) {
    window.localStorage.removeItem(SELECTED_THREAD_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_THREAD_STORAGE_KEY, threadId)
}

export function loadProjectOrder(): string[] {
  const parsed = loadJsonStorage<unknown>(PROJECT_ORDER_STORAGE_KEY, [])
  if (!Array.isArray(parsed)) return []
  const order: string[] = []
  for (const item of parsed) {
    if (typeof item === 'string' && item.length > 0 && !order.includes(item)) {
      order.push(item)
    }
  }
  return order
}

export function saveProjectOrder(order: string[]): void {
  saveJsonStorage(PROJECT_ORDER_STORAGE_KEY, order)
}

export function loadProjectDisplayNames(): Record<string, string> {
  const parsed = loadJsonStorage<unknown>(PROJECT_DISPLAY_NAME_STORAGE_KEY, {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const displayNames: Record<string, string> = {}
  for (const [projectName, displayName] of Object.entries(parsed as Record<string, unknown>)) {
    if (projectName && typeof displayName === 'string') displayNames[projectName] = displayName
  }
  return displayNames
}

export function saveProjectDisplayNames(displayNames: Record<string, string>): void {
  saveJsonStorage(PROJECT_DISPLAY_NAME_STORAGE_KEY, displayNames)
}
