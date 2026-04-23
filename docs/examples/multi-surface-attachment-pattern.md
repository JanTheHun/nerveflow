# Multi-Surface Attachment Pattern

## Overview

Nerveflow runtime sessions support **multiple dynamically attached surfaces** for control, observability, and effect realization.

A runtime session owns execution, state, and event queue. Surfaces attach via event bus subscription to observe, control, or realize effects. Surfaces may attach or detach without interrupting runtime execution.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Runtime Session                              │
│  - Single execution authority                                   │
│  - Owns workflow state                                           │
│  - Owns event queue                                              │
│  - Emits canonical events                                        │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                         ┌─────────▼─────────┐
                         │   Event Bus       │
                         │   (Fan-out)       │
                         └─────────┬─────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
         ┌──────────▼──────┐   ┌───▼──────────┐  │
         │ Control Surface │   │Observability │  │
         │ (MQTT/CLI)      │   │ Surface (UI) │  │
         │ - subscribe()   │   │ - subscribe()│  │
         │ - commands      │   │ - read-only  │  │
         └─────────────────┘   └──────────────┘  │
                                                 │
                                    ┌────────────▼─────────┐
                                    │ Effect Surface       │
                                    │ (Device/MQTT write)  │
                                    │ - subscribe()        │
                                    │ - filter + realize   │
                                    └──────────────────────┘
```

## Attachment Lifecycle

### Initial Setup

One transport creates the runtime:

```js
import { createEventBus, createNextVRuntimeController } from 'nerveflow/host_core'

const eventBus = createEventBus()
const controller = createNextVRuntimeController({ eventBus, /* ...resolvers */ })
```

### Surface 1: Control (e.g., MQTT command listener)

```js
mqttClient.on('connect', () => {
  // Subscribe to command topic
  mqttClient.subscribe('nerve/command', async (msg) => {
    const command = JSON.parse(msg)
    
    if (command.type === 'start') {
      await controller.start(command.payload)
    } else if (command.type === 'enqueue_event') {
      controller.enqueue(command.payload)
    } else if (command.type === 'stop') {
      controller.stop()
    }
  })
})
```

### Surface 2: Observability (e.g., Web UI connection)

```js
wsServer.on('connection', (wsClient) => {
  // Create handler for this connection
  const handler = (eventName, payload) => {
    wsClient.send(JSON.stringify({
      type: 'event',
      eventName,
      payload
    }))
  }
  
  // Attach by subscribing
  eventBus.subscribe(handler)
  
  // Detach on disconnect
  wsClient.on('close', () => {
    eventBus.unsubscribe(handler)
  })
})
```

### Surface 3: Effect Realization (e.g., GPIO driver)

```js
const effectHandler = (eventName, payload) => {
  if (eventName === 'nextv_execution' && payload.result?.outputs) {
    for (const output of payload.result.outputs) {
      // Realize declared effects
      if (output.effectChannelId === 'heartbeat') {
        ledController.pulse(output.content)
      } else if (output.effectChannelId === 'gpio_write') {
        gpioDriver.write(output.payload)
      }
    }
  }
}

eventBus.subscribe(effectHandler)
```

## Detachment Scenario

Web UI closes; runtime and MQTT surface continue:

```
Time: t0
  - MQTT surface: attached (listening for commands)
  - Web UI: attached (observing events)
  - Effect surface: attached (realizing effects)

Time: t1 (Web UI closes)
  - eventBus.unsubscribe(webUiHandler)
  - Web UI disconnected

Time: t2
  - MQTT surface: still attached, still receiving events
  - Effect surface: still attached, still realizing effects
  - Runtime: continues executing, unaffected by Web UI disconnect

Time: t3 (MQTT client sends 'enqueue_event' command)
  - controller.enqueue(event)
  - Runtime processes event
  - eventBus publishes 'nextv_execution' event
  - Effect surface receives and realizes effect
  - MQTT surface receives event (observes) if subscribed to events
```

## Failure Isolation

If one surface handler throws:

```js
// Bad handler (throws)
const badHandler = (eventName, payload) => {
  throw new Error('Something went wrong')  // ← Handler fails
}

eventBus.subscribe(badHandler)

// Good handler (works fine)
const goodHandler = (eventName, payload) => {
  console.log('Event:', eventName)  // ← Continues to receive events
}

eventBus.subscribe(goodHandler)

// Publish an event
eventBus.publish('nextv_execution', { result: { steps: 1 } })

