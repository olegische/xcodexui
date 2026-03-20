## WASM runtime files in use

The browser-hosted runtime in `xcodexui` is wired through two entry points:

- `src/api/wasmCodexGateway.ts`
- `src/runtime/wasm/runtime.ts`

Active local files:

- `runtime.ts`: builds the browser host and Codex runtime.
- `storage.ts`: IndexedDB persistence for auth, config, user config, and thread sessions.
- `threadIndex.ts`: lightweight thread listing/index used by the UI.
- `settings.ts`: runtime settings draft/status/load/save helpers for the UI.

Direct external dependencies used by the active runtime:

- `xcodex-runtime`
- `xcodex-runtime/storage`
- `xcodex-runtime/types`

Indirect local dependencies still resolved underneath the facade:

- `@browser-codex/wasm-browser-host`
- `@browser-codex/wasm-browser-codex-runtime`
- `@browser-codex/wasm-browser-tools`
- `@browser-codex/wasm-runtime-client`
- `@browser-codex/wasm-runtime-core`

What is not used directly by `xcodexui`:

- `src/integrations/xcodex/*`
- old local event bus helpers
- local transport re-export wrappers
- Rust crates under `codex-rs/wasm/browser` and `codex-rs/wasm/app_server`

Note: the Rust/browser artifacts are still an indirect runtime dependency via
`loadRuntimeModule()` and `loadXrouterRuntime()`, but they are not imported
directly from this repository.
