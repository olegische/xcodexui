# XCodexUI WASM Integration Plan

## Scope

This document covers only the `xcodexui` side.

Assumption:

- the authoritative implementation of runtime modes and provider `baseUrl` policy will land first in `codex-rs/wasm`

Because of that, the work below is intentionally downstream:

- UI integration
- config editing
- mode display
- local gateway/runtime adaptation where needed

## Dependency On WASM Core

The UI work should start after the wasm core provides:

1. `runtimeMode` in the persisted config contract.
2. strict `baseUrl` validation in config materialization.
3. mode-aware filtering of browser tools inside the runtime.

Until that exists in the wasm bundle, `xcodexui` should not try to emulate final policy locally.

## UI Goals

1. Expose an explicit runtime mode switch:
   - `default`
   - `demo`
   - `chaos`
2. Make the active risk level obvious to the user.
3. Avoid duplicating enforcement logic that belongs in the runtime.
4. Keep `xcodexui` aligned with the wasm core contract.

## Planned UI Behavior

The settings UI should present three explicit modes:

- `Default`
  - dangerous tools disabled
- `Demo`
  - browser inspection tools expanded
  - `evaluate` still disabled
- `Chaos`
  - full browser tool surface
  - includes `evaluate`

The UI should show a short explanation under the switch. `Chaos` should have the strongest warning treatment.

## XCodexUI Changes After WASM Core Lands

Primary local files likely affected:

- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/settings.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/runtime/wasm/runtime.ts`
- `/Users/olegromanchuk/Projects/xcodexui/src/api/wasmCodexGateway.ts`
- relevant settings UI components outside this folder

Planned changes:

1. Extend local TS types to include `runtimeMode`.
2. Load and save `runtimeMode` through the existing wasm config flow.
3. Add a visible UI control for switching mode.
4. Add mode-specific explanatory copy.
5. Stop treating tool policy as a UI responsibility once runtime enforces it.

## Settings Layer Work

In `settings.ts`:

1. extend `WasmRuntimeDraft` with `runtimeMode`
2. populate it from stored config
3. pass it into config materialization
4. preserve it during draft updates and provider changes
5. include it in derived status only if useful for UX

Important:

- `xcodexui` should not invent fallback policy different from the wasm core
- at most it may provide temporary guardrails while waiting for new runtime artifacts during development

## Runtime Layer Work

In `runtime.ts`:

1. keep using runtime-provided dynamic tool surface as the source of truth
2. avoid baking mode policy into `XCODEX_WASM_BASE_INSTRUCTIONS`
3. if the instructions mention capabilities, keep them conditional and aligned with actual runtime-exposed tools

Reason:

- once mode-aware filtering lands in the core, over-describing capabilities in UI bootstrap text becomes a correctness risk

## Gateway Layer Work

In `wasmCodexGateway.ts`:

1. treat runtime tool visibility as authoritative
2. do not hardcode assumptions that storage or evaluate tools are always available
3. keep any mode-specific behavior out of thread read/write reconstruction unless strictly needed for rendering

Potential future follow-up:

- if UI wants to render a capability badge or mode badge per thread/runtime, read it from config, not from guessed tool names

## Provider UX

After strict validation lands in wasm core:

1. `openai` and `xrouter-browser` base URL fields should either become read-only or clearly constrained
2. `openai-compatible` keeps editable custom base URL behavior
3. any runtime validation error should be surfaced cleanly in settings

Recommended UX:

- hide or lock the base URL field for strict providers
- leave it editable only for `openai-compatible`

That keeps UI aligned with the actual contract instead of letting users type values that runtime will later reject.

## Approval Follow-Up

Not part of this change, but relevant later:

- `demo` mode is the intended place to add approval flows for selected dangerous tools

When that work starts:

1. approval policy should be modeled separately from `runtimeMode`
2. `runtimeMode` controls maximum available surface
3. approval controls whether a permitted tool can execute immediately

This separation should be preserved in `xcodexui` UI as well.

## Delivery Order For XCodexUI

1. wait for updated `codex-rs/wasm` contract and bundle
2. update local runtime typings if needed
3. update settings draft/load/save flow
4. add explicit mode switch in UI
5. adapt provider settings UI for strict `baseUrl` providers
6. verify runtime behavior matches rendered mode

## Non-Goals

This plan does not implement:

- local-only fake tool filtering as a permanent solution
- local-only fake `baseUrl` enforcement that diverges from wasm core
- approval flow for `demo`
- secret storage redesign

Those are separate tasks.
