# Boundary Policy (AV1)

This extension validates runtime and surface separation for Architecture Validation 1.

## Allowed

- Protocol-level WebSocket communication with runtime endpoint
- Commands: `subscribe`, `enqueue_event`, `snapshot`
- Events: `nextv_execution`, `nextv_runtime_event`, `nextv_error`

## Disallowed

- Any imports from `nerve-studio`
- Any imports from runtime internals such as `src/nextv_*`
- Any private helper modules outside protocol-level contracts

## Verification

Run:

```bash
npm run check:boundaries
```

The command must report no disallowed imports.
