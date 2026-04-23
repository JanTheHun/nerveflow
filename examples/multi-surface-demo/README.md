# Multi-Surface Demo: Workflow Control + Observability + Effects

This demo shows the multi-surface attachment pattern in action.

**Scenario:** A workflow runs headless, controlled via MQTT. A web UI attaches to observe events. A GPIO driver realizes effects. Each surface can attach/detach independently.

## Setup

### Prerequisites

1. MQTT broker (e.g., Mosquitto at `localhost:1883`)
2. Node.js
3. Three terminals

### Terminal 1: Start the MQTT Host (Runtime Executor)

This creates the runtime session and listens for control commands.

```bash
cd examples/mqtt-simple-host
npm install
node mqtt-host.js --workspace examples/mqtt-simple-host --autostart
```

Output:
```
mqtt-simple-host connected to mqtt://localhost:1883
mqtt-simple-host listening on nextv/command
[ATTACH] MQTT surface attached (control + observability)
mqtt-simple-host autostarting workspace: examples/mqtt-simple-host
nextv_started { workspaceDir, entrypoint, state, timers, ... }
```

The MQTT surface now acts as the **control surface** (receives commands) and **observability surface** (publishes events).

### Terminal 2: Start the Observability Surface (Monitoring)

This demonstrates a second surface attaching to observe events without sending commands.

```bash
mosquitto_sub -t 'nextv/event/#' -v | head -30
```

Output (stream of runtime events):
```
nextv/event/nextv_started { eventName, payload, sequence, ... }
nextv/event/nextv_runtime_event { eventName, payload, event, ... }
nextv/event/nextv_execution { eventName, payload, result, steps, ... }
...
```

The monitoring surface receives all events but doesn't send commands. This demonstrates **observability-only attachment**.

### Terminal 3: Send Control Commands

Send commands to the runtime from a separate process.

```bash
# Send a test event to the workflow
mosquitto_pub -t 'nextv/command' -m '{
  "type": "enqueue_event",
  "requestId": "cmd-1",
  "payload": { "type": "test_event", "value": "from_cli" }
}'

# Get a snapshot of current state
mosquitto_pub -t 'nextv/command' -m '{
  "type": "snapshot",
  "requestId": "snap-1"
}'

# Stop the workflow
mosquitto_pub -t 'nextv/command' -m '{
  "type": "stop",
  "requestId": "stop-1"
}'
```

Watch Terminal 1 and Terminal 2 to see responses and events.

## Multi-Surface Detachment

### Scenario 1: Monitoring Surface Disconnects

**In Terminal 2:** Press Ctrl+C to stop `mosquitto_sub`

**Expected behavior:**
- Terminal 1 (MQTT host) continues running ✓
- Terminal 3 (control commands) still work ✓
- Terminal 1 still publishes events to MQTT ✓

Send another command from Terminal 3:

```bash
mosquitto_pub -t 'nextv/command' -m '{
  "type": "enqueue_event",
  "requestId": "cmd-2",
  "payload": { "type": "test", "value": "after_monitor_detach" }
}'
```

Restart monitoring in Terminal 2:

```bash
mosquitto_sub -t 'nextv/event/#' -v | head -10
```

The monitoring surface re-attaches and receives subsequent events. The runtime was unaffected by the disconnect/reattach.

### Scenario 2: MQTT Host Shutdown

**In Terminal 1:** Press Ctrl+C to stop the host

**Expected output:**
```
[DETACH] mqtt-simple-host shutting down...
```

**Expected behavior:**
- Workflow stops ✓
- Monitoring surface (Terminal 2) stops receiving events ✓
- No more responses to control commands (Terminal 3) ✓

## Effect Surface Pattern (Optional)

To demonstrate the effect realization surface, create a separate Node.js script:

**file: effect-driver.js**

```js
import mqtt from 'mqtt'

const client = mqtt.connect('mqtt://localhost:1883')

client.on('connect', () => {
  console.log('Effect driver connected; listening for execution events...')
  client.subscribe('nextv/event/nextv_execution', (err) => {
    if (err) console.error(err)
  })
})

client.on('message', (topic, buffer) => {
  try {
    const message = JSON.parse(buffer.toString())
    const outputs = message.payload?.payload?.result?.outputs ?? []
    
    for (const output of outputs) {
      console.log(`[EFFECT] Channel: ${output.channel}, Value: ${output.content}`)
      // In a real scenario, drive a motor, LED, relay, etc.
    }
  } catch (err) {
    console.error('Error parsing message:', err.message)
  }
})

client.on('error', (err) => {
  console.error('MQTT error:', err.message)
})
```

Run it:

```bash
node effect-driver.js
```

Now when the workflow emits output:

```bash
mosquitto_pub -t 'nextv/command' -m '{
  "type": "enqueue_event",
  "requestId": "effect-test",
  "payload": { "type": "trigger", "value": "led_on" }
}'
```

The effect driver observes the execution event and logs the effect channel and value.

## Architecture Summary

```
                     Terminal 1
                   Runtime Session
                  (MQTT Host Process)
                        │
                   Event Bus
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   Terminal 1      Terminal 2       Optional
   MQTT Surface    Monitoring      Effect Driver
   (Control +      Surface         (Effect
    Observability) (Observability- Realization)
                    only)
        │               │               │
   send command    receives events  realizes effects
   publish events  (no commands)     (no commands)
```

All surfaces share one runtime session, but operate independently.

## Detachment Guarantees

1. **Control Surface Disconnect** — Runtime continues if another control surface is available
2. **Observability Surface Disconnect** — Runtime continues; other surfaces unaffected
3. **Effect Surface Disconnect** — Runtime continues; effects may not be realized until surface re-attaches
4. **Handler Failure** — One surface's crash doesn't corrupt runtime or affect other surfaces

## Debugging

### Monitor All Events (Raw JSON)

```bash
mosquitto_sub -t 'nextv/event/#' | jq '.'
```

### Listen Only for Errors

```bash
mosquitto_sub -t 'nextv/event/nextv_error' | jq '.payload'
```

### Listen for Responses to a Specific Command

```bash
mosquitto_sub -t 'nextv/response/cmd-1'
```

## See Also

- [examples/mqtt-simple-host/README.md](../mqtt-simple-host/README.md) — MQTT host configuration and topic contract
- [docs/examples/multi-surface-attachment-pattern.md](../../docs/examples/multi-surface-attachment-pattern.md) — Multi-surface architecture patterns
- [docs/04-host-integration.md](../../docs/04-host-integration.md) — Protocol v1 command/event reference
