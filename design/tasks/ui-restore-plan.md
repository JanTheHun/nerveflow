# Nerve Studio UI Restore Plan

Goal: restore intentionally hidden UI controls one-by-one with low regression risk.

## Scope
This plan covers controls hidden during WS remote cleanup and graph/settings simplification.

## Current Hidden Controls

### WS remote / attach-mode specific
- Workspace config row in attach mode:
  - workspace folder input
  - open button
  - entrypoint label/input
  - override attached path
- WS remote action buttons:
  - reload config
  - validate
  - promote
  - snapshot

### Global
- Settings panel rows:
  - editor tab size
  - enable surface switchers
  - show surface telemetry
  - show ingress connectors
- Graph toolbar/legend:
  - auto-follow checkbox
  - show branches toggle
  - boundedness toggle
  - transition legend
  - control legend
- Candidate row label text
- Primary editor tab/view (graph-only primary mode)

## Restore Order (Safest First)

### Phase 1: Low-risk visual restores
1. Candidate label text.
2. Editor tab size row in settings.
3. Surface telemetry row in settings (keep default OFF initially).

Validation:
- Settings panel layout remains stable.
- No overlap/wrapping in top row.

### Phase 2: Non-destructive runtime controls
1. Snapshot button in WS remote mode.
2. Reload config / validate / promote in WS remote mode (enable progressively):
   - expose first as disabled + tooltip where applicable
   - then enable by capability/runtime state

Validation:
- Button enable/disable state matches backend/runtime capability.
- No failed calls due to unsupported remote mode operations.

### Phase 3: Attach-mode config row
1. Restore entrypoint field (read-only when attached runtime owns path).
2. Restore workspace folder + open button (read-only/disabled with clear hint text).
3. Restore override attached path checkbox.

Validation:
- Ownership lock behavior stays correct.
- Attach session identity sync still updates fields.

### Phase 4: Surface controls
1. Keep surface switchers default ON.
2. Restore the settings toggle for surface switchers.
3. Restore ingress connectors toggle only after confirming ingress UX path.

Validation:
- Pane switch controls appear/disappear cleanly.
- Local storage migration still respects ON default when key missing.

### Phase 5: Graph advanced controls
1. Restore auto-follow.
2. Restore legend rows.
3. Restore show branches and boundedness toggles.

Validation:
- Graph toolbar does not overflow at common widths.
- Toggle state persists and maps correctly to graph behavior.

### Phase 6: Primary view architecture
1. Re-enable primary editor tab/view only after verifying no stale state regressions.

Validation:
- View switching keeps graph/editor state intact.
- No broken restore paths from older local storage values.

## Per-Item Restore Checklist
- Unhide control in markup/render path.
- Re-check any mode-gating logic in `03_ui_controls.js`.
- Confirm persisted key semantics (default behavior when key missing).
- Rebuild with `node scripts/build-app-js.js`.
- Smoke-test in:
  - local embedded runtime
  - attach WS runtime

## Rollback Rule
If a restored control causes mode confusion or runtime misuse in WS attach mode, keep it visible but disabled with explicit reason text rather than removing immediately.
