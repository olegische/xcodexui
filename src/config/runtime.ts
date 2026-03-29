const RUNTIME_KIND = import.meta.env.VITE_CODEX_RUNTIME === 'server' ? 'server' : 'wasm'

export const IS_WASM_RUNTIME = RUNTIME_KIND === 'wasm'
export const BROWSER_WORKSPACE_ROOT = '/workspace'
