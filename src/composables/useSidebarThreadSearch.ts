import { nextTick, onUnmounted, ref, watch } from 'vue'
import { searchThreads } from '../api/codexGateway'

export function useSidebarThreadSearch() {
  const sidebarSearchQuery = ref('')
  const isSidebarSearchVisible = ref(false)
  const sidebarSearchInputRef = ref<HTMLInputElement | null>(null)
  const serverMatchedThreadIds = ref<string[] | null>(null)

  let threadSearchTimer: ReturnType<typeof setTimeout> | null = null

  function setSidebarSearchInputRef(
    value: Element | { $el?: Element } | null,
    _refs?: Record<string, unknown>,
  ): void {
    const element = value instanceof Element ? value : value?.$el ?? null
    sidebarSearchInputRef.value = element instanceof HTMLInputElement ? element : null
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

  onUnmounted(() => {
    if (!threadSearchTimer) return
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  })

  return {
    sidebarSearchQuery,
    isSidebarSearchVisible,
    sidebarSearchInputRef,
    serverMatchedThreadIds,
    setSidebarSearchInputRef,
    toggleSidebarSearch,
    clearSidebarSearch,
    onSidebarSearchKeydown,
  }
}
