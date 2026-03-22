import { onMounted, onUnmounted, ref } from 'vue'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'codex-web-local.sidebar-collapsed.v1'
const SEND_WITH_ENTER_KEY = 'codex-web-local.send-with-enter.v1'
const IN_PROGRESS_SEND_MODE_KEY = 'codex-web-local.in-progress-send-mode.v1'
const DARK_MODE_KEY = 'codex-web-local.dark-mode.v1'

export function useAppShellPrefs() {
  const darkModeMediaQuery = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

  const isSidebarCollapsed = ref(loadSidebarCollapsed())
  const isSettingsOpen = ref(false)
  const sendWithEnter = ref(loadBoolPref(SEND_WITH_ENTER_KEY, true))
  const inProgressSendMode = ref<'steer' | 'queue'>(loadInProgressSendModePref())
  const darkMode = ref<'system' | 'light' | 'dark'>(loadDarkModePref())
  const prefersDarkMode = ref(darkModeMediaQuery?.matches ?? true)

  function applyDarkMode(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    prefersDarkMode.value = darkModeMediaQuery?.matches ?? true

    if (darkMode.value === 'dark') {
      root.classList.add('dark')
      return
    }

    if (darkMode.value === 'light') {
      root.classList.remove('dark')
      return
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }

  function setSidebarCollapsed(nextValue: boolean): void {
    if (isSidebarCollapsed.value === nextValue) return
    isSidebarCollapsed.value = nextValue
    saveSidebarCollapsed(nextValue)
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

  onMounted(() => {
    applyDarkMode()
    darkModeMediaQuery?.addEventListener('change', applyDarkMode)
  })

  onUnmounted(() => {
    darkModeMediaQuery?.removeEventListener('change', applyDarkMode)
  })

  return {
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
  }
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

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? '1' : '0')
}
