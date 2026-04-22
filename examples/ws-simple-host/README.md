# ws-simple-host

Minimal standalone WebSocket host example using host_core modules.

This example is independent of nerve-studio and includes a single-file browser UI (`public/index.html`) with inline JavaScript and no styling.

## Run

From repository root:

```powershell
node examples/ws-simple-host/server.js
```

Then open:

- http://127.0.0.1:4185

WebSocket endpoint:

- ws://127.0.0.1:4185/api/nextv/ws

## Minimal flow

1. Click `start`
2. Click `send user_message`
3. Observe protocol responses and runtime events in the output log
4. Click `stop`

## Command envelope example

```json
{
  "type": "enqueue_event",
  "requestId": "req-2",
  "payload": {
    "eventType": "user_message",
    "value": "hello websocket",
    "source": "browser"
  }
}
```
