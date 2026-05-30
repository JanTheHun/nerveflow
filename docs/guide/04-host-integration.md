# Host Integration Guide

Nerveflow is host-agnostic. A host integrates runtime execution with real tools, model calls, and external events.

## Public host_core API

The host substrate is available as a supported npm subpath export:

```js
import {
  createHostAdapter,
  createEventBus,
  createToolRuntime,
  createIngressConnectorRuntime,
  createEffectRealizerRuntime,
  getRequiredCapabilities,
  getConfiguredModules,
  loadWorkspaceNextVConfig,
  validateRequiredCapabilityBindings,
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

## Runtime authority API (subpath-first)

Use the runtime subpath for standalone runtime authority and remote attach surfaces:

```js
import {
  createRuntimeResolvers,
  createRuntimeCore,
  createRuntimeCommandRouter,
  createRuntimeWebSocketSurface,
} from 'nerveflow/runtime'
```

Compatibility note:

- top-level runtime helper imports from `nerveflow` still work during the compatibility window
- new integrations should import runtime authority APIs from `nerveflow/runtime`

Naming transition note:

- `nerve` and `Nerveflow` are the canonical public names going forward
- some APIs, config filenames, and protocol identifiers still use legacy `nextv` naming during the compatibility transition
- for new integrations, prefer `nerve`/`Nerveflow` terminology and surfaces
- legacy `nextv` names remain supported during this transition window; future cleanup will be announced with explicit migration guidance before removals

Migration example:

```js
// Before (compatibility window)
import {
  createRuntimeResolvers,
  createRuntimeCore,
  createRuntimeCommandRouter,
  createRuntimeWebSocketSurface,
} from 'nerveflow'

// After (recommended)
import {
  createRuntimeResolvers,
  createRuntimeCore,
  createRuntimeCommandRouter,
  createRuntimeWebSocketSurface,
} from 'nerveflow/runtime'
```

Compatibility timeline:

| Phase | `nerveflow` top-level runtime imports | `nerveflow/runtime` |
| --- | --- | --- |
| Current | Supported (compatibility) | Canonical for new integrations |
| Next major | Removed | Supported |
| Later extraction (optional) | N/A | May remain bridge path if `@nerveflow/runtime` is introduced |

## Host-Modules Layer (Capability Composition)

The `host-modules` layer provides tool capability composition separate from the runtime authority, keeping host-core substrate-clean while enabling domain-specific tool providers.

For a package-first PostgreSQL + pgvector flow, see [10-host-db-connectors.md](10-host-db-connectors.md).
For manual host-modules wiring and provider internals, see [10-host-db-connectors-low-level.md](10-host-db-connectors-low-level.md).

`nerveflow/host-modules` is a supported npm subpath export.

```js
import {
  loadHostModules,
  loadHostModulesByRole,
  createRuntimeBuiltinToolProvider,
} from 'nerveflow/host-modules'

import {
  createToolRuntime,
} from 'nerveflow/host_core'

// Discover and compose providers (builtin + workspace custom)
const providers = await loadHostModules({ workspaceDir })
const toolRuntime = createToolRuntime({ providers })

// Role-aware composition (additive)
const roles = await loadHostModulesByRole({ workspaceDir })
const ingressRuntime = createIngressConnectorRuntime({ connectors: roles.ingressConnectors })
const effectRuntime = createEffectRealizerRuntime({ realizers: roles.effectRealizers })

