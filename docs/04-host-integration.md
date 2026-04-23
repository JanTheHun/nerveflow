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
- canonical event names: `nextv_started`, `nextv_stopped`, `nextv_warning`, `nextv_runtime_event`, `nextv_execution`, `nextv_error`, `nextv_timer_pulse`, `nextv_event_queued`
- canonical error codes: `policy_denied`, `unavailable`, `validation_error`, `runtime_error`, `not_active`, `already_active`

Use these helpers to validate inbound commands and shape outbound response/event envelopes consistently across HTTP, SSE, WebSocket, and in-process SDK surfaces.

## Surface flags in nerve-studio

The reference preview host supports transport surface toggles and optional remote observability mode.

Surface toggles:

- `NERVE_STUDIO_SURFACES` comma-separated list (for example: `http,sse`)

Remote observability mode (MQTT-backed):

- `--remote` enables remote mode for this launch
- `--remote-mqtt <url>` sets broker URL explicitly (for example: `mqtt://localhost:1883`)
- `--remote-mqtt-topic-prefix <prefix>` sets event topic prefix (default: `nextv/event`)
- `NERVE_STUDIO_REMOTE_MQTT` is used as fallback broker URL when `--remote` is set without `--remote-mqtt`

Behavior notes:

- running without `--remote` starts in local mode even if `NERVE_STUDIO_REMOTE_MQTT` is set
- if remote mode is requested and no broker URL is resolved, startup fails fast
- in remote mode, runtime mutation endpoints (`start`, `stop`, `enqueue_event`) return 405 and UI controls are disabled

Examples:

```powershell
# local mode
node nerve-studio/preview-server.js

# remote mode with explicit broker URL
node nerve-studio/preview-server.js --remote --remote-mqtt mqtt://localhost:1883

# remote mode with env fallback
$env:NERVE_STUDIO_REMOTE_MQTT = 'mqtt://localhost:1883'
node nerve-studio/preview-server.js --remote
```

The studio preview host supports HTTP and SSE surfaces. WebSocket transport is provided by the dedicated `ws-simple-host` example.

Example command payload (for WebSocket hosts):

```json
{
  "type": "snapshot",
  "requestId": "req-1"
}
```

Supported WebSocket command types map directly to protocol v1 commands:

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

## Output event contract (additive)

Runtime output events continue to emit `type: "output"` with legacy fields (`format`, `content`) and now include additive channel metadata:

- `channel` output channel name used by script (`output <channel> ...`)
- `payload` raw expression value before formatting
- `effectChannelId` optional declared effect id when channel is declared in `nextv.json#effects`

Compatibility notes:

- hosts that only read `format` and `content` continue working unchanged
- hosts can gradually adopt `channel` and `effectChannelId` for routing/binding

Example output event payload:

```json
{
  "type": "output",
  "channel": "heartbeat",
  "format": "text",
  "content": "tick",
  "payload": "tick",
  "effectChannelId": "heartbeat"
}
```

## Declared effect startup policy

Hosts validate declared effect bindings during startup when channels include a `kind` value.

`effectsPolicy` is validated while loading workspace config; unsupported values fail fast before runtime startup.

- `nextv.json#effectsPolicy: "warn"` (default) publishes a `nextv_warning` event and continues startup.
- `nextv.json#effectsPolicy: "strict"` rejects startup when unsupported bindings are detected.

Example:

```json
{
  "effectsPolicy": "strict",
  "effects": {
    "heartbeat": { "kind": "mqtt", "topic": "pulse", "format": "text" }
  }
}
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

## Multi-Surface Attachment

Nerveflow enables multiple transport surfaces to attach dynamically to a single runtime session.

### Attachment Model

- **Startup**: One transport creates the runtime by calling `createNextVRuntimeController({ eventBus, /* ...resolvers */ })`
- **Late attach**: Other transports can attach by subscribing to the same event bus
- **Detach**: Surfaces unsubscribe and disconnect; runtime continues unaffected
- **Isolation**: A surface failure (handler throw, connection drop) does not affect other surfaces

### Surface Roles

- **Control surface** — Issues protocol commands; only the runtime controller modifies state
- **Observability surface** — Subscribes to event streams; read-only, never mutates state
- **Effect surface** — Observes `nextv_execution` events and realizes declared effects (MQTT publish, GPIO write, etc.)

### Example: MQTT Command + Web Observability

```js
import { createEventBus, createNextVRuntimeController } from 'nerveflow/host_core'

const eventBus = createEventBus()
const controller = createNextVRuntimeController({ eventBus, /* ...resolvers */ })

// MQTT client (control surface): sends commands to controller
mqttClient.subscribe('nerve/command', async (msg) => {
  const command = validateHostProtocolCommand(JSON.parse(msg))
  if (command.type === 'start') await controller.start(command.payload)
  if (command.type === 'enqueue_event') controller.enqueue(command.payload)
})

