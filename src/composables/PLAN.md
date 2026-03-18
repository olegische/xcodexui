# Chat State Migration Plan

## Goal

Move the current chat UI implementation toward a ledger-based architecture with explicit phases:

- `live`
- `finalizing`
- `settled`

This plan assumes implementation stays near `useDesktopState.ts` first, then can be refactored into smaller modules.

## Phase 1. Establish Explicit Chat Phases

Introduce per-thread phase tracking:

- `idle`
- `live`
- `finalizing`
- `settled`
- `failed`

Tasks:

- add a per-thread chat phase store
- remove implicit phase inference from unrelated booleans
- make turn lifecycle transitions explicit in notification handling

Exit criteria:

- every thread has a single authoritative chat phase
- notification handlers do not rely on heuristics to guess whether a turn is live or settled

## Phase 2. Introduce A Live Event Ledger

Replace ad hoc live buffers with a single append-only event log for the active turn.

Tasks:

- define `LiveTurnEvent` types
- append normalized runtime notifications to the event log
- stop treating live reasoning, live assistant text, and tool calls as separate state systems

Exit criteria:

- all live renderable content can be reproduced from the event log
- ordering comes from event order, not UI buckets

## Phase 3. Build Deterministic Live Projection

Create a pure projection function from `LiveTurnEvent[] -> UiMessage[]`.

Tasks:

- reasoning deltas become reasoning segments
- assistant deltas become assistant segments
- tool events become tool messages
- command events become command rows
- projection handles segment boundaries deterministically

Exit criteria:

- live rendering uses a projection function, not scattered mutation logic
- unit tests cover event ordering and segment boundaries

## Phase 4. Seal Finalized Snapshots

When a turn completes locally, freeze the current projected live state into an immutable snapshot.

Tasks:

- define `FinalizedTurnSnapshot`
- seal snapshot on `turn/completed`
- stop showing raw live event log after sealing
- keep snapshot visible until canonical transcript is confirmed

Exit criteria:

- live stream does not disappear at turn completion
- finalized content is stable and immutable

## Phase 5. Reconcile With Confirmed Transcript

Use canonical `thread/read` transcript as the only source for settled state.

Tasks:

- identify when canonical transcript confirms a finalized turn
- replace finalized snapshot with confirmed transcript
- never merge finalized snapshot into settled transcript history
- clear stale live artifacts during successful reconciliation

Exit criteria:

- no duplicate user message
- no duplicate assistant carryover
- no snapshot leftovers in settled state

## Phase 6. Support Next Turn Safely

Ensure a new user turn starts cleanly from confirmed history.

Tasks:

- clear old live ledger on new turn start
- clear finalized snapshot for the newly active turn
- keep prior confirmed turns immutable
- verify queued and immediate follow-up user turns

Exit criteria:

- second user message appears in the correct place
- old finalized state does not leak into the next live turn

## Phase 7. Isolate Rendering From State Reconciliation

Push reconciliation and projection concerns out of the conversation view layer.

Tasks:

- keep `ThreadConversation.vue` presentation-only
- feed it a single projected message list
- ensure style-only logic stays in the component
- move state logic into composables or reducers only

Exit criteria:

- no reconciliation logic in the Vue view
- component does not need to know live vs finalized vs settled origins

## Phase 8. Add Test Coverage

The migration is not complete without tests.

Tasks:

- add reducer/projection tests for event order
- add phase transition tests
- add integration tests for:
  - live -> finalizing
  - finalizing -> settled
  - settled -> next live

Suggested scenarios:

1. assistant delta -> tool -> assistant delta -> completed
2. reasoning -> tool -> reasoning -> assistant -> completed
3. completed turn followed by immediate second user message
4. failed turn with residual live state

Exit criteria:

- current regressions are reproducible by tests
- fixes are protected against future regressions

## Suggested Refactor Order

Do not attempt a giant rewrite in one patch.

Recommended order:

1. add explicit phases
2. add event ledger
3. add pure live projection
4. add finalized snapshot
5. replace settled merge logic
6. add tests
7. optionally extract reducer/store files from `useDesktopState.ts`

## Risks

### Risk: Partial Migration

If live projection is introduced but old merge heuristics remain, bugs will become harder to reason about.

Mitigation:

- delete obsolete paths aggressively once the new path is in place

### Risk: View-Layer Logic Leakage

If the component compensates for bad state ordering, the architecture will rot again.

Mitigation:

- keep ordering and reconciliation out of `ThreadConversation.vue`

### Risk: Server Shape Mismatch

Confirmed transcript will not necessarily match the structure of live projection.

Mitigation:

- treat reconciliation as replacement of authority, not structural equality

## Definition Of Done

The migration is complete when:

- live rendering is driven by an append-only event ledger
- finalization is represented by an immutable snapshot
- settled state is represented by canonical transcript only
- next turns begin from clean confirmed history
- no message duplication or reordering occurs at phase boundaries
- integration tests cover the full lifecycle
