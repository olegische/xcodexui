# XCodexUI WASM SDK Alignment Plan

## Scope

This document describes what `xcodexui` must change to match the current
`xcodex-runtime` browser SDK contract.

It is intentionally downstream-only.

The enforcement root remains the WASM runtime SDK, not `xcodexui`.

## Current Situation

The WASM core now exposes and documents a broader security contract than the
one `xcodexui` was originally built against.

The relevant SDK contract now includes:

- `runtime_mode`
- `browser_security`
- `requestBrowserToolApproval`
- fail-closed behavior for dangerous browser tools
- runtime-side validation for `openai-compatible` provider endpoints

Our current client implementation still reflects the older contract shape.

## Status Snapshot

This plan is now partly implemented.

### Implemented

- `runtimeMode` is now modeled in the local draft and saved through
  `materializeCodexConfig(...)`
- runtime policy presets were introduced via
  `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/presets.ts`
- saving or deleting runtime settings now invalidates the cached WASM runtime
  context
- runtime mode orchestration moved into
  `/Users/olegromanchuk/Projects/xcodexui/src/composables/useWasmRuntimeSettings.ts`
- runtime mode UI landed in
  `/Users/olegromanchuk/Projects/xcodexui/src/components/app/RuntimeSettingsView.vue`
- the refactored app architecture now routes runtime settings through the
  composable and settings view instead of keeping the logic in `App.vue`

### Still Missing

- direct provider model discovery still uses client-side `fetch()` and can drift
  from runtime transport policy
- `requestBrowserToolApproval` is still not wired into the runtime bootstrap
- WASM pending server request plumbing is still stubbed in
  `wasmCodexGateway.ts`
- `browser_security` is currently preset-driven in the client, but not exposed
  as an explicit editable settings model
- local runtime docs still need to be aligned with the new SDK contract

### Plan Semantics

The sections below describe the full target state.

Items listed in the plan may therefore be:

- already implemented
- partially implemented
- still open

The file is intended to remain a current roadmap, not just a historical record.

## Goal

Bring `xcodexui` into alignment with the current WASM SDK contract without
re-implementing runtime enforcement in the UI.

That means:

1. model the new config fields correctly
2. stop bypassing runtime transport policy
3. wire browser-tool approval mediation into the existing UI request pipeline
4. ensure runtime policy changes actually take effect in the client session
5. document the real behavior clearly

## Files That Actually Need Work

The main intervention points are:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/runtime.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/settings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/storage.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/api/wasmCodexGateway.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/composables/useWasmRuntimeSettings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/components/app/RuntimeSettingsView.vue`
- `/Users/olegromanchuk/Projects/xcodexui/src/App.vue`
- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/README.md`

These are the real downstream integration points.

After the app refactor, these files now have distinct roles:

- `src/runtime/wasm/*`
  - low-level runtime lifecycle
  - config mapping
  - storage integration
- `src/api/wasmCodexGateway.ts`
  - wasm runtime bridge and thread/runtime gateway
- `src/composables/useWasmRuntimeSettings.ts`
  - settings orchestration and async flows
- `src/components/app/RuntimeSettingsView.vue`
  - runtime settings form UI
- `src/App.vue`
  - route-level and prop/event wiring only

The plan below should follow this split instead of assuming the root component
owns the wasm settings logic directly.

## Contract Gaps In Current Client

### 1. Runtime Context Is Cached Too Aggressively

Current behavior:

- `runtimeContextPromise` in `runtime.ts` is cached indefinitely
- policy-sensitive runtime state is created once and then reused forever

Why this is now a problem:

- `runtime_mode` and `browser_security` are security-relevant config fields
- after saving config, the client must not assume the existing runtime instance
  reflects the new policy

Required change:

- add an explicit runtime-context invalidation path
- recreate the runtime after security-relevant config changes

Minimum expectation:

- after saving runtime settings, the active runtime context must be reset and
  rebuilt before further policy-sensitive use

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/runtime.ts`

## 2. Settings Draft Does Not Model The Current Config Contract

Current behavior:

- `WasmRuntimeDraft` only models provider and model settings
- it does not model:
  - `runtime_mode`
  - `browser_security.allow_localhost`
  - `browser_security.allow_private_network`
  - `browser_security.allowed_origins`

Required change:

- extend the local draft model to include the current SDK contract fields
- map UI state to the SDK config shape correctly
- preserve these fields through load, edit, save, and delete flows

Current implementation note:

- `runtimeMode` is already implemented
- `browserSecurity` is not yet represented as an explicit editable draft object

Important detail:

- UI draft may remain camelCase if that is more ergonomic
- but the mapping to and from the SDK contract must be explicit

Suggested local draft shape:

- `runtimeMode`
- `browserSecurity.allowedOrigins`
- `browserSecurity.allowLocalhost`
- `browserSecurity.allowPrivateNetwork`

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/settings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/composables/useWasmRuntimeSettings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/components/app/RuntimeSettingsView.vue`