// Pass to runtime
const runtime = createRuntimeCore({
  resolvers,
  callAgent,
  toolRuntime,
  // ...
})
```

### Builtin Providers

Three tools are provided by default:

- `get_time` — returns current UTC timestamp
- `http_fetch` — HTTP request with JSON parsing
- `rss_fetch` — Fetch and parse RSS/Atom feeds

See [host-modules README](../../src/host_modules/README.md) for provider semantics, workspace discovery, and custom provider registration.

### Provider Ordering

Providers are composed in order:

1. Builtin providers (always first)
2. Public shared providers
3. Workspace providers (via `host_modules` directory discovery)

First provider with a handler for a given tool name wins. This allows workspace providers to override or extend builtin capabilities.

### Role-aware Host Modules (additive)

`loadHostModulesByRole()` returns separate role buckets:

- `toolProviders`: workflow-callable tools
- `ingressConnectors`: event ingress connectors for host surfaces
- `effectRealizers`: output/effect channel realizers

### Semantic Surface Capability Boundary (RFC-aligned)

A semantic-surface capability should use role-aware host modules without changing runtime orchestration semantics:

- runtime emits semantic interaction intent through effect channels
- capability realizes intent into local UI mechanics (browser/window/tab/dialog/etc.)
- capability reduces mechanics into semantic ingress events and dispatches them back

Boundary rule:

- runtime should receive semantic outcomes only (for example `confirm_yes`, `item_selected`)
- runtime should not receive raw mechanical events (for example click/mousemove/dom mutation)

This keeps deterministic control flow in runtime core while allowing detachable or replaceable surface realizations.

See [../../design/specs/spec-semantic-surface-capability.md](../../design/specs/spec-semantic-surface-capability.md) for the RFC draft contract and lifecycle model.

Minimal MVP authoring pattern:

```nrv
on external "user_message"
  output semantic_surface {
    schemaVersion: "1.0",
    capability: "semantic-surface",
    effectName: "semantic_surface",
    interactionId: "confirm_delete_1",
    target: "main",
    intent: {
      type: "choice",
      text: "Delete reminders?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" }
      ]
    },
    timestamp: "2026-05-29T12:00:00Z",
    runtimeEventId: "demo_confirm_delete_1"
  }
end

on external "semantic_surface_event"
  output text event.value.payload.selected
