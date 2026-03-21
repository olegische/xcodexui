# XCodexUI

Browser UI for XCodex WASM.

Run Codex locally in your browser, with no backend on the execution path.

XCodexUI is a Vue-based UI for Codex with two runtime modes, built around a wasm-first product direction.

## What This Project Is

XCodexUI is a Vue-based UI for Codex that can run in two different runtime configurations, with `wasm` mode as the primary architecture and product story.

Related upstream repositories:

- [`xcodex`](https://github.com/olegische/xcodex)
- [`xrouter`](https://github.com/olegische/xrouter)

### 1. WASM mode

The browser UI talks to a browser-hosted XCodex runtime instead of a local app-server bridge.

Use this when you want:

- local execution inside the browser runtime
- browser-persisted config and thread state
- no local app-server on the hot path
- easier experimentation with browser-native runtime behavior

In wasm mode:

- runtime config is stored in browser IndexedDB
- thread sessions are stored in browser IndexedDB
- the thread list is indexed separately in browser IndexedDB
- provider secrets such as API keys stay in browser IndexedDB
- provider credentials are consumed by the browser runtime itself, not by a local app-server
- the effective workspace root is `/workspace`
- several server-only features are intentionally disabled

### 2. Server mode

The browser UI talks to a local Node/Express bridge, and that bridge proxies requests to Codex app-server.

Use this when you want:

- local filesystem access
- worktrees
- Skills Hub
- file mentions and attachments
- desktop-like server behavior

## Current Architecture

### WASM mode

```text
Browser UI
  -> wasmCodexGateway
Browser-hosted Codex runtime
  -> IndexedDB storage
  -> local browser notifications
```

### Server mode

```text
Browser UI
  -> HTTP / WebSocket
Node/Express bridge
  -> Codex app-server RPC
Codex app-server
```

## Why WASM Matters Here

The interesting part of this repository is not "yet another browser wrapper". It is that the same UI can run against a browser-resident XCodex runtime.

That changes the product shape:

- no local app-server is required for message execution in wasm mode
- state recovery after reload depends on browser storage rather than server transcript alone
- runtime/provider configuration moves into a browser settings screen
- feature availability depends on which runtime is active

If you are trying to understand the app as it exists today, start from wasm mode. Server mode is still useful, but it is not the primary product story.

## WASM Mode Behavior

When `VITE_CODEX_RUNTIME=wasm`:

- `src/api/codexGateway.ts` switches all core thread operations to `src/api/wasmCodexGateway.ts`
- a browser runtime context is created with `xcodex-runtime`
- config/auth/session data is stored in IndexedDB
- sidebar thread metadata is mirrored into a lightweight local thread index
- runtime notifications come from the browser runtime subscription, not from `/codex-api/ws`

At a high level, one message goes through this path:

```text
ThreadComposer
  -> App.vue submit flow
  -> codexGateway
  -> wasmCodexGateway
  -> browser runtime turnStart
  -> runtime notifications
  -> UI live state
  -> persisted browser session
  -> threadRead / storage fallback
```

## WASM Runtime Settings

In wasm mode the app exposes a dedicated Runtime settings screen. It lets the user configure:

- transport mode
- provider route
- API key
- base URL
- model
- reasoning effort

Supported transport families in the current code:

- `xrouter-browser`
- `openai`
- `openai-compatible`

The API key and provider config are stored in browser storage, not in a server-side config file.
In the current implementation that means IndexedDB, and the key is used directly by the browser runtime rather than being handed off to a local app-server.

## Available Tools

Tool availability depends on runtime mode.

### WASM mode

The current wasm path exposes several wasm-runtime tool layers, not just the small built-in workspace set.

#### Workspace built-ins

These are the built-in workspace/file tools registered directly by the wasm core:

- `read_file`
- `list_dir`
- `grep_files`
- `apply_patch`
- `update_plan`
- `request_user_input`

Notes:

- `request_user_input` is conditional and depends on runtime config / mode
- `apply_patch` is the only freeform built-in in this group

#### Browser dynamic tools

The upstream browser runtime in `xcodex` also exposes a browser-aware dynamic tool catalog. The canonical tool names are:

- `browser__tool_search`
- `browser__inspect_page`
- `browser__inspect_dom`
- `browser__list_interactives`
- `browser__click`
- `browser__fill`
- `browser__navigate`
- `browser__wait_for`
- `browser__inspect_storage`
- `browser__inspect_cookies`
- `browser__inspect_http`
- `browser__inspect_resources`
- `browser__inspect_performance`
- `browser__evaluate`

The runtime also accepts these alias names for compatibility:

- `browser__page_context`
- `browser__extract_dom`
- `browser__probe_http`
- `browser__page_resources`
- `browser__performance_snapshot`
- `browser__run_probe`

Practical meaning:

- page inspection: `browser__inspect_page`, `browser__inspect_dom`, `browser__list_interactives`
- page actions: `browser__click`, `browser__fill`, `browser__navigate`, `browser__wait_for`
- browser state inspection: `browser__inspect_storage`, `browser__inspect_cookies`
- network/resource/perf inspection: `browser__inspect_http`, `browser__inspect_resources`, `browser__inspect_performance`
- controlled JS execution: `browser__evaluate`
- catalog lookup: `browser__tool_search`

#### Optional runtime-added tools

Depending on runtime config and what the upstream wasm runtime has registered for the session, wasm can also expose:

- `tool_search`
- `tool_suggest`
- session-provided dynamic tools
- app tools

That means the complete wasm tool surface is:

- fixed built-in workspace tools
- fixed browser dynamic tools
- optional search/suggest tools
- optional dynamic/app tools contributed by the active runtime session

This is materially broader than the old README implied.

### Server mode

In server mode, XCodexUI is mostly a UI and transport layer over the connected Codex app-server. The effective tool surface is therefore defined by that backend, but the current UI/protocol handling clearly supports rendering and transporting at least these categories:

- dynamic tool calls
- MCP tool calls
- command execution
- web search
- image view
- file change / patch application flows
- request-user-input flows

Practical interpretation:

- wasm mode has a narrow local tool set
- server mode can expose a broader tool set depending on the connected backend and MCP configuration
- the README should not claim parity between the two
- server mode is secondary in product positioning even if it exposes more tool categories

## WASM Limitations

Wasm mode is not a full drop-in replacement for server mode. Current UI/code behavior disables or limits several features:

- Skills Hub is hidden
- file mentions are disabled
- file attachments are disabled
- dictation is disabled
- project browsing is disabled
- worktree features are disabled
- rollback UI is disabled
- server request approval flows are effectively stubbed

That is intentional and matches the current implementation.

## Browser Persistence Model

Wasm mode uses browser persistence heavily.

### IndexedDB stores

- runtime storage DB: `codex-wasm-browser-terminal`
- thread index DB: `xcodexui-wasm`

Persisted data includes:

- provider/auth config
- Codex config
- stored thread sessions
- lightweight thread metadata for the sidebar

For provider credentials, the practical meaning is:

- API keys are stored in IndexedDB, not in localStorage
- key handling stays inside the browser runtime path
- there is no local app-server hop for credential processing in wasm mode

This is also why the app can reconstruct thread content after reload even when the in-memory runtime state is gone.

## Running The Project

### WASM development

First prepare the browser runtime assets:

```bash
just wasm-runtime-pull
```

Then run the app in wasm mode:

```bash
just wasm-dev
```

Or do both in one command:

```bash
just wasm-dev-ready
```

The wasm asset preparation script downloads and installs:

- `xcodex` wasm browser bundle into `public/pkg`
- `xrouter-browser` assets into `public/xrouter-browser`
- runtime import bundle into `.vendor/xcodex-runtime`

Upstream sources:

- [`xcodex`](https://github.com/olegische/xcodex)
- [`xrouter`](https://github.com/olegische/xrouter)

### Standard development UI

```bash
npm install
npm run dev
```

This starts the Vite app in the default runtime mode.

## Runtime Assets

Wasm mode expects local browser runtime assets under:

- `public/pkg`
- `public/xrouter-browser`

Prepare them with the `just` recipe:

```bash
just wasm-runtime-pull
```

The underlying implementation lives in `scripts/prepare-wasm-runtime.sh`, but the intended entry point for repository users is the `just` recipe.

Environment variables supported by the script:

- `XCODEX_WASM_TARBALL`
- `XROUTER_BROWSER_TARBALL`

They can point either to URLs or local tarball paths.

## Package Scripts

```bash
npm run dev
npm run build:frontend
npm run build:cli
npm run build
npm run prepare:wasm-runtime
```

## Local CLI / Server Mode

The published `codexapp` CLI is the local/server-mode entry point.

Typical flow:

```bash
npx codexapp
```

That path starts a local HTTP server and serves the built web UI. It is still supported, but it should be read as the secondary runtime path in this repository, not as the defining architecture.

## Requirements

- Node.js `18+`
- browser with IndexedDB support for wasm mode
- wasm runtime assets prepared locally for wasm development
- Codex app-server environment available when using server mode

## Repository Pointers

If you are reading the code, start here:

- `src/config/runtime.ts`
- `src/api/codexGateway.ts`
- `src/api/wasmCodexGateway.ts`
- `src/runtime/wasm/runtime.ts`
- `src/runtime/wasm/storage.ts`
- `src/runtime/wasm/threadIndex.ts`
- `src/runtime/wasm/settings.ts`
- `scripts/prepare-wasm-runtime.sh`
- `src/runtime/wasm/README.md`

## Contributing

Issues and PRs are welcome, especially around:

- wasm runtime stability
- transcript recovery after reload
- parity gaps between server and wasm modes
- documentation that reflects the actual architecture