## 3. Direct Provider Fetch Currently Bypasses Runtime Policy

Current behavior:

- `listWasmModelsForDraft()` performs direct `fetch(${baseUrl}/models)`
- that path does not go through runtime transport validation

Why this is now wrong:

- runtime policy now validates `openai-compatible` provider URLs
- localhost and private-network access are gated by `browser_security`
- UI-side fetch can disagree with runtime enforcement

This creates policy drift:

- UI may appear to accept or use an endpoint that runtime later blocks

Required change:

- remove or replace the direct provider fetch path
- route model listing through a runtime-validated path whenever possible

Current implementation note:

- this is still open
- `listWasmModelsForDraft()` still performs direct network access in the client

Acceptable fallback only if needed temporarily:

- disable model discovery for draft-only values until config is saved and loaded
  through the runtime

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/settings.ts`

## 4. Approval Mediation Is Not Wired

Current behavior:

- `runtime.ts` passes `requestUserInput`
- `runtime.ts` does not pass `requestBrowserToolApproval`

Contract implication:

- dangerous browser tools that require approval will fail closed

This may be acceptable as an intentional temporary product policy, but only if
we state it clearly and stop implying the tools are available.

Preferred downstream behavior:

- implement `requestBrowserToolApproval`
- route it into the existing pending server request UI flow

Current implementation note:

- this is still open
- current client behavior remains effectively fail-closed

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/runtime.ts`

## 5. WASM Gateway Still Drops Server Requests On The Floor

Current behavior:

- `replyToServerRequest(...)` is a no-op
- `getPendingServerRequests()` always returns `[]`

This is the main missing bridge.

Why it matters:

- the UI already has a generic pending-server-request pipeline
- desktop/non-wasm flow already uses it
- wasm mode currently bypasses it entirely

Required change:

- connect WASM runtime server requests to the existing UI pipeline
- store pending requests in wasm mode
- surface them through the same gateway contract used elsewhere
- send reply decisions back to the runtime

Current implementation note:

- this is still open
- `replyToServerRequest(...)` and `getPendingServerRequests()` are still stubbed

This is not a future enhancement.
It is part of matching the current SDK contract.

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/api/wasmCodexGateway.ts`

Related existing UI pipeline:

- `/Users/olegromanchuk/Projects/xcodexui/src/composables/desktop-state/thread-polling.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/api/codexGateway.ts`

## 6. Runtime Instructions Need To Stop Overclaiming

Current behavior:

- bootstrap instructions in `runtime.ts` describe browser capabilities in broad
  terms
- they were written before the new fail-closed and approval contract

Risk:

- client bootstrap text can drift from runtime-exposed capability surface
- especially in `default` and `demo` modes
- especially when approval mediator is absent

Required change:

- keep instructions high-level
- avoid promising tool availability that depends on mode or approval wiring
- describe tools as conditional on actual runtime exposure

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/runtime.ts`

## 7. Provider UX Must Match Runtime Validation

Current behavior:

- the base URL field is editable in the settings UI
- built-in provider restrictions are not fully reflected in the client UX
- `browser_security` controls are absent

Required change:

- `openai` and `xrouter-browser`:
  - lock or constrain base URL editing in the UI
- `openai-compatible`:
  - keep custom base URL editing
  - expose the related `browser_security` controls
  - explain that localhost and private-network access are runtime-gated

Current implementation note:

- runtime mode preset UX exists
- `browser_security` is not yet exposed as direct user-editable controls
- provider URL UX still needs final alignment with runtime policy

