import { createLocalStorageWorkspaceAdapter } from 'xcodex-runtime'
import { BROWSER_WORKSPACE_ROOT } from '../../config/runtime'

const INDEXEDDB_WORKSPACE_PREFIX = 'indexeddb://workspace'
const BLOB_REVOKE_DELAY_MS = 60_000

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

export function isBrowserWorkspaceTarget(value: string): boolean {
  return isIndexedDbWorkspaceUri(value) || isBrowserWorkspacePath(value)
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

function mimeTypeForPath(path: string): string {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.md')) return 'text/markdown;charset=utf-8'
  if (normalized.endsWith('.json')) return 'application/json;charset=utf-8'
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'text/html;charset=utf-8'
  if (normalized.endsWith('.css')) return 'text/css;charset=utf-8'
  if (normalized.endsWith('.js')) return 'text/javascript;charset=utf-8'
  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) return 'text/plain;charset=utf-8'
  if (normalized.endsWith('.yml') || normalized.endsWith('.yaml')) return 'text/yaml;charset=utf-8'
  if (normalized.endsWith('.xml')) return 'application/xml;charset=utf-8'
  return 'text/plain;charset=utf-8'
}

export async function openBrowserWorkspaceFile(value: string): Promise<void> {
  const target = isIndexedDbWorkspaceUri(value) ? value : browserWorkspacePathToIndexedDbUri(value)
  if (!target) {
    throw new Error('Unsupported browser workspace file target.')
  }

  const { path, content } = await readIndexedDbWorkspaceFile(target)
  const blob = new Blob([content], { type: mimeTypeForPath(path) })
  const blobUrl = URL.createObjectURL(blob)
  window.open(blobUrl, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), BLOB_REVOKE_DELAY_MS)
}