end
```

Runnable example workspace:

- [../../examples/semantic-surface-choice-demo/README.md](../../examples/semantic-surface-choice-demo/README.md)

Compatibility note:

- `loadHostModules()` remains tool-only and is preserved for existing hosts
- role-aware APIs are additive and can be adopted incrementally

### Compose CLI (workspace capability scaffolding)

`nerve-compose` provides additive workspace composition helpers. It does not install infrastructure and does not mutate runtime semantics.

Current commands:

- `node bin/nerve-compose.js init [workspaceDir] [--json]`
- `node bin/nerve-compose.js modules [workspaceDir] [--json] [--builtin-only]`
- `node bin/nerve-compose.js doctor [workspaceDir] [--json] [--strict]`
- `node bin/nerve-compose.js add transport <name> [workspaceDir] [--json]`
- `node bin/nerve-compose.js add model <name> --transport <transportName> [workspaceDir] [--json]`
- `node bin/nerve-compose.js add memory-pgvector [workspaceDir] [--json]`
- `node bin/nerve-compose.js add speech [workspaceDir] [--json]`
- `node bin/nerve-compose.js add docs <minimal|ai> [workspaceDir] [--json]`

`init` scaffolds a minimal workspace baseline for new projects:

- creates `nerve.json` (with `entrypointPath` and `externals`) when no root config exists
- creates the configured workflow entrypoint file when it does not already exist
- defaults to the current directory when `workspaceDir` is omitted
- does not overwrite existing `nerve.json` or existing workflow files
- does not auto-migrate `nextv.json` to `nerve.json`; legacy config remains supported for compatibility

`add memory-pgvector` scaffolds workspace wiring using the existing host-modules loading path:

- creates or updates `host_modules/index.js` (generated provider wiring)
- creates or updates `.env.example` with `MEMORY_*` placeholders
- updates `nerve.json` `requires.memory` and `modules.memory` when present (falls back to `nextv.json` for compatibility)

`add speech` scaffolds a reference speech ingress surface from the voice-spa template:

- creates or updates `.env.example` with `VOICE_*`, `WHISPER_*`, `PIPER_*`, and runtime endpoint placeholders
- updates `nerve.json` `requires.speech` and `modules.speech` when present (falls back to `nextv.json` for compatibility)
- creates `voice-spa/` with UI/server files (`server.js`, `public/*`, local `.env.example`) and a module-local `package.json` (`type: module`)
- creates shared speech process helpers in `capabilities/speech/server_lib.mjs` consumed by `voice-spa/server.js`

Speech environment settings are local to `voice-spa/.env.example` and `voice-spa/.env`; `add speech` does not modify root workspace `.env` or `.env.example`.

`add transport <name>` registers a transport entry in workspace config, appends transport-specific `.env.example` placeholders, and safely upserts missing transport keys in `.env` (without overwriting existing values).

`add model <name> --transport <transportName>` registers a model entry and links it to an existing transport. The command fails when the referenced transport is missing so model-to-transport links stay valid.

`add docs <minimal|ai>` copies documentation profiles into repo-style paths in the target workspace:

- `minimal` copies `docs/guide` to `docs/guide`
- `ai` copies `NERVEFLOW_AGENT_RULES.md` to the workspace root and `docs/project-generation` to `docs/project-generation`
- in interactive terminals, `add docs ai` also prompts for permission to scaffold managed instruction blocks in `.github/copilot-instructions.md`, `CLAUDE.md`, and `AGENTS.md`
- in interactive terminals, `add docs ai` prompts for permission to include ecosystem feedback suggestions in generated AI docs
- `add docs ai --with-agent-instructions` scaffolds instruction files without prompting
- `add docs ai --no-prompts` disables prompting, skips ecosystem feedback suggestion injection, and skips instruction scaffolding
- `add docs ai --instructions-only --with-agent-instructions` scaffolds instruction files without copying docs
- defaults to the current directory when `workspaceDir` is omitted
- non-destructive by default: existing files with different content are reported as manual-merge skips

Behavior and boundaries:

- compose commands are workspace-local and deterministic
- runtime behavior remains unchanged; startup still loads builtin/public/workspace providers through existing loader order
- external prerequisites remain explicit (PostgreSQL + pgvector and embedding service are not provisioned by compose)
- external speech prerequisites remain explicit (Whisper/Piper binaries/models and runtime endpoint availability are not provisioned by compose)
- if `host_modules/index.js` already exists and is not compose-generated, `add` reports a manual-merge skip instead of rewriting user code

## Host protocol utilities (v1)

`nerveflow/host_core/protocol` provides a transport-agnostic envelope contract for multi-surface hosts.

- command types: `start`, `stop`, `enqueue_event`, `dispatch_ingress`, `call_inspector_execute`, `submit_candidate`, `promote_candidate`, `snapshot`, `definition_status`, `subscribe`, `unsubscribe`
- canonical event names: `nextv_started`, `nextv_stopped`, `nextv_warning`, `nextv_runtime_event`, `nextv_execution`, `nextv_error`, `nextv_timer_pulse`, `nextv_event_queued`, `nextv_ingress_dispatched`, `nextv_effect_realized`, `nextv_candidate_validation_started`, `nextv_candidate_validation_failed`, `nextv_candidate_promotable`, `nextv_candidate_promoted`
- canonical error codes: `policy_denied`, `unavailable`, `validation_error`, `runtime_error`, `not_active`, `already_active`

Use these helpers to validate inbound commands and shape outbound response/event envelopes consistently across HTTP, SSE, WebSocket, and in-process SDK surfaces.

## Surface flags in nerve-studio

The reference preview host supports transport surface toggles and optional remote modes.

Surface toggles:

- `NERVE_STUDIO_SURFACES` comma-separated list (for example: `http,sse`)

Remote MQTT observability mode:

- `--remote` enables remote mode for this launch
- `--remote-mqtt <url>` sets broker URL explicitly (for example: `mqtt://localhost:1883`)
- `--remote-mqtt-topic-prefix <prefix>` sets event topic prefix (default: `nextv/event`)
- `NERVE_STUDIO_REMOTE_MQTT` is used as fallback broker URL when `--remote` is set without `--remote-mqtt`

Remote WS full-control mode:

- `--remote-ws <url>` attaches studio to a standalone runtime WS endpoint (for example: `ws://127.0.0.1:4190/api/runtime/ws`)
- `NERVE_STUDIO_REMOTE_WS` is used as fallback WS URL when remote mode is requested without `--remote-ws`

Behavior notes:

- running without `--remote` starts in local mode even if `NERVE_STUDIO_REMOTE_MQTT` is set
- if remote mode is requested and no MQTT or WS URL is resolved, startup fails fast
- `--remote-mqtt` and `--remote-ws` are mutually exclusive
- MQTT remote mode is observability-only: runtime mutation endpoints (`start`, `stop`, `enqueue_event`, `dispatch_ingress`) return 405 and UI controls are disabled
- WS remote mode proxies runtime mutation endpoints to the remote runtime and keeps SSE/event rendering active
- local Studio start now resolves host modules for the selected workspace and includes role counts in startup metadata
- startup payloads expose capability/effect preflight summaries (`capabilities`, `effects`) for quick diagnostics in the Studio event log

Examples:

```powershell
# local mode
npx nerve-studio

# remote mode with explicit broker URL
npx nerve-studio --remote --remote-mqtt mqtt://localhost:1883

# remote mode with env fallback
$env:NERVE_STUDIO_REMOTE_MQTT = 'mqtt://localhost:1883'
npx nerve-studio --remote

# remote ws full-control mode
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws

# remote ws mode with env fallback
$env:NERVE_STUDIO_REMOTE_WS = 'ws://127.0.0.1:4190/api/runtime/ws'
npx nerve-studio --remote
```

Repository-local alternative for any command above:

```bash
node nerve-studio/preview-server.js [same flags]
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
- `dispatch_ingress`
- `call_inspector_execute`
- `submit_candidate`
- `promote_candidate`
- `snapshot`
- `definition_status`
- `subscribe`
- `unsubscribe`

`call_inspector_execute` accepts optional governed tools policy controls:

```json
{
  "type": "call_inspector_execute",
  "requestId": "call-1",
  "payload": {
    "targetKind": "agent",
    "agent": "router",
    "prompt": "route this",
    "mode": "call",
    "tools": {
      "mode": "governed",
      "allow": ["search", "fetch"],
      "maxRounds": 8,
      "timeoutMs": 0,
      "denyOnUnknownTool": true
    }
  }
}
```

The same payload also supports structured composed text fields:

- `prompt` or `promptParts`
- `instructions` or `instructionParts`

`prompt` and `promptParts` are mutually exclusive in the same payload. `instructions` and `instructionParts` are also mutually exclusive.

Composed input example:

```json
{
  "type": "call_inspector_execute",
  "requestId": "call-2",
  "payload": {
    "targetKind": "model",
    "model": "router",
    "mode": "try",
    "promptParts": [
      "Route this request",
      { "include": "prompts/router-style.txt" }
    ],
    "instructionParts": [
      "Return JSON only"
    ]
  }
}
```

Notes:

- Omit `tools` or set `tools.mode` to `disabled` to keep tool execution off.
- When `tools.mode` is `governed`, `tools.allow` must contain at least one tool name.
- For agent targets, runtime policy still intersects requested tools with any agent profile tools declared in workspace config.
- Mixed legacy and structured input fields are rejected as validation errors before execution.

## Standalone runtime process and attach CLI

Nerveflow also provides a dedicated runtime process with a WebSocket control surface and a companion attach CLI.

Start a runtime process:

```powershell
node bin/nerve-runtime.js start examples/mqtt-simple-host --port 4190
```

Optional flags:

- `--entrypoint <path>` override workspace entrypoint file
- `--port <n>` HTTP/WS listen port (default `4190`)
- `--ws-path <path>` WebSocket path (default `/api/runtime/ws`)

When running, the process exposes:

- `GET /health` runtime status JSON
- `POST /api/runtime/ingress` dispatch an ingress connector payload over HTTP (same runtime path as `dispatch_ingress`)
- `ws://<host>:<port><wsPath>` protocol v1 command/event surface

Attach from another process:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws snapshot
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue user_message hello
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws ingress mqtt_bridge hello
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws stop
```

Listen mode keeps the socket open and prints runtime events as they arrive:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws listen
```

Notes:

- `nerve-attach` uses protocol command types `snapshot`, `enqueue_event`, `dispatch_ingress`, `stop`, `start`, and `subscribe`.
- one-shot attach commands may print event envelopes before their final response envelope when runtime events occur concurrently.
- disconnecting one attach client does not stop the runtime; other surfaces remain attached.
- `nerve-dev-remote` remains a repository development launcher and is intentionally not part of the published npm runtime artifact.

Implementation notes for the runtime module itself live in `src/runtime/README.md`.

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
    async callAgent({
      agent,
      model,
      prompt,
      instructions,
      messages,
      tools,
      format,
      returns,
      validate,
      decide,
      retry_on_contract_violation,
      on_contract_violation,
      state,
      event,
      locals,
      line,
      statement,
      sourcePath,
      sourceLine,
      onGovernedToolEvent,
    }) {
      // Your model runtime
      // messages entries have the shape { role, content, images? }
      // images is present only when the DSL message entry carried a non-empty images array
    },
    async callScript({ path, state, event, locals, line, statement, executionRole, onEvent }) {
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
- `effectChannelId` optional declared effect id when channel is declared in `nerve.json#effects` (or `nextv.json#effects`)

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

## Agent call metadata contract (additive)

Agent transports can now return either a legacy string or an envelope:

- legacy: string response text
- envelope: `{ text, metadata }`

Host adapter behavior:

- host adapter normalizes both shapes
- workflow-visible `agent()` return value is unchanged (it still returns the parsed/formatted value)
- metadata is captured separately for observability and accounting

Runtime execution payload behavior:

- `nextv_execution.result.agentCalls` is additive and defaults to an empty array
- each entry corresponds to one successful `agent()` call during that execution

`agentCalls[]` entry shape:

- `agent` agent profile name used by `agent()`
- `line` source line where the `agent()` call occurred
- `statement` statement text for traceability
- `metadata` provider metadata object (transport-defined)

Recommended metadata fields (Ollama transport):

- `provider` provider id (for example `ollama`)
- `model` resolved model id
- `usage.promptTokens`
- `usage.completionTokens`
- `usage.totalTokens`
- `timings.totalDurationNs`
- `timings.loadDurationNs`
- `timings.promptEvalDurationNs`
- `timings.evalDurationNs`

Example `nextv_execution` result snippet:

```json
{
  "result": {
    "stopped": false,
    "steps": 4,
    "agentCalls": [
      {
        "agent": "router",
        "line": 22,
        "statement": "let decision = agent(\"router\", prompt)",
        "metadata": {
          "provider": "ollama",
          "model": "qwen2.5",
          "usage": {
            "promptTokens": 180,
            "completionTokens": 34,
            "totalTokens": 214
          },
          "timings": {
            "totalDurationNs": 2198345500,
            "loadDurationNs": 0,
            "promptEvalDurationNs": 321000000,
            "evalDurationNs": 842000000
          }
        }
      }
    ]
  }
}
```

Compatibility notes:

- hosts that ignore `agentCalls` continue to work unchanged
- hosts can accumulate cost/latency metrics by summing metadata across `nextv_execution` events
- transports that do not provide metadata still work; entries are omitted unless metadata exists

## Declared effect startup policy

Hosts validate declared effect bindings during startup when channels include a `kind` value.

`effectsPolicy` is validated while loading workspace config; unsupported values fail fast before runtime startup.

- `nerve.json#effectsPolicy: "warn"` (default) publishes a `nextv_warning` event and continues startup.
- `nerve.json#effectsPolicy: "strict"` rejects startup when unsupported bindings are detected.
- Compatibility: `nextv.json#effectsPolicy` remains supported during transition.

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
mqttClient.subscribe('nextv/command', async (msg) => {
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

For detailed architecture patterns and attachment/detachment scenarios, see `docs/examples/multi-surface-attachment-pattern.md`.

## Reference implementation

See `examples/minimal-web-host/server.js`.

For a studio-independent WebSocket host example with a single-file browser UI, see `examples/ws-simple-host/server.js` and `examples/ws-simple-host/public/index.html`.

For a multi-surface headless MQTT host example demonstrating control + observability + effect surfaces, see `examples/mqtt-simple-host/mqtt-host.js`.

Host-side shared modules are documented in `src/host_core/README.md`.

## Embedded MQTT host

`examples/mqtt-simple-host/mqtt-host.js` is a minimal headless host that connects to an MQTT broker, listens for protocol commands, and publishes runtime lifecycle and execution events back to the broker. It has no HTTP server or UI — its purpose is outer-world manipulation from a running nerve project.

The same host automatically loads workspace-declared effects from `nerve.json#effects` (or `nextv.json#effects`) and forwards additive output channel metadata in `nextv_execution` event payloads.

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
