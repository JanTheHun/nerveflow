# Contributing

## Development

1. Install dependencies (if added in future versions).
2. Run tests:

```bash
npm test
```

3. Keep docs aligned with implementation behavior.

## Multi-Surface Attachment Pattern

Nerveflow supports a single runtime session with multiple dynamically attached surfaces for control, observability, and effect realization.

When adding a new host or surface:

- **One runtime, many surfaces** — Create a single `createNextVRuntimeController()` per session; multiple transports subscribe to its event bus
- **Surfaces attach via subscribe** — Use `eventBus.subscribe(handler)` to attach; handler failure is isolated automatically
- **Surfaces detach without stopping runtime** — Use `eventBus.unsubscribe(handler)` on disconnect; runtime continues unaffected
- **Surface roles are optional** — A surface can be control-only, observability-only, effect-only, or combined

Reference implementation: `examples/mqtt-simple-host/create-mqtt-host.js`

See `docs/examples/multi-surface-attachment-pattern.md` for architecture patterns and examples.

## Scope Guidelines

- Runtime core changes must preserve deterministic control flow semantics.
- Host behavior remains adapter-owned; avoid embedding host-specific assumptions in core runtime.
- Keep language-surface changes explicit and documented.
- Multi-surface hosts should not duplicate state across surfaces; single runtime is authoritative.

## Release Checklist

- Update `CHANGELOG.md`.
- Bump version in `package.json`.
- Run `npm test`.
- Verify package contents with `npm pack --dry-run`.
