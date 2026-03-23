import { createLocalStorageWorkspaceAdapter } from 'xcodex-runtime'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'

const INDEXEDDB_WORKSPACE_PREFIX = 'indexeddb://workspace'

type WorkspaceReadResult = {
  path?: string
  content?: string
}

export function isIndexedDbWorkspaceUri(value: string): boolean {
  return value.trim().startsWith(`${INDEXEDDB_WORKSPACE_PREFIX}/`)
}

export function indexedDbWorkspaceUriToPath(value: string): string | null {
  const trimmed = value.trim()
  if (!isIndexedDbWorkspaceUri(trimmed)) return null

  const relativePath = trimmed.slice(INDEXEDDB_WORKSPACE_PREFIX.length).replace(/^\/+/u, '')
  if (!relativePath) return BROWSER_WORKSPACE_ROOT

  return `${BROWSER_WORKSPACE_ROOT}/${relativePath}`
}

export function isBrowserWorkspacePath(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === BROWSER_WORKSPACE_ROOT || trimmed.startsWith(`${BROWSER_WORKSPACE_ROOT}/`)
}

export function browserWorkspacePathToIndexedDbUri(value: string): string | null {
  const trimmed = value.trim()
  if (!isBrowserWorkspacePath(trimmed)) return null

  const relativePath = trimmed.slice(BROWSER_WORKSPACE_ROOT.length).replace(/^\/+/u, '')
  if (!relativePath) return `${INDEXEDDB_WORKSPACE_PREFIX}/`

  return `${INDEXEDDB_WORKSPACE_PREFIX}/${relativePath}`
}

export function toIndexedDbWorkspaceHref(value: string): string {
  return `/#/browser-workspace-file?uri=${encodeURIComponent(value.trim())}`
}

export async function readIndexedDbWorkspaceFile(value: string): Promise<{ path: string; content: string }> {
  const path = indexedDbWorkspaceUriToPath(value)
  if (!path) {
    throw new Error('Unsupported IndexedDB workspace URI.')
  }

  const workspace = createLocalStorageWorkspaceAdapter({
    rootPath: BROWSER_WORKSPACE_ROOT,
  })

  const result = await workspace.readFile({ path }) as WorkspaceReadResult
  if (typeof result.path !== 'string' || typeof result.content !== 'string') {
    throw new Error(`Failed to read browser workspace file: ${path}`)
  }

  return {
    path: result.path,
    content: result.content,
  }
}
