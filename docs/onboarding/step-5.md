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

## 2. Scaffold and start a local reference host

From your workspace root:

```bash
npx nerve-compose add host composable --json
node host/server.mjs --hot-swap
```

Host endpoint:
```
ws://127.0.0.1:4190/api/runtime/ws
```

What changed:

The runtime now executes inside a host process.
The host owns external capability attachment.
Your client workflow stays the same.

The host files are now local project code.
You can read and extend them directly under `host/`.

You still send events over the same WS runtime surface.

Hot-swap notes:

- `--hot-swap` is optional.
- When enabled, the host watches workspace config and active workflow definition files (including transitive `include` files).
- Reload uses strict policy: incompatible changes are rejected and current runtime state remains active.

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
## 4. Add agent profile

Create ```agents.json```

```
{
  "profiles": {
    "chat": {
      "model": "llama3.2:latest",
      "instructions": "You are a minimal workspace assistant. If user asks for time, try to use the tools provided to you instead of guessing."
    }
  }
}
```
---

## 5. Update your workflow

Update your `workflow.nrv` to call a tool. replace this:

```nrv
reply = model("llama3.2:latest", messages=state.conversation)
```

with this:

```nrv
reply = agent(
  "chat",
  messages=state.conversation,
  tools={
    mode: "governed",
    allow: [ "get_time" ],
    maxRounds: 4
  }
)
```
After updating workflow, restart your host.

## 6. Test the capability boundary

Send a message through the runtime surface:
```
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "what time is it?"
```

What to observe:

- The workflow stays deterministic.
- The model can only access explicitly allowed tools.
- The tool exists outside runtime execution.
- The host realizes the capability boundary.

## 7. What you learned

1. Runtime orchestration and host capabilities are separate layers.
2. Capabilities attach outside the runtime.
3. Workflows remain inspectable while capabilities scale outward.
4. Tool execution is governed explicitly, not hidden implicitly.

This separation is one of the core design principles of Nerveflow.

Minimal surface. Composable depth.

## Next

Add real capability surfaces:

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
