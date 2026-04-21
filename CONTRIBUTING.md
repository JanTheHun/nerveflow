# Contributing

## Development

1. Install dependencies (if added in future versions).
2. Run tests:

```bash
npm test
```

3. Keep docs aligned with implementation behavior.

## Scope Guidelines

- Runtime core changes must preserve deterministic control flow semantics.
- Host behavior remains adapter-owned; avoid embedding host-specific assumptions in core runtime.
- Keep language-surface changes explicit and documented.

## Release Checklist

- Update `CHANGELOG.md`.
- Bump version in `package.json`.
- Run `npm test`.
- Verify package contents with `npm pack --dry-run`.
