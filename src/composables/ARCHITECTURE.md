# Chat State Architecture

## Objective

Define a reliable state model for chat UI that supports:

- live streaming
- turn finalization
- server reconciliation
- immutability of completed turns
- safe continuation into the next turn

The goal is to stop treating the chat as "an array of messages with patches" and instead treat it as an append-only event system with explicit sealing and reconciliation.

## Core Idea

We use a ledger-style model for each turn.

During a turn, UI state is derived from live events only.
When the turn completes, we seal the live view into an immutable finalized snapshot.
When canonical server state arrives, we reconcile and replace the finalized snapshot with confirmed transcript data.

This is conceptually similar to:

- event sourcing
- append-only logs
- snapshot + reconciliation
- finite state machines

The "blockchain" analogy is useful as a vocabulary:

- live event stream = mempool
- finalized turn snapshot = sealed block
- confirmed transcript = canonical chain state
- reconciliation = explicit canonical replacement, never silent mutation

## Non-Goals

This architecture does not try to:

- make the server transcript structurally identical to live events
- preserve every raw event forever in render state
- patch old turns in place by heuristics
- mix live and confirmed data without an explicit phase transition

## Source Layers

The chat UI should be modeled as four separate layers.

### 1. Live Event Log

Append-only events for the currently active turn.

Examples:

- `turn_started`
- `reasoning_delta`
- `assistant_delta`
- `tool_call_started`
- `tool_call_completed`
- `command_started`
- `command_output_delta`
- `command_completed`
- `turn_completed`
- `turn_failed`

Properties:

- append-only
- scoped to one active turn
- never mutated into canonical transcript
- cleared only when the turn is sealed or discarded

### 2. Finalized Turn Snapshots

Immutable render snapshots produced at the moment a turn finishes locally.

Purpose:

- preserve the exact visible state at the end of live streaming
- keep the UI stable while waiting for canonical server transcript
- prevent "live disappears before settled state arrives"

Properties:

- one snapshot per finalized-but-not-yet-confirmed turn
- immutable after sealing
- removed only when reconciliation succeeds or the turn is explicitly discarded

### 3. Confirmed Transcript

Canonical transcript returned by server APIs such as `thread/read`.

Properties:

- source of truth for settled history
- may differ from live projection shape
- replaces finalized snapshots during reconciliation
- must not be merged heuristically with finalized snapshots when the turn is already settled

### 4. Render Projection

A pure derived view built from:

- confirmed transcript
- finalized snapshots
- live event log
- pending user message
- turn status metadata

Render projection is the only thing the view consumes.

## State Machine

Each thread should expose an explicit chat phase.

### `idle`

No active turn.
Render from confirmed transcript only.

### `live`

Turn is in progress.
Render from:

- confirmed transcript
- pending user message
- live projection derived from current turn event log

Rules:

- no finalized snapshot for the active turn
- no server transcript merge into live turn history except for deduping already-confirmed items

### `finalizing`

`turn_completed` was observed locally, but canonical settled transcript is not yet confirmed.

Render from:

- confirmed transcript
- sealed finalized snapshot for the completed turn

Rules:

- live log is no longer shown directly
- finalized snapshot is immutable
- UI must not fall back to an empty or partial transcript

### `settled`

Canonical transcript for the completed turn has been received and accepted.

Render from:

- confirmed transcript only

Rules:

- finalized snapshot for that turn is removed
- no snapshot content is merged into the confirmed transcript
- no old live artifacts survive

### `failed`

Turn failed or was interrupted.

Render from:

- confirmed transcript
- error state
- optionally the last live snapshot if product wants failure preservation

This must be an explicit product choice.

## Invariants

The system must preserve these invariants.

### Immutability

Once a turn snapshot is sealed, it is immutable.
If canonical server state differs, we replace the snapshot during reconciliation.
We do not rewrite the sealed snapshot in place.

### No Mixed Sources Without Phase

Live events and confirmed transcript must never be blended implicitly.
Every mixture must be justified by an explicit phase:

- `live`
- `finalizing`
- `settled`

### Confirmed Transcript Wins In `settled`

When the turn is settled, the render source for that turn is the confirmed transcript.
Not:

- confirmed transcript plus leftovers
- confirmed transcript plus snapshot
- confirmed transcript plus heuristic carryover

### New Turn Never Reuses Old Live State

