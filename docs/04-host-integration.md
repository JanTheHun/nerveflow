# Host Integration Guide

Nerveflow is host-agnostic. A host integrates runtime execution with real tools, model calls, and external events.

## Public host_core API

The host substrate is available as a supported npm subpath export:

```js
import {
  createHostAdapter,
  createEventBus,
  loadWorkspaceNextVConfig,
} from 'nerveflow/host_core'

import {
  HOST_COMMAND_TYPES,
  HOST_EVENT_NAMES,
  HOST_ERROR_CODES,
  buildHostProtocolEvent,
  buildHostProtocolResponse,
  validateHostProtocolCommand,
} from 'nerveflow/host_core/protocol'
```

This is the recommended embedding boundary for host-side orchestration.

## Host protocol utilities (v1)

`nerveflow/host_core/protocol` provides a transport-agnostic envelope contract for multi-surface hosts.

- command types: `start`, `stop`, `enqueue_event`, `snapshot`, `subscribe`, `unsubscribe`
- canonical event names: `nextv_started`, `nextv_stopped`, `nextv_runtime_event`, `nextv_execution`, `nextv_error`, `nextv_timer_pulse`, `nextv_event_queued`
- canonical error codes: `policy_denied`, `unavailable`, `validation_error`, `runtime_error`, `not_active`, `already_active`

Use these helpers to validate inbound commands and shape outbound response/event envelopes consistently across HTTP, SSE, WebSocket, and in-process SDK surfaces.

## Surface flags in nerve-studio

The reference preview host supports transport surface toggles via environment variables:

- `NERVE_STUDIO_SURFACES` comma-separated list (for example: `http,sse`)

The studio preview host supports HTTP and SSE surfaces. WebSocket transport is provided by the dedicated `ws-simple-host` example.

Example command payload (for websocket hosts):

```json
{
  "type": "snapshot",
  "requestId": "req-1"
}
```

Supported websocket command types map directly to protocol v1 commands:

- `start`
- `stop`
- `enqueue_event`
- `snapshot`
- `subscribe`
- `unsubscribe`

## Minimal integration shape

```js
import { runNextVScript } from 'nerveflow'

const result = await runNextVScript(source, {
  state,
  event,
  hostAdapter: {
    async callTool({ name, args, positional, state, event, locals, line, statement }) {
      // Your tool runtime
    },
    async callAgent({ agent, prompt, instructions, messages, format, state, event, locals, line, statement }) {
      // Your model runtime
    },
    async callScript({ path, state, event, locals, executionRole, onEvent }) {
      // Nested script execution
    },
    resolveOperatorPath(operatorId) {
      // Optional operator path resolution
    },
    onEvent(eventRecord) {
      // Optional event stream hook
    },
  },
})
```

## Recommended host responsibilities

- Validate and sanitize external input events
- Implement deterministic tool permission boundaries
- Store and restore `state` if workflows are long-lived
- Capture runtime event logs for debugging
- Enforce timeout/step limits around script execution

## Tool policy scaffolding

Workspace tool policy is loaded from host config and applied before any tool execution.

- Aliases resolve before allow-list checks (`tools.aliases` -> canonical tool name)
- If allow-list is configured and canonical tool is missing, host should throw a policy-denied error
- If tool passes policy but host has no concrete implementation, host should throw an unavailable error

## Reference implementation

See `examples/minimal-web-host/server.js`.

For a studio-independent websocket host example with a single-file browser UI, see `examples/ws-simple-host/server.js` and `examples/ws-simple-host/public/index.html`.

Host-side shared modules are documented in `src/host_core/README.md`.
