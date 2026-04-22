# Changelog

All notable changes to this project are documented in this file.

## [0.1.2] - 2026-04-22

### Added

- New `nerve-studio/` repository reference web host with:
	- browser UI under `nerve-studio/public/`
	- HTTP preview server in `nerve-studio/preview-server.js`
	- workspace-local examples and scripts for runtime validation.
- New host protocol v1 utilities under `src/host_core/protocol.js` for transport-agnostic command validation and response/event envelope shaping.
- New host-core modular runtime support under `src/host_core/`:
	- `workspace_config.js` for workspace config discovery/loading and externals declaration
	- `runtime_controller.js` for transport-agnostic runtime session control (`start`, `stop`, `enqueue`, `snapshot`)
	- `runtime_policy.js` for meaningful execution filtering and state-equality policy
	- `runtime_lifecycle.js` for state path resolution, timer lifecycle, and input normalization
	- `runtime_session.js` for host adapter orchestration (`callAgent`, `callTool`, `callScript`, operator resolution)
	- `event_bus.js` for transport-agnostic runtime event fanout/subscription.
- New supported npm host embedding subpath exports: `nerveflow/host_core` and `nerveflow/host_core/protocol`.
- New studio-independent WebSocket host example under `examples/ws-simple-host/` with a single-file HTML+JS UI (`public/index.html`) and standalone server wiring to `host_core`.

### Changed

- `nerve-studio/preview-server.js` now uses host-core modules for runtime orchestration instead of local inline implementations.
- `nerve-studio/preview-server.js` now routes runtime start/stop/event/snapshot orchestration through `src/host_core/runtime_controller.js`.
- WebSocket protocol-envelope command/response/event flow is provided by the dedicated `examples/ws-simple-host/` surface.
- Runtime start semantics now support baseline/runtime state discovery and loading precedence (`state.runtime.json`, `state.json`, `state.init.json`) with explicit path validation.
- Timer behavior now supports host-managed scheduling with `runOnStart`, pulse publication, and no-op suppression policy alignment.
- Runtime event streaming architecture is split between:
	- host-core event bus (fanout/subscribers)
	- web transport SSE projection in studio server.

### Notes

- This release establishes a reusable host substrate for non-web transports (for example, WebSocket, CLI tailing, or embedded callback hosts) without coupling host-core to HTTP/SSE protocol details.
- Scope note: this is a large host extraction slice. The runtime API remains stable, and host embedding now has an explicit public boundary at `nerveflow/host_core`.
- Publish artifact note: the npm package publishes `src/`, `docs/`, and curated `examples/`; `nerve-studio/` remains a repository reference host and is not part of the published package artifact.

## [0.1.1] - 2026-04-21

### Added

- Interactive browser UI for `examples/minimal-web-host` at `public/index.html`.

### Changed

- Minimal web host now serves static assets from an absolute `public/` path.
- Minimal web host now serves `GET /` with `index.html`.
- README getting-started instructions updated to match the host behavior and port `4173`.

## [0.1.0] - 2026-04-21

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
