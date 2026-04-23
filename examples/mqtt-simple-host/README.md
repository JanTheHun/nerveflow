# MQTT Simple Host

A headless Nerveflow host that connects to an MQTT broker for command/event communication. Demonstrates the multi-surface attachment pattern with control + observability surfaces.

## Overview

mqtt-simple-host:

- **No HTTP server or UI** — Designed for outer-world manipulation from a running nerve project
- **Single runtime session** — Owns workflow execution and state
- **MQTT surface** — Acts as control surface (receives commands) and observability surface (publishes events)
- **Multi-surface ready** — Other surfaces (web UI, GPIO driver, monitoring service) can attach independently

## Architecture: Multi-Surface Pattern

```
                 Runtime Session
                 (execution authority)
                        ↓
                   Event Bus
                        ↓
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
   MQTT Control    Web UI (optional)   GPIO Driver
   (send command)  (observe events)    (realize effects)
        |           (may attach/detach) (separate process)
        └───────────────┴───────────────┘
         All surfaces share one runtime
```

**Key points:**

- mqtt-simple-host creates the runtime session (execution authority)
- MQTT client acts as a **control surface** (sends commands) + **observability surface** (publishes events)
- Other surfaces (web UI, monitoring, effect drivers) can attach to the event bus independently
- When a surface disconnects, runtime continues unaffected
- When a surface connects, it immediately starts receiving events

## Running

### Prerequisites

1. MQTT broker (e.g., Mosquitto running at `localhost:1883`)
2. Ollama (if using agents; running at `localhost:11434`)
3. Node.js

### Start the Host

```bash
npm install
node mqtt-host.js
```

Or with environment variables:

```bash
MQTT_BROKER_URL=mqtt://localhost:1883 \
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
node mqtt-host.js
```

### Specify Workspace & Autostart

```bash
node mqtt-host.js --workspace examples/mqtt-simple-host --autostart
```

## MQTT Topic Contract

| Direction | Topic | Content |
|-----------|-------|---------|
| Inbound | `nextv/command` | Host protocol v1 command envelope (JSON) |
| Outbound | `nextv/event/{eventName}` | Host protocol v1 event envelope (JSON) |
| Outbound | `nextv/response/{requestId}` | Host protocol v1 response envelope (JSON) |

### Example: Send Command

```bash
# Start workflow in workspace
mosquitto_pub -t 'nextv/command' -m '{
  "type": "start",
  "requestId": "init-1",
  "payload": { "workspaceDir": "examples/mqtt-simple-host" }
}'

# Subscribe to responses
mosquitto_sub -t 'nextv/response/init-1'

# Subscribe to all events
mosquitto_sub -t 'nextv/event/#'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker connection URL |
| `MQTT_COMMAND_TOPIC` | `nextv/command` | Topic the host subscribes to for commands |
| `MQTT_EVENT_TOPIC_PREFIX` | `nextv/event` | Prefix for outbound event topics |
| `MQTT_RESPONSE_TOPIC_PREFIX` | `nextv/response` | Prefix for outbound response topics |
| `MQTT_INCLUDE_EVENTS` | _(empty = all)_ | Comma-separated canonical event names to publish |
| `MQTT_AUTOSTART_WORKSPACE` | _(empty)_ | Workspace-relative path to auto-start on connect |
| `MQTT_AUTOSTART_ENTRYPOINT` | _(empty)_ | Entrypoint path relative to workspace |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Base URL for `agent()` model calls |
| `OLLAMA_MODEL` | _(empty)_ | Default fallback model for agents |

## Command-Line Flags

```bash
--workspace <path>   # Workspace-relative project directory
--entrypoint <path>  # Entrypoint path relative to workspace
--autostart          # Start the provided workspace after MQTT connect
```

## Surface Roles

### Control Surface (MQTT Inbound)

Receives commands via `nextv/command` topic:

```json
{
  "type": "start",
  "requestId": "req-1",
  "payload": { "workspaceDir": "examples/mqtt-simple-host" }
}
```

Supported commands:

- `start` — Initialize and run workflow
- `stop` — Halt workflow
- `enqueue_event` — Send input event to workflow
- `snapshot` — Get current state
- `subscribe` — Request event subscription
- `unsubscribe` — Request event unsubscription

### Observability Surface (MQTT Outbound)

Publishes runtime events via `nextv/event/{eventName}`:

```json
{
  "eventName": "nextv_execution",
  "payload": {
    "result": {
      "steps": 1,
      "state": { "count": 1 },
      "outputs": []
    }
  }
}
```

Events published:

- `nextv_started` — Runtime initialized
- `nextv_execution` — Script step completed
- `nextv_error` — Execution error
- `nextv_warning` — Policy or effect binding warning
- `nextv_runtime_event` — Input event processed
- `nextv_timer_pulse` — Timer fired (can be suppressed)
- `nextv_stopped` — Runtime halted

### Effect Surface (Optional, Separate Process)

A separate process can subscribe to `nextv/event/nextv_execution` and realize declared effects:

```js
// Example: GPIO driver listening for effects
import mqtt from 'mqtt'

