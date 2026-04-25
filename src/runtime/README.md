# runtime

Standalone runtime authority for Nerveflow.

This module contains the process-oriented runtime pieces used by `nerve-runtime` and remote attach surfaces. It is the boundary between:

- one active runtime session
- transport surfaces that attach and detach
- protocol command routing
- shared runtime and host behavior reused from `host_core`

## What lives here

- `runtime_core.js`
  - creates one runtime authority with lifecycle, snapshot, status, and event fan-out
- `command_router.js`
  - validates protocol v1 commands and maps them to runtime actions
- `ws_surface.js`
  - exposes the runtime over WebSocket with attach and detach semantics
- `index.js`
  - public exports for the runtime module

## Design intent

The runtime process owns execution.

Attached surfaces do not own runtime state. They only:

- send commands
- receive responses
- subscribe to events
- detach without stopping the runtime

That keeps control authority singular while still allowing multiple remote clients or observability surfaces.

## Public module surface

```js
import {
  createRuntimeResolvers,
  createRuntimeCore,
  createRuntimeCommandRouter,
  createRuntimeWebSocketSurface,
} from 'nerveflow/runtime'
```

### `createRuntimeResolvers({ repoRoot })`

Builds the filesystem and path resolver bundle used by the runtime.

Responsibilities:

- resolve workspace-relative paths
- load `nextv.json`
- resolve entrypoint files
- normalize workspace display paths
- reject paths outside the repo root

### `createRuntimeCore({ sessionId, callAgent, defaultModel, resolvers })`

Creates a single-session runtime authority.

Main methods:

- `start(payload)`
- `stop()`
- `enqueue(payload)`
- `getSnapshot()`
- `attachSurface(handler)`
- `shutdown()`
- `getStatus()`
- `isActive()`

Status shape:

```js
{
  sessionId,
  state,
  active,
  subscribers,
  workspaceDir,
  entrypointPath,
  lastError,
}
```

Lifecycle states currently include:

- `idle`
- `starting`
- `running`
- `stopping`
- `stopped`
- `error`

### `createRuntimeCommandRouter({ runtimeCore, sessionId, onSubscribe, onUnsubscribe })`

Handles protocol v1 commands and returns protocol-shaped responses.

Supported command types:

- `start`
- `stop`
- `enqueue_event`
- `snapshot`
- `subscribe`
- `unsubscribe`

Errors are normalized to protocol-friendly codes such as:

- `validation_error`
- `not_active`
- `already_active`
- `policy_denied`
- `unavailable`
- `runtime_error`

### `createRuntimeWebSocketSurface({ server, runtimeCore, path, createSessionId })`

Attaches a WebSocket surface to an HTTP server.

Default path:

- `/api/runtime/ws`

Behavior:

- sends a handshake response on connect
- accepts protocol v1 commands over WebSocket
- forwards runtime events as protocol event envelopes
- unsubscribes the socket surface on close
- does not stop the runtime when a socket disconnects

## Runtime process

This module is used by `bin/nerve-runtime.js`.

Example:

```powershell
node bin/nerve-runtime.js start examples/mqtt-simple-host --port 4190
```

Available flags:

- `--entrypoint <path>`
- `--port <n>`
- `--ws-path <path>`

Exposed surfaces:

- `GET /health`
- `ws://<host>:<port><wsPath>`

## Attach client

The companion CLI is `bin/nerve-attach.js`.

Examples:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws snapshot
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue user_message hello
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws stop
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws listen
```

Notes:

- `listen` issues `subscribe` and keeps streaming events
- one-shot commands may print event envelopes before the final response when runtime activity overlaps the command
- disconnecting one attach client does not stop the runtime

## Attach semantics

Attachment is subscription.

- WebSocket connect creates one attached surface
- `subscribe` enables event delivery
- `unsubscribe` disables event delivery for that session
- socket close detaches the surface
- the runtime continues running until explicitly stopped

This matches the broader multi-surface model used elsewhere in the repository.

## Non-goals in this module

This module does not currently implement:

- auth or TLS
- multi-runtime orchestration
- clustering or distributed ownership
- persistence adapters beyond what existing runtime and host pieces already provide

## Related docs

- `docs/04-host-integration.md`
- `README.md`
- `nerve-studio/README.md`
