# codexapp

Browser UI for Codex with two runtime modes:

- `server` mode: web UI talks to a local Codex app-server bridge
- `wasm` mode: Codex runtime runs inside the browser and stores state in IndexedDB

This repository now has a real browser-hosted runtime path. That is the important part. The old README treated the project mostly as a generic remote UI wrapper; that is no longer an accurate description of the codebase.

## What This Project Is

`codexapp` is a Vue-based Codex UI that can run in two different backend configurations.

### 1. Server mode

The browser UI talks to a local Node/Express bridge, and that bridge proxies requests to Codex app-server.

Use this when you want:

- local filesystem access
- worktrees
- Skills Hub
- file mentions and attachments
- desktop-like server behavior

### 2. WASM mode

The browser UI talks to a browser-hosted Codex runtime instead of an external app-server.

Use this when you want:

- a self-contained browser runtime
- browser-persisted config and thread state
- no external Codex app-server on the hot path
- easier local experimentation with browser-native runtime behavior

In wasm mode:

- runtime config is stored in browser IndexedDB
- thread sessions are stored in browser IndexedDB
- the thread list is indexed separately in browser IndexedDB
- the effective workspace root is `/workspace`
- several server-only features are intentionally disabled

## Current Architecture

### Server mode

```text
Browser UI
  -> HTTP / WebSocket
Node/Express bridge
  -> Codex app-server RPC
Codex app-server
```

### WASM mode

```text
Browser UI
  -> wasmCodexGateway
Browser-hosted Codex runtime
  -> IndexedDB storage
  -> local browser notifications
```

## Why WASM Matters Here

The interesting part of this repository is not "yet another browser wrapper". It is that the same UI can run against a browser-resident Codex runtime.

That changes the product shape:

- no external app-server is required for message execution in wasm mode
- state recovery after reload depends on browser storage rather than server transcript alone
- runtime/provider configuration moves into a browser settings screen
- feature availability depends on which runtime is active

If you are trying to understand the app as it exists today, start from wasm mode, not from the old remote-access story.

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

This is also why the app can reconstruct thread content after reload even when the in-memory runtime state is gone.

## Running The Project

### Standard development UI

```bash
npm install
npm run dev
```

This starts the Vite app in the default runtime mode.

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

## Runtime Assets

Wasm mode expects local browser runtime assets under:

- `public/pkg`
- `public/xrouter-browser`

These are prepared by:

```bash
bash scripts/prepare-wasm-runtime.sh
```

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

## What The Published CLI Does

The published `codexapp` CLI is still primarily the server-mode entry point.

Typical flow:

```bash
npx codexapp
```

That path starts a local HTTP server and serves the built web UI. In the current codebase, that story is still valid, but it is only half of the product. The README should not pretend that server mode is the whole architecture.

## Requirements

- Node.js `18+`
- browser with IndexedDB support for wasm mode
- wasm runtime assets prepared locally for wasm development
- Codex app-server environment available when using server mode

## Screenshots

### Skills Hub
![Skills Hub](docs/screenshots/skills-hub.png)

### Chat
![Chat](docs/screenshots/chat.png)

### Mobile UI
![Skills Hub Mobile](docs/screenshots/skills-hub-mobile.png)
![Chat Mobile](docs/screenshots/chat-mobile.png)

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
