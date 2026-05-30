# Semantic Surface Capability (RFC Draft)

---

# Purpose

Define an attachable capability boundary that realizes semantic interaction intent into interactive surfaces while preserving deterministic orchestration in the runtime.

The runtime remains orchestration authority. The semantic-surface capability owns realization mechanics.

---

# Goals

- Keep runtime control flow deterministic and inspectable.
- Keep workflow intent semantic (not DOM/browser mechanical).
- Support detachable and replaceable realization environments.
- Keep ingress events stable across realization environments.
- Preserve replayability at semantic event boundaries.

---

# Non-Goals (MVP)

- No core grammar mutation.
- No raw DOM event ingress into runtime.
- No renderer implementation lock-in (Chromium/Electron/WebView are realizations, not contract).
- No implicit orchestration state hidden inside renderer mechanics.

---

# Authority Boundary

Runtime owns:

- orchestration
- workflow state
- semantic output intent
- deterministic control flow

Semantic-surface capability owns:

- rendering/layout strategy
- realization lifecycle (window/tab/overlay/session)
- local ephemeral interaction mechanics
- reduction of mechanics into semantic ingress events

Contract rule:

- runtime receives semantic outcomes only
- runtime never receives raw UI mechanics

---

# Contract Model

This capability uses existing host module roles:

- effect realizers for semantic output realization
- ingress connectors for semantic interaction ingress

MVP uses a versioned envelope for both directions.

## Effect Envelope (runtime -> capability)

Required fields:

- `schemaVersion` (string)
- `capability` (string, `semantic-surface`)
- `effectName` (string)
- `interactionId` (string)
- `target` (string)
- `intent` (object)
- `timestamp` (string, ISO-8601)
- `runtimeEventId` (string)

Example:

```json
{
  "schemaVersion": "1.0",
  "capability": "semantic-surface",
  "effectName": "semantic_surface",
  "interactionId": "confirm_delete_1",
  "target": "main",
  "intent": {
    "type": "choice",
    "text": "Delete reminders?",
    "options": [
      { "id": "yes", "label": "Yes" },
      { "id": "no", "label": "No" }
    ]
  },
  "timestamp": "2026-05-29T12:00:00Z",
  "runtimeEventId": "evt_123"
}
```

## Ingress Envelope (capability -> runtime)

Required fields:

- `schemaVersion` (string)
- `eventType` (string, `semantic_surface_event`)
- `interactionId` (string)
- `target` (string)
- `action` (string)
- `value` (object or scalar)
- `timestamp` (string, ISO-8601)
- `sourceSessionId` (string)

Example:

```json
{
  "schemaVersion": "1.0",
  "eventType": "semantic_surface_event",
  "interactionId": "confirm_delete_1",
  "target": "main",
  "action": "selected",
  "value": { "selected": "yes" },
  "timestamp": "2026-05-29T12:00:02Z",
  "sourceSessionId": "surface_main_1"
}
```

---

# Interaction Lifecycle

Normative states:

- `requested`
- `presented`
- `updated`
- `resolved`
- `cancelled`
- `timed_out`
- `failed`

Normative constraints:

- `interactionId` uniquely scopes state transitions for a target surface.
- terminal states are `resolved`, `cancelled`, `timed_out`, `failed`.
- duplicate ingress events for the same terminal transition must be ignored.
- realization retries must be idempotent by `interactionId`.

---

# Determinism and Replay

Replay boundary:

- replay semantic ingress/effect envelopes
- do not replay renderer-internal mechanical events

Recovery boundary:

- on capability reconnect, pending interactions may be re-presented using the same `interactionId`
- re-presentation must not change runtime control flow unless a new semantic ingress event is dispatched

---

# Failure Model

Capability failures must remain isolated from runtime orchestration.

- effect realization errors should emit warning events with structured codes
- ingress validation failures should be rejected with explicit validation errors
- one surface session failure should not crash other surface sessions

---

# Implementation Plan (MVP)

Phase 1 (this spec):

- establish contract and lifecycle semantics

Phase 2:

- add semantic-surface capability wiring through effect realizer + ingress connector roles
- add schema validation and correlation handling

Phase 3:

- add dual realization tracks (studio-attached and standalone)
- add conformance tests for equivalent semantic behavior

Phase 4:

- add compose scaffolding (`add semantic-surface`) and idempotency tests

---

# Testing Requirements

- contract shape validation tests for effect and ingress envelopes
- lifecycle transition tests including duplicate suppression
- reconnect/replay tests for pending interactions
- error isolation tests across multiple surface sessions
- deterministic workflow behavior tests under repeated interaction runs

---

# Open Questions

- Should `semantic-ui` remain as compatibility alias for naming migration?
- Should helper intrinsics (for example `ui_choice`) remain postponed until post-MVP stability?
- Should target surface identifiers be fixed enum values or workspace-configurable labels?

---

# References

- [../../docs/guide/05-platform-vision.md](../../docs/guide/05-platform-vision.md)
- [../../docs/guide/04-host-integration.md](../../docs/guide/04-host-integration.md)
- [spec-parallel-group-evaluation.md](spec-parallel-group-evaluation.md)
- [spec-structured-return-contracts.md](spec-structured-return-contracts.md)