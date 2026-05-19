# minimal-ws-host

A small host that embeds runtime execution and exposes a WebSocket command surface at `/api/runtime/ws`.

Point it at any Nerveflow workspace. It provides one built-in tool: `get_time`.

## Run

From repository root, pass your workspace directory as the first argument:

```bash
node examples/minimal-ws-host/server.js path/to/my-project
```

Or from inside your project:

```bash
node path/to/nerveflow/examples/minimal-ws-host/server.js .
```

Endpoints:

- Runtime WS: `ws://127.0.0.1:4190/api/runtime/ws`

## Test with nerve-send

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello"
```
