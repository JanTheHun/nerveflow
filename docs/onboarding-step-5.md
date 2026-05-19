# Onboarding Step 5

## Run the runtime through a host and add your first tool call.

Up to now, you ran the runtime directly.
In this step, you run a small reference host that embeds runtime and exposes the same WS command surface you have been using.

A host is the small Node app around runtime execution.
It is where tool calls become possible.

Reference host for this step:
`examples/minimal-ws-host/server.js`

## 1. Switch from runtime-only to host-run mode

Stop the runtime if it is still running.

From repository root, start the reference host pointed at your project workspace:

```bash
node examples/minimal-ws-host/server.js path/to/my-project
```

If you initialized your workspace with `nerve-compose init`, your project is in the current directory:

```bash
node examples/minimal-ws-host/server.js .
```

Host endpoints:

```text
http://127.0.0.1:4190
ws://127.0.0.1:4190/api/runtime/ws
```

What changed:

1. Before: you started runtime directly.
2. Now: the host process owns runtime execution and tool integrations.
3. Your event client flow stays the same (`npx nerve-send` over WS).

## 2. Minimal host tool: get_time

In `examples/minimal-ws-host/server.js`, the host provides exactly one tool via `createToolRuntime(...)`:

```js
const toolRuntime = createToolRuntime({
  providers: [
    {
      async get_time() {
        return new Date().toISOString()
      },
    },
  ],
})
```

This keeps the concept focused:

1. workflow asks for a tool
2. host executes the tool
3. runtime stays deterministic

## 3. Call get_time from your existing workflow

Inside your `on external "user_message"` handler in `workflow.nrv`, change this line:

```nrv
output text assistant_text
```

to these two lines:

```nrv
now = tool("get_time")
output text "${assistant_text} ${now}"
```

## 4. Test with nerve-send

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello"
```

What to observe:

1. `nerve-send` still works as before.
2. Event goes to runtime through the host WS surface.
3. Workflow calls `tool("get_time")`.
4. Host returns UTC timestamp.

Optional: inspect execution in Nerve Studio

You can attach Studio to the same host websocket endpoint to inspect events, outputs, and execution flow while the host is running.

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Then open:

```text
http://localhost:4173
```

## 5. What you learned

1. Host is the capability boundary around runtime execution.
2. You can keep your existing WS client workflow.
3. Tool calls are host-provided but workflow-orchestrated.

Next: add a second tool (for example, `mock_retrieve`) and route between plain generation and retrieval-augmented generation.

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../MANIFESTO.md).
