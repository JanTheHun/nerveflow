# minimal-ws-host

A small host that embeds runtime execution and exposes a WebSocket command surface at `/api/runtime/ws`.

Point it at any Nerveflow workspace. It provides one built-in tool: `get_time`.

`agent()` and `model()` calls are enabled via the OpenAI-compatible transport. Workspace `transports` and `models` config are used at runtime.

## Run

From repository root, pass your workspace directory as the first argument:

```bash
node examples/minimal-ws-host/server.js path/to/my-project
```

Or from inside your project:

```bash
node path/to/nerveflow/examples/minimal-ws-host/server.js .
```

If the workspace argument is omitted, the current working directory is used:

```bash
node path/to/nerveflow/examples/minimal-ws-host/server.js
```

When starting, this host also attempts to load `.env` from the workspace directory.

- Existing process environment values are preserved.
- Missing values from workspace `.env` are injected before runtime startup.

Endpoints:

- Runtime WS: `ws://127.0.0.1:4190/api/runtime/ws`

## Test with nerve-send

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello"
```