// Result:
// - badHandler throws
// - Event bus catches throw and removes badHandler
// - goodHandler still called and logs event
// - Runtime unaffected
// - Other surfaces unaffected
```

Event bus guarantees (from `event_bus.js`):

```js
for (const handler of handlers) {
  try {
    handler(eventName, payload)
  } catch {
    // Catch and isolate handler failures
    handlers.delete(handler)
  }
}
```

## Protocol Commands and Events

### Commands (sent to runtime controller)

| Command | Purpose | Example |
|---------|---------|---------|
| `start` | Initialize and start runtime | `{ type: 'start', payload: { workspaceDir: '...' } }` |
| `stop` | Halt runtime | `{ type: 'stop' }` |
| `enqueue_event` | Feed input event to runtime | `{ type: 'enqueue_event', payload: { type: 'user_input', value: 'hello' } }` |
| `snapshot` | Get current state | `{ type: 'snapshot' }` |
| `subscribe` | Request event subscription | `{ type: 'subscribe' }` |
| `unsubscribe` | Request event unsubscription | `{ type: 'unsubscribe' }` |

### Events (published by runtime to all subscribed surfaces)

| Event | Meaning | Payload Example |
|-------|---------|-----------------|
| `nextv_started` | Runtime initialized | `{ workspaceDir, entrypoint, state, timers, ... }` |
| `nextv_stopped` | Runtime halted | `{ snapshot: { state, executionCount, ... } }` |
| `nextv_execution` | Script step completed | `{ result: { steps, state, outputs, ... } }` |
| `nextv_error` | Execution error | `{ error: { code, message, line, ... } }` |
| `nextv_warning` | Policy or binding warning | `{ code: 'UNSUPPORTED_EFFECT_BINDING', ... }` |
| `nextv_runtime_event` | Input event received | `{ event: { type, value, source, ... } }` |
| `nextv_timer_pulse` | Timer fired | `{ event: { type, value, ... } }` |
| `nextv_event_queued` | Event added to queue | `{ event: { ... }, queueLength }` |

## Surface Role Patterns

### Control-Only Surface

```js
// CLI or script: sends commands, doesn't observe events
const cliCommands = ['start', 'stop', 'enqueue_event']
cliCommands.forEach(cmd => {
  // No eventBus.subscribe(); command-only pattern
})
```

### Observability-Only Surface

```js
// Monitoring dashboard: observes events, doesn't send commands
const monitoringHandler = (eventName, payload) => {
  dashboardUI.update(eventName, payload)
}
eventBus.subscribe(monitoringHandler)
// No controller calls; read-only pattern
```

### Control + Observability

```js
// Web UI: sends commands and observes feedback
// - Control: wsServer receives commands, calls controller
// - Observability: wsServer subscribes to eventBus
```

### Effect-Only Surface

```js
// Headless device driver: observes effects, ignores other events
const effectHandler = (eventName, payload) => {
  if (eventName === 'nextv_execution' && payload.result?.outputs) {
    // Realize effects
  }
  // Ignore all other events
}
eventBus.subscribe(effectHandler)
```

## Common Patterns

### Pattern 1: Studio + Headless Effect Driver

1. Open nerve-studio UI → creates web host with control + observability
2. Separately, start GPIO driver → attaches as effect-only surface
3. UI controls workflow, GPIO driver realizes effects
4. Close UI → workflow continues, GPIO driver active
5. Create new UI session → re-attaches as new surface

### Pattern 2: MQTT Command + Monitoring

1. MQTT client starts headless host → creates control surface
2. Monitoring service subscribes to events → observability surface
3. CLI or external system sends commands → control surface routes to controller
4. Monitoring receives all events and logs them
5. If monitoring disconnects → MQTT surface unaffected

### Pattern 3: Multi-Client Web UI

1. First web client connects → attaches to eventBus
2. Second web client connects → attaches to same eventBus
3. First client sends command → runtime executes
4. Both clients observe events from runtime
5. Either client can disconnect without affecting the other

## Handler Failure and Recovery

Handler failures are automatic isolated; no recovery mechanism needed:

```js
// A buggy handler
const buggyHandler = (eventName, payload) => {
  if (payload.something.missing) {  // ← throws if missing
    // Process
  }
}

eventBus.subscribe(buggyHandler)

// If thrown, handler is removed:
// handlers.delete(buggyHandler)

// Later re-attach is possible:
eventBus.subscribe(buggyHandler)  // Fresh subscription
```

## Event Filtering

Surfaces often filter events to reduce noise:

```js
// Effect surface: only care about execution events
const effectHandler = (eventName, payload) => {
  if (eventName !== 'nextv_execution') return  // ← Filter
  // Realize effects from payload.result.outputs
}

// Observability surface: exclude timer noise
import { hasMeaningfulNextVExecutionEvents } from 'nerveflow/host_core'

const uiHandler = (eventName, payload) => {
  if (!hasMeaningfulNextVExecutionEvents(eventName, payload)) return  // ← Filter
  wsClient.send(JSON.stringify({ eventName, payload }))
}
```

## Design Constraints

1. **Single execution authority** — Only runtime controller mutates state; surfaces are read-only observers (except for sending control commands)
2. **Atomic events** — Each published event is a complete snapshot; surfaces never see partial state
3. **Deterministic ordering** — Events are delivered in publish order to all handlers
4. **No surface coordination** — Surfaces don't coordinate with each other; all communication is via runtime events
5. **Handler isolation** — One handler's failure doesn't corrupt state or affect other handlers

## See Also

- [src/host_core/README.md](../../src/host_core/README.md) — Multi-Surface Attachment Model design principles
- [docs/04-host-integration.md](../04-host-integration.md) — Protocol v1 command/event reference
- [examples/mqtt-simple-host/mqtt-host.js](../../examples/mqtt-simple-host/mqtt-host.js) — Working multi-surface implementation