A new user turn starts with:

- empty live event log
- no finalized snapshot for the new active turn
- confirmed transcript as the only historical base

### Order Comes From Events

During `live`, ordering is determined by the event ledger.
Not by:

- message type buckets
- overlay text buffers
- post-hoc sorting

## Recommended Data Model

The current implementation can evolve toward something like this:

```ts
type ChatPhase = 'idle' | 'live' | 'finalizing' | 'settled' | 'failed'

type LiveTurnEvent =
  | { type: 'turn_started'; turnId: string; threadId: string; atIso: string }
  | { type: 'reasoning_delta'; turnId: string; itemId: string; delta: string; atIso: string }
  | { type: 'assistant_delta'; turnId: string; itemId: string; delta: string; atIso: string }
  | { type: 'tool_call_started'; turnId: string; itemId: string; tool: string; atIso: string }
  | { type: 'tool_call_completed'; turnId: string; itemId: string; tool: string; atIso: string }
  | { type: 'command_started'; turnId: string; itemId: string; command: string; atIso: string }
  | { type: 'command_output_delta'; turnId: string; itemId: string; delta: string; atIso: string }
  | { type: 'command_completed'; turnId: string; itemId: string; atIso: string }
  | { type: 'turn_completed'; turnId: string; atIso: string }
  | { type: 'turn_failed'; turnId: string; message: string; atIso: string }

type FinalizedTurnSnapshot = {
  turnId: string
  messages: UiMessage[]
  durationMs: number
  completedAtIso: string
}

type ThreadChatState = {
  phase: ChatPhase
  confirmedTranscript: UiMessage[]
  liveEventLog: LiveTurnEvent[]
  finalizedSnapshots: FinalizedTurnSnapshot[]
  pendingUserMessage: UiMessage | null
}
```

The exact shape can differ, but the separation of concerns should remain.

## Projection Rules

### Live Projection

Project the event log into visible messages.

Examples:

- reasoning deltas become reasoning segments
- assistant deltas become assistant segments
- tool calls become explicit tool messages
- command events become command rows

This projection should be deterministic and replayable from the live event log alone.

### Finalized Snapshot Construction

When a turn completes locally:

1. stop appending to the visible live projection
2. build a frozen snapshot from the current projected live turn
3. store it in finalized snapshots
4. clear the active live event log for display purposes

### Reconciliation

When canonical transcript arrives:

1. identify which finalized turn it confirms
2. replace the finalized snapshot with confirmed transcript content
3. remove the finalized snapshot
4. transition phase to `settled`

Important:

- do not merge confirmed transcript with finalized snapshot as if both were history
- do not keep finalized snapshot after reconciliation

## Why Previous Attempts Were Fragile

The earlier implementation mixed three different concepts:

- live reasoning overlay
- live assistant/tool message buffers
- canonical `thread/read` transcript

This caused:

- disappearing live stream at turn end
- duplicate or drifting assistant segments
- tool calls appearing in the wrong place
- user messages moving relative to finalized content

Those failures are expected when source layers are mixed without explicit phase transitions.

## Rendering Rules

The conversation component should consume a single projected message list.

It should not know:

- whether a message came from live events
- whether it came from a finalized snapshot
- whether it came from confirmed transcript

Those concerns belong to state orchestration, not presentation.

The component may still style different message types differently, but it should not participate in reconciliation logic.

## Testing Strategy

This architecture should be tested at three levels.

### Reducer / Projection Tests

Given an event sequence, assert the projected message list exactly.

Examples:

- assistant delta -> tool call -> assistant delta
- reasoning delta -> assistant delta -> turn completed
- command execution with output deltas

### Phase Transition Tests

Assert transitions:

- `idle -> live`
- `live -> finalizing`
- `finalizing -> settled`
- `settled -> live`

### UI Integration Tests

End-to-end checks should validate:

- live stream remains visible through finalization
- finalized snapshot persists until settled transcript arrives
- settled transcript replaces snapshot without duplication
- next user turn starts from clean confirmed history

## Implementation Guidance

When changing the existing code:

- prefer introducing explicit state over adding more merge heuristics
- prefer append-only structures over mutable message patching
- prefer replayable projections over ad hoc UI buffers
- prefer phase transitions over boolean flags

If a bug is hard to explain in ledger vocabulary, the design is probably mixing layers again.
