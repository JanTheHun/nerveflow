# Changelog

All notable changes to this project are documented in this file.

## [1.0.0] - 2026-04-21

### Added

- Initial `nerveflow` runtime package extraction.
- Public runtime boundary exports in `src/index.js`.
- Parser, compiler, runtime executor, event runner, and event graph modules.
- Runtime-local tool metadata helper for event graph classification.
- Ported runtime test suite for extracted package.
- Minimal web host reference example under `examples/minimal-web-host`.
- User-focused docs set under `docs/`.

### Notes

- `.nrv` is preferred for new scripts; `.wfs` remains compatible.
- `interaction` output format is supported for compatibility; prefer `output json` for new workflows.
