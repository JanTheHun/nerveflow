# Onboarding Step 5

## Run the runtime through a host and add your first tool call.

Up to now, you ran the runtime directly.
In this step, you run a small reference host that embeds runtime and exposes the same WS command surface you have been using.

A host is the small Node app around runtime execution.
It is where tool calls become possible.

Reference host for this step:
- Repository source path: `examples/minimal-ws-host/server.js`
- Installed package path: `node_modules/nerveflow/examples/minimal-ws-host/server.js`

## 1. Stop the runtime

Stop the runtime if it is still running.

## 2. Update your workflow

Update your `workflow.nrv` to call a tool. Inside your `on external "user_message"` handler, change this line:

```nrv
output text assistant_text
```

to these two lines:

```nrv
now = tool("get_time")
output text "${assistant_text} ${now}"
```

## 3. Start the host

Use the command that matches your setup:

Repository source checkout (run from repository root):

```bash
node examples/minimal-ws-host/server.js path/to/my-project
```

If your workflow files are in the current directory, you can use:

```bash
node examples/minimal-ws-host/server.js
```

Project installed with npm (run from your project directory after `npm install nerveflow`):

```bash
node node_modules\nerveflow\examples\minimal-ws-host\server.js
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

## 4. Minimal host tool: get_time

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

## 5. Test with nerve-send

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

## 6. What you learned

1. Host is the capability boundary around runtime execution.
2. You can keep your existing WS client workflow.
3. Tool calls are host-provided but workflow-orchestrated.

## Want to make it real?

Core onboarding is complete. Choose your next focus:

- [step-6a.md](step-6a.md) — Add a vector database for real RAG
- [step-6b.md](step-6b.md) — Add speech capability
- [step-6c.md](step-6c.md) — Add MCP servers

Or continue exploring in the [User Handbook](../guide/13-user-handbook.md).

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