Primary files:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/settings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/composables/useWasmRuntimeSettings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/components/app/RuntimeSettingsView.vue`

## 8. Blocked Runtime Errors Need First-Class UX

Current behavior:

- client logic mostly assumes older transport behavior
- blocked policy outcomes are not yet a first-class part of the wasm UX model

Required change:

- normalize and surface runtime blocked errors clearly
- treat these as expected policy outcomes, not generic runtime failures
- make settings and approval UX readable when the runtime blocks:
  - dangerous tool execution
  - provider base URL usage
  - origin-restricted behavior

Primary files:

- `/Users/olegromanchuk/Projects/xcodexui/src/api/wasmCodexGateway.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/composables/useWasmRuntimeSettings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/components/app/RuntimeSettingsView.vue`

## 9. Local Documentation Is Out Of Date

Current behavior:

- local `src/runtime/wasm/README.md` still reflects the older contract

Required update:

- document:
  - `runtime_mode`
  - `browser_security`
  - `requestBrowserToolApproval`
  - fail-closed dangerous-tool behavior
  - provider validation
  - the fact that `xcodexui` is a consumer of the runtime SDK contract

Primary file:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/README.md`

## Concrete Work By File

### `/src/runtime/wasm/settings.ts`

Must do:

1. keep `runtimeMode` support aligned with the SDK contract
2. add local `browserSecurity` draft structure if we want explicit user editing
3. continue loading new security fields from stored config
4. continue saving new security fields into `materializeCodexConfig(...)`
5. preserve security fields through provider/transport changes
6. remove direct network policy drift in model discovery
7. update validation and user-facing status logic if needed

### `/src/runtime/wasm/runtime.ts`

Must do:

1. keep runtime invalidation and recreation API correct
2. keep resetting cached runtime context after policy-sensitive config save
3. wire `requestBrowserToolApproval`
4. keep `requestUserInput` behavior aligned with runtime needs
5. reduce instruction drift against runtime capability surface

### `/src/api/wasmCodexGateway.ts`

Must do:

1. implement wasm pending server request storage and retrieval
2. implement reply path back into the runtime
3. connect runtime notifications and server requests to existing UI polling flow
4. handle blocked/denied outcomes as expected policy results
5. avoid hardcoded assumptions about dangerous tool availability

### `/src/composables/useWasmRuntimeSettings.ts`

Must do:

1. keep runtime mode orchestration aligned with the SDK contract
2. expand orchestration to cover explicit `browser_security` editing if needed
3. stop assuming provider settings are the only wasm-settings domain
4. remove direct model-listing drift once runtime-safe discovery exists
5. surface policy blocks and validation failures distinctly from generic errors

### `/src/components/app/RuntimeSettingsView.vue`

Must do:

1. keep UI controls for `runtimeMode` aligned with the runtime presets
2. add UI controls for `browserSecurity` if direct editing is intended
3. adjust provider settings UX to match strict validation rules
4. show clearer risk copy for `default`, `demo`, `chaos`
5. make policy limitations and approval behavior legible to the user

### `/src/App.vue`

Must do:

1. keep only route-level wiring for the refactored wasm settings flow
2. pass any newly required props and events into `RuntimeSettingsView`
3. avoid reintroducing wasm-settings business logic into the root component

## Existing UI Infrastructure We Should Reuse

Do not invent a second approval system for wasm.

The client already has:

- shared gateway methods for pending server requests
- polling and notification handling
- reply flow for server requests

Relevant files:

- `/Users/olegromanchuk/Projects/xcodexui/src/api/codexGateway.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/composables/desktop-state/thread-polling.ts`

The wasm work should plug into this path, not bypass it.

## Delivery Order

### Phase A: Contract Alignment

1. update local typings and draft model
2. add `runtime_mode` and `browser_security` handling
3. update README to reflect the real contract

### Phase B: Runtime Correctness

1. add runtime invalidation
2. ensure saved security config actually takes effect
3. remove UI-side provider fetch drift

### Phase C: Approval Plumbing

1. wire `requestBrowserToolApproval`
2. connect wasm server requests to existing pending-request UI flow
3. handle reply path and blocked results

### Phase D: UI Completion

1. update `useWasmRuntimeSettings` for the broader config contract
2. add runtime mode switch in `RuntimeSettingsView`
3. add browser security controls in `RuntimeSettingsView`
4. align provider editing UX with runtime policy
5. refine risk and error messaging

## Non-Goals

This plan does not include:

- changing the underlying secret-storage model
- re-implementing runtime policy in the UI
- inventing a separate wasm-only approval framework
- extending the desktop/non-wasm security model

## Success Criteria

`xcodexui` is aligned when all of the following are true:

1. the client can load and save the full current WASM SDK config contract
2. changing security-relevant config actually affects the active runtime
3. the client no longer bypasses runtime provider policy with direct fetches
4. dangerous browser-tool approvals can be mediated through the existing UI path
5. blocked runtime decisions surface as expected policy outcomes
6. local runtime documentation matches the actual SDK contract
