# Architecture Validation 2 — VS Code JSON Surface Reuse (RFC Draft)

**Status:** draft

---

## Goal

Prove that the JSON editor surface is reusable outside Studio.

Success means all are true:

- same conceptual editor surface can run in VS Code
- no dependency on runtime
- no dependency on Studio-only internals

This validates UI surface modularity.

---

## Scope (MVP)

- custom JSON preview for a constrained file set first:
  - `state.init.json`
  - `*.contract.json`
- toggle modes:
  - open as text
  - open as Nerveflow editor
- basic property editor for scalar/object fields
- basic array editor (add/update/remove items)
- save writes directly back to the source JSON file

---

## Explicitly Not Included

- schema validation
- runtime connection or runtime APIs
- contract semantics awareness
- agent/workflow awareness
- Studio runtime plumbing

JSON is treated as generic JSON in this MVP.

---

## Failure Signals (Coupling Detectors)

Any of the following is a fail:

- editor cannot render without Studio-only shared state/service modules
- editor requires runtime APIs or runtime websocket state for local editing
- editor save path depends on Studio-specific persistence adapters
- extraction into package form requires host-specific code changes

---

## Validation Checklists

### Implementation Checklist

- [ ] Custom editor contribution registered for constrained JSON files
- [ ] Toggle between text editor and custom JSON surface works
- [ ] Scalar fields are editable and type-preserving on save
- [ ] Boolean fields are editable and type-preserving on save
- [ ] Array items can be added, edited, and removed
- [ ] Save writes valid JSON back to the same file
- [ ] No runtime imports in JSON surface package
- [ ] No Studio-only imports in JSON surface package

### Packaging Checklist

- [ ] Surface extracted to `packages/json-surface`
- [ ] Package exposes a minimal host-agnostic API
- [ ] Package builds without Studio app dependency
- [ ] Package can be consumed by two hosts (Studio and VS Code) unchanged

### Acceptance Checklist (Pass/Fail)

- [ ] JSON surface works in VS Code on constrained file set
- [ ] JSON surface can be consumed by Studio unchanged
- [ ] No runtime coupling detected
- [ ] No Studio-only coupling detected
- [ ] All packaging checklist items pass

---

## Required Evidence Artifacts

- package layout under `packages/json-surface`
- minimal host integration examples for Studio and VS Code
- dependency report proving no runtime and no Studio-only imports
- demo sequence showing edit -> save -> file diff

---

## Test Plan (Minimum)

- scalar edit roundtrip test (`number`, `string`, `boolean`)
- array edit roundtrip test (insert/remove/reorder if supported)
- invalid edit guard test (must not corrupt output JSON)
- dual-host smoke test confirming package reuse without modification

---

## Exit Criteria

Validation 2 is complete only when all acceptance checklist items and required evidence artifacts are present.
