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

Before publishing to npm, all production readiness gates must **pass**. See [docs/guide/11-production-readiness.md](docs/guide/11-production-readiness.md) for the complete checklist with measurable criteria.

In summary:

1. **Language Stability Gate** — Verify DSL features are documented and stable
2. **Runtime Determinism Gate** — All runtime tests pass; no hidden agent loops
3. **Safety Enforcement Gate** — Policy, auth, and failure-handling tests pass
4. **Packaging Contract Gate** — Export map, dependencies, and CLI boundary are correct
5. **Packed Artifact Smoke Gate** — Tarball installs and boots standalone
6. **CI Gate** — GitHub Actions publish-gate workflow passes on main
7. **Docs and Positioning Gate** — All user-facing docs are accurate and complete

**Quick validation:**
```bash
npm test                       # All tests pass
npm run test:pack-smoke        # Artifact smoke test passes
grep -n "Unreleased" CHANGELOG.md  # CHANGELOG.md updated
```

**Publish sequence:**
```bash
npm version <patch|minor|major>  # Updates version and CHANGELOG
npm publish --dry-run            # Verify contents
npm publish                       # Publish to npm
```

See [docs/guide/11-production-readiness.md](docs/guide/11-production-readiness.md) for the full pre-publish checklist including version bumping and registry verification.
