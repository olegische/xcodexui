## WASM runtime files in use

The browser-hosted runtime in `xcodexui` is wired through two entry points:

- `src/api/wasmCodexGateway.ts`
- `src/runtime/wasm/runtime.ts`

Active local files:

- `runtime.ts`: builds the browser Codex runtime from the release bundle in `public/pkg/current/xcodex-runtime.js`.
- `storage.ts`: IndexedDB persistence for auth, config, user config, and thread sessions via `xcodex-runtime`.
- `threadIndex.ts`: lightweight thread listing/index used by the UI.
- `settings.ts`: runtime settings draft/status/load/save helpers for the UI.

Active runtime contract:

- `xcodex-runtime`
- `xcodex-runtime/types`
- `/pkg/manifest.json`
- `/pkg/current/*`
- `/xrouter-browser/manifest.json`
- `/xrouter-browser/current/*`

Runtime web assets are expected locally under:

- `public/pkg`
- `public/xrouter-browser`

Populate them with:

- `just wasm-runtime-pull`

What is not used directly by `xcodexui`:

- `src/integrations/xcodex/*`
- old local event bus helpers
- local transport re-export wrappers
- Rust crates under `codex-rs/wasm/browser` and `codex-rs/wasm/app_server`

Note: the Rust/browser artifacts are still an indirect runtime dependency via
`loadRuntimeModule()` and `loadXrouterRuntime()`, but they are not imported
directly from this repository.