// Web UI (observability surface): watches runtime events
wsServer.on('connection', (wsClient) => {
  const handler = (eventName, payload) => {
    wsClient.send(JSON.stringify({ eventName, payload }))
  }
  eventBus.subscribe(handler)
  
  // Clean up on disconnect (detach)
  wsClient.on('close', () => eventBus.unsubscribe(handler))
})
```

When the web UI closes, the runtime continues executing and the MQTT surface remains active. This is the canonical multi-surface pattern.

### Subscribe/Unsubscribe as Attachment Semantics

- `subscribe(handler)` = surface attaches
- `unsubscribe(handler)` = surface detaches
- Event bus handler errors are caught and isolated; failing handler is removed automatically

See `src/host_core/README.md` for "Multi-Surface Attachment Model" design principles.

## Reference implementation

See `examples/minimal-web-host/server.js`.

For a studio-independent WebSocket host example with a single-file browser UI, see `examples/ws-simple-host/server.js` and `examples/ws-simple-host/public/index.html`.

For a multi-surface headless MQTT host example demonstrating control + observability + effect surfaces, see `examples/mqtt-simple-host/mqtt-host.js`.

Host-side shared modules are documented in `src/host_core/README.md`.

## Embedded MQTT host

`examples/mqtt-simple-host/mqtt-host.js` is a minimal headless host that connects to an MQTT broker, listens for protocol commands, and publishes runtime lifecycle and execution events back to the broker. It has no HTTP server or UI — its purpose is outer-world manipulation from a running nerve project.

The same host automatically loads workspace-declared effects from `nextv.json#effects` and forwards additive output channel metadata in `nextv_execution` event payloads.

### Topic contract

| Direction | Topic | Content |
|-----------|-------|---------|
| inbound | `nextv/command` | host protocol v1 command envelope (JSON) |
| outbound | `nextv/event/{eventName}` | host protocol v1 event envelope (JSON) |
| outbound | `nextv/response/{requestId}` | host protocol v1 response envelope (JSON) |
| outbound | `nextv/response` | response when command carried no `requestId` |

All outbound publishes use QoS 0, retain false.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker connection URL |
| `MQTT_COMMAND_TOPIC` | `nextv/command` | Topic the host subscribes to for commands |
| `MQTT_EVENT_TOPIC_PREFIX` | `nextv/event` | Prefix for outbound event topics |
| `MQTT_RESPONSE_TOPIC_PREFIX` | `nextv/response` | Prefix for outbound response topics |
| `MQTT_INCLUDE_EVENTS` | _(empty = all)_ | Comma-separated canonical event names to publish; unmatched types are suppressed |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Base URL used for `agent()` model calls |
| `OLLAMA_MODEL` | _(empty)_ | Default fallback model when an agent profile omits `model` |

### Event filtering

Two filtering layers apply before an event is published:

1. **Type filter** — set `MQTT_INCLUDE_EVENTS` to a comma-separated list of canonical event names (`nextv_execution`, `nextv_error`, etc.). Events not in the list are suppressed. Empty means publish all.
2. **Custom predicate** — for programmatic embedding, pass `eventPredicate` to `createMqttHost` as `(eventName, payload) => boolean`. Returning `false` suppresses the event.

```js
import { createMqttHost } from './examples/mqtt-simple-host/create-mqtt-host.js'

const host = createMqttHost(mqttClient, resolvers, {
  // Only publish events where work happened.
  eventPredicate: (eventName, payload) => {
    if (eventName === 'nextv_execution') {
      return Number(payload?.result?.steps ?? 0) > 0
    }
    return true
  },
})
```

### Agent transport behavior

The MQTT host uses `host_core` for agent profile resolution and message construction, then calls Ollama as the concrete transport.

- If `agents.json` defines a model for the agent profile, that model is used.
- Otherwise `OLLAMA_MODEL` is used as fallback.
- If no model is resolved, the runtime emits an error for `agent()` calls.

### Starting a workflow headlessly

Publish a `start` command to `nextv/command` with the workspace directory:

```json
{
  "type": "start",
  "requestId": "init-1",
  "payload": { "workspaceDir": "examples/mqtt-simple-host" }
}
```

The host responds on `nextv/response/init-1` and emits `nextv_started` on `nextv/event/nextv_started`. From that point, publish `enqueue_event` commands to drive the workflow and subscribe to `nextv/event/#` to observe effects.

### Chatbot walkthrough over MQTT

To run the chatbot workspace at `nerve-studio/workspaces-local/chatbot`, start three things first:

1. An MQTT broker
2. The MQTT host (`examples/mqtt-simple-host/mqtt-host.js`)
3. Ollama with the chatbot model available

Example host startup:

```powershell
$env:MQTT_BROKER_URL="mqtt://localhost:1883"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
node examples/mqtt-simple-host/mqtt-host.js
```

Subscribe to responses and events:

```powershell
mosquitto_sub -h localhost -p 1883 -t "nextv/response/#" -v
```

```powershell
mosquitto_sub -h localhost -p 1883 -t "nextv/event/#" -v
```

Start the chatbot runtime:

```json
{
  "type": "start",
  "requestId": "start-chatbot-1",
  "payload": {
    "workspaceDir": "nerve-studio/workspaces-local/chatbot"
  }
}
```

Send that JSON to `nextv/command`. The host should reply on `nextv/response/start-chatbot-1` and emit `nextv_started`.

To send a user message, publish an `enqueue_event` command. For protocol v1, the external event name goes in `payload.eventType`.

```json
{
  "type": "enqueue_event",
  "requestId": "chat-1",
  "payload": {
    "eventType": "user_message",
    "value": "Hello there"
  }
}
```

The chatbot workspace maps `user_message` into its chat flow, calls `agent("chat")`, and emits output through normal runtime events. Reset chat history with:

```json
{
  "type": "enqueue_event",
  "requestId": "reset-1",
  "payload": {
    "eventType": "reset_chat",
    "value": "reset"
  }
}
```

Stop the runtime with:

```json
{
  "type": "stop",
  "requestId": "stop-1"
}
```

If the agent profile does not define a model and `OLLAMA_MODEL` is unset, or if Ollama is unreachable, the runtime emits `nextv_error` for the failed agent call.
