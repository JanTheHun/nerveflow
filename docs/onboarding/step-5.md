# Onboarding Step 5

## Attach your first host capability

Up to now, you have been running the runtime directly.

Your workflows already support:

- deterministic orchestration
- bounded model behavior
- attachable observability surfaces

Now you will attach your first external capability through a host.

This is one of the core architectural boundaries in Nerveflow:

**Workflows decide when. Hosts decide how.**

The workflow orchestrates execution.
The host realizes capabilities.

---

## What changes in this step

Before:

workflow -> runtime

After:

workflow -> runtime -> host capability

The workflow remains deterministic.

The host becomes the boundary where external capabilities attach.

---

## 1. Stop the runtime

Stop the runtime if it is still running.

## 2. Start the composable reference host

From your workspace root:

```bash
node node_modules/nerveflow/examples/composable-reference-host/server.js
```

Host endpoint:
```
ws://127.0.0.1:4190/api/runtime/ws
```

What changed:

The runtime now executes inside a host process.
The host owns external capability attachment.
Your client workflow stays the same.

You still send events over the same WS runtime surface.

---

## 3. Add a simple host capability

From your workspace root:
```
npx nerve-compose add mcp --json
```
This scaffolds:

- MCP capability wiring
- a local sample MCP server
- workspace capability bindings

Validate the workspace:
```
npx nerve-compose validate --json
```
Expected:
```json
{
  "ok": true
}
```

---

## 4. Update your workflow

Update your `workflow.nrv` to call a tool. Inside your `on external "user_message"` handler, change this line:

```nrv
reply = model("llama3.2:latest", messages=state.conversation)
```

to this:

```nrv
reply = agent(
  "workspace_guide",
  event.value,
  tools={
    mode: "governed",
    allow: [ "echo" ],
    maxRounds: 4
  }
)
```



















## 5. What you learned

1. Host is the capability boundary around runtime execution.
2. You can keep your existing WS client workflow.
3. Tool calls are host-provided but workflow-orchestrated.

## Next

Add a real capability:

- [step-6a.md](step-6a.md) — Add a vector database for real RAG
- [step-6b.md](step-6b.md) — Add speech capability
- [step-6c.md](step-6c.md) — Add MCP servers

## If you hadn't done it yet: scaffold documentation profiles

If you want guided project-generation or AI-assisted workflows, you can scaffold documentation profiles into your workspace:

```bash
# Minimal guide docs
npx nerve-compose add docs minimal

# AI/project-generation docs
npx nerve-compose add docs ai
```

Or continue exploring in the [User Handbook](../guide/13-user-handbook.md).

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
