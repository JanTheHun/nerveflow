# Plugin Contract (Draft)

Plugins add language intelligence without changing editor-core semantics.

## Plugin Input

- document text snapshot
- cursor and selection offsets
- host context object (optional)

## Plugin Output

- token stream for rendering
- diagnostics list
- command registrations
- optional overlays

## Token Shape (minimal)

- line: 1-based line number
- start: 0-based column start
- end: 0-based column end
- type: token class label
- value: optional token text

## Diagnostics Shape (minimal)

- severity: error | warning | info | hint
- message: string
- line: 1-based line number
- column: 1-based column number
- code: optional stable id

## Rules

1. Plugins must not mutate host-managed persistence directly.
2. Plugins should emit deterministic outputs for identical inputs.
3. Plugins should avoid long blocking work in keypress paths.
