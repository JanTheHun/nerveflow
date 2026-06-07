# Architecture Validation 1 — VS Code Runtime Surface (RFC Draft)

**Status:** draft

---

## Goal

Prove that a separate VS Code UI surface can control and inspect a Nerveflow runtime using only the public runtime protocol.

Success means all are true:

- no Studio code imports
- no runtime internals imports
- protocol-level communication only

This validates runtime/surface separation.

---

## Scope (MVP)

- VS Code activity bar entry: `Nerveflow`
- Sidebar with runtime connection UI
- Configurable runtime endpoint (default: `ws://127.0.0.1:4190/api/runtime/ws`)
- Connection status indicator (`Connected` / `Disconnected`)
- Event sender for `user_message`
- Output stream (chronological log)
- Snapshot viewer with manual refresh

---

## Protocol Contract (Minimum)

The VS Code surface may use only the runtime protocol:

- outbound
  - `subscribe`
  - `enqueue_event`
  - `snapshot`
- inbound
  - `nextv_execution`
  - `nextv_runtime_event`
  - `nextv_error`

Envelope details are runtime-protocol-defined. This MVP must not depend on private event internals.

---

## Explicitly Not Included

- workflow graph
- call inspector
- replay tooling
- state editor
- runtime lifecycle management
- Studio component reuse

---

## Failure Signals (Coupling Detectors)

Any of the following is a fail:

- surface requires imports from `nerve-studio` to connect, send, or render protocol events
- surface requires imports from `src/nextv_*` runtime internals
- protocol messages need private helper modules not available through public protocol contracts
- event rendering depends on assumptions not guaranteed by protocol-level envelope shape

---

## Validation Checklists

### Implementation Checklist

- [ ] Activity bar icon registered and opens Nerveflow sidebar
- [ ] Endpoint is user-configurable in extension settings
- [ ] Connect/disconnect action works against live runtime endpoint
- [ ] Event sender emits `enqueue_event` with `user_message` payload
- [ ] Client sends `subscribe` before streaming outputs
- [ ] Stream log appends `nextv_execution`, `nextv_runtime_event`, and `nextv_error`
- [ ] Snapshot button issues `snapshot` and renders raw JSON response
- [ ] No imports from Studio modules
- [ ] No imports from runtime internals

### Architecture Boundary Checklist

- [ ] Dependency scan confirms no references to Studio package paths
- [ ] Dependency scan confirms no references to runtime internal module paths
- [ ] Surface can run after temporarily removing Studio folder from workspace
- [ ] Surface behavior remains functional with protocol-compatible runtime only

### Acceptance Checklist (Pass/Fail)

- [ ] Can connect to runtime endpoint
- [ ] Can enqueue user event
- [ ] Can observe execution/event/error stream
- [ ] Can request and view runtime snapshot
- [ ] All boundary checks pass

---

## Required Evidence Artifacts

- short demo script with exact validation steps
- dependency report showing no disallowed imports
- transcript/log excerpt proving connect/send/stream/snapshot
- architecture note summarizing why this is protocol-only

---

## Test Plan (Minimum)

- positive test: connect to live runtime and complete one user_message roundtrip
- negative test: unreachable endpoint shows disconnected state and non-crashing error path
- protocol resilience test: unknown event fields are ignored or displayed as opaque data
- snapshot test: raw JSON render is stable for nested state values

---

## Exit Criteria

Validation 1 is complete only when all acceptance checklist items and required evidence artifacts are present.