const client = mqtt.connect('mqtt://localhost:1883')

client.subscribe('nextv/event/nextv_execution', (err) => {
  if (err) console.error(err)
})

client.on('message', (topic, message) => {
  const event = JSON.parse(message)
  const { outputs } = event.payload?.result ?? {}
  
  if (!outputs) return
  
  for (const output of outputs) {
    if (output.effectChannelId === 'gpio_write') {
      // Realize GPIO effect
      gpio.write(output.payload)
    }
  }
})
```

## Multi-Surface Scenario

### Setup

**Terminal 1: Start mqtt-simple-host**

```bash
node mqtt-host.js --workspace examples/mqtt-simple-host --autostart
```

Output:
```
mqtt-simple-host connected to mqtt://localhost:1883
mqtt-simple-host listening on nextv/command
[ATTACH] MQTT surface attached (control + observability)
mqtt-simple-host autostarting workspace: examples/mqtt-simple-host
nextv_started ...
```

**Terminal 2: Start observability surface (monitoring)**

```bash
mosquitto_sub -t 'nextv/event/#' -v | head -20
```

Shows: All runtime events published by mqtt-simple-host

**Terminal 3: Start effect surface (GPIO driver)**

```bash
mosquitto_sub -t 'nextv/event/nextv_execution' | jq '.payload.result.outputs'
```

Shows: Only execution outputs (filtered by this surface)

**Terminal 4: Send control commands**

```bash
# Enqueue event to runtime
mosquitto_pub -t 'nextv/command' -m '{
  "type": "enqueue_event",
  "requestId": "cmd-1",
  "payload": { "type": "timer_tick", "value": "pulse" }
}'
```

### Detach Scenario

Stop the GPIO driver (Terminal 3):

```bash
# Ctrl+C in Terminal 3
```

Output in Terminal 1:

```
# GPIO driver disconnected, but runtime continues
```

MQTT surface (Terminal 1) continues running. Send another command:

```bash
mosquitto_pub -t 'nextv/command' -m '{"type": "enqueue_event", "requestId": "cmd-2", ...}'
```

All surfaces that are still connected (MQTT, monitoring) receive events.

## Configuration

### Workspace Config (nextv.json)

```json
{
  "entrypointPath": "workflow.nrv",
  "effectsPolicy": "warn",
  "effects": {
    "gpio_write": {
      "kind": "mqtt",
      "topic": "device/gpio"
    }
  }
}
```

### Tool & Agent Policies

See [docs/04-host-integration.md](../../docs/04-host-integration.md) for tool allow-lists and agent profiles.

## Event Filtering

### Include/Exclude Events

```bash
# Only publish execution and error events
MQTT_INCLUDE_EVENTS=nextv_execution,nextv_error node mqtt-host.js
```

### Suppress Timer Noise

By default, timer events are suppressed from MQTT egress (to reduce noise). To include them:

```bash
# Modify create-mqtt-host.js options:
const host = createMqttHost(mqttClient, resolvers, {
  suppressTimerEvents: false,  // ← Include timer events
})
```

## Testing

```bash
npm test
```

See `tests/mqtt_embedded_host.test.js` for multi-surface attachment scenarios.

## See Also

- [docs/examples/multi-surface-attachment-pattern.md](../../docs/examples/multi-surface-attachment-pattern.md) — Multi-surface architecture patterns
- [docs/04-host-integration.md](../../docs/04-host-integration.md) — Protocol v1 command/event reference
- [src/host_core/README.md](../../src/host_core/README.md) — Host core architecture
