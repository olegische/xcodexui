declare module '@browser-codex/wasm-browser-tools' {
  import type { BrowserDynamicToolExecutor } from '@browser-codex/wasm-browser-codex-runtime/types'
  import type { JsonValue } from '@browser-codex/wasm-runtime-core/types'

  export type PageEventKind =
    | 'navigation'
    | 'mutation'
    | 'selection'
    | 'click'
    | 'input'
    | 'tool'
    | 'lifecycle'

  export type PageTelemetryActivity = {
    kind: PageEventKind
    summary: string
    detail: string | null
    target: string | null
    timestamp: number
    data: JsonValue
  }

  export function createBrowserAwareToolExecutor(): BrowserDynamicToolExecutor
  export function initializePageTelemetry(): () => void
  export function configurePageTelemetry(options: {
    emitActivity?: ((activity: PageTelemetryActivity) => void) | null
  }): void
}
