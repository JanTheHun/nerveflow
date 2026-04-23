# host_core

Shared host-side execution substrate for nextV hosts.

This directory exists to keep transport/protocol concerns out of core runtime logic while reusing proven host behaviors across web, CLI, and embedded hosts.

## Scope

Included:

- workspace config loading and validation
- host adapter assembly for tool/agent/script/operator calls
- runtime lifecycle helpers (state paths, timers, input normalization)
- runtime execution filtering helpers
- transport-independent fanout event bus

Explicitly excluded:

- HTTP routing
- SSE/WebSocket framing
- UI rendering
- runtime language semantics (owned by nextv_runtime)

## Layering

Dependency direction is intended to be:

nextv_runtime
-> host_core
-> surface hosts (web, CLI, embedded)

Surface hosts may depend on host_core.
host_core must not depend on transport or UI layers.

## Design Principles

- transport independence
- deterministic host behavior
- reusable host parity across surfaces
- no semantic duplication with runtime core

## Module Map

- workspace_config.js
- runtime_session.js
- runtime_controller.js
- runtime_lifecycle.js
- runtime_policy.js
- event_bus.js

## Key Contracts

### createHostAdapter (runtime_session.js)

Creates host adapter hooks used by runNextVScript host integration.

Behavior highlights:

- tool aliases resolve before allow-list checks
- allow-list deny returns deterministic policy error
- allowed-but-unimplemented tools return deterministic unavailable error
- script and operator calls route through runNextVScriptFromFile with output contract validation

### createNextVRuntimeController (runtime_controller.js)

Creates a transport-agnostic runtime session controller used by surface hosts.

Behavior highlights:

- centralizes runtime start/stop/enqueue/snapshot semantics
- preserves timer pulse publication and no-op suppression policy behavior
- emits canonical runtime lifecycle events through event_bus
- lets HTTP/SSE/WebSocket/SDK surfaces share one deterministic control layer

Startup effect policy behavior:

- reads `nextv.json#effectsPolicy` (`warn` default, `strict` optional)
- validates declared effect channels that define `kind` via optional `validateEffectBindings` hook
- `warn` mode publishes `nextv_warning` with `code: "UNSUPPORTED_EFFECT_BINDING"` and continues startup
- `strict` mode fails startup when unsupported bindings are detected

`validateEffectBindings` contract:

- called with `{ channelId, channelConfig }`
- return `true`/`undefined` to accept binding
- return `false`, string message, or `{ ok: false, reason?, message? }` to reject binding

### loadWorkspaceNextVConfig (workspace_config.js)

Loads nextV workspace config from:

1. nextv.json inline blocks
2. nextv.json external refs (agentsConfig/toolsConfig/operatorsConfig)
3. fallback files (agents.json/tools.json/operators.json)

Includes tools alias cycle validation and normalized config source reporting.

### runtime_lifecycle helpers

- resolveOptionalStatePath
- resolveStateDiscoveryBaseDir
- resolveDiscoveredStatePath
- normalizeInputEvent
- timer handle helpers

These keep host path and timer semantics deterministic and reusable.

### runtime_policy helpers

- hasMeaningfulNextVExecutionEvents
- areJsonStatesEqual
- normalizeEffectsPolicy
- validateDeclaredEffectBindings

Used by hosts to suppress no-op noise while preserving meaningful execution events.

### createEventBus (event_bus.js)

Simple transport-independent fanout event bus:

- publish(eventName, payload)
- subscribe(handler)
- unsubscribe(handler)
- size

## Usage

Typical host usage:

1. load workspace config via workspace_config
2. create adapter via runtime_session
3. create runner with runOptions.hostAdapter
4. apply runtime_policy and runtime_lifecycle helpers around host orchestration
5. publish host events through event_bus

See nerve-studio/preview-server.js for a reference host composition.

## Multi-Surface Attachment Model

Nerveflow supports a **single active runtime session** with **multiple dynamically attached surfaces**.

Key principles:

- **Single execution authority** — One runtime session owns execution, state, event queue, and effect emissions
- **Multiple surfaces** — Any number of transports or clients can attach to observe, control, or realize effects
- **Dynamic attachment** — Surfaces may attach or detach at any time without interrupting runtime execution
- **Failure isolation** — A surface failure (handler throw, transport disconnect, client crash) does not affect other surfaces or runtime integrity

Surface roles:

- **Control surface** — Sends protocol commands (`start`, `stop`, `enqueue_event`, `snapshot`)
- **Observability surface** — Subscribes to runtime event streams for graph animation, state inspection, execution tracking
- **Effect surface** — Binds and realizes declared effect channels (e.g., MQTT publish, GPIO write)

Attachment lifecycle:

- At startup, a transport creates the event bus and controller (these own the runtime)
- Other transports may attach later by subscribing to the same event bus
- Surfaces can unsubscribe and disconnect without affecting runtime or other subscribed surfaces
- Runtime continues executing until explicitly stopped via `stop` command

## Embedded host pattern

For headless or embedded surfaces (MQTT, CLI, IPC), the minimal wiring is:

```js
import { createEventBus, createNextVRuntimeController } from 'nerveflow/host_core'
import { buildHostProtocolEvent, validateHostProtocolCommand } from 'nerveflow/host_core/protocol'

// One event bus and controller per runtime session (shared by all attached surfaces)
const eventBus = createEventBus()
const controller = createNextVRuntimeController({ eventBus, /* ...resolvers */ })

// SURFACE 1: Control transport (e.g., MQTT command subscriber)
transport1.onCommand(async (raw) => {
  const command = validateHostProtocolCommand(raw)
  if (command.type === 'start') await controller.start(command.payload)
  if (command.type === 'enqueue_event') controller.enqueue(command.payload)
  // ... other command types
})

// SURFACE 2: Observability transport (e.g., logging sink)
eventBus.subscribe((eventName, payload) => {
  logger.info({ eventName, payload })
})

// SURFACE 3: Effect transport (e.g., MQTT publisher for effects)
eventBus.subscribe((eventName, payload) => {
  if (eventName === 'nextv_execution' && payload.result?.outputs) {
    for (const output of payload.result.outputs) {
      if (output.effectChannelId === 'heartbeat') {
        transport3.publish('device/heartbeat', output.content)
      }
    }
  }
})

// Note: Handler throws are caught and isolated; one surface failure doesn't affect others.
```

The event bus fan-outs to all subscribed handlers simultaneously. If a handler throws, it is automatically removed from the subscriber set; other handlers continue receiving events and the runtime continues operating.

Filter events before subscribing using `hasMeaningfulNextVExecutionEvents` (suppresses no-op timer ticks) or a custom predicate. See `examples/mqtt-simple-host/mqtt-host.js` for a complete embedded MQTT host reference demonstrating control + observability + effect surface patterns.
