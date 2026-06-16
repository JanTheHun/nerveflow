# Capability-Backed Tools (MVP)

**Status:** implemented (MVP complete)

## Implementation Summary

Workflow-backed capabilities are registered through `requires/modules` in `nextv.json`.
The `workflow` provider label causes the composable host to wire a namespaced tool provider
that executes the configured `.nrv` entrypoint via the existing script execution path.

Key implementation decisions (finalized):

- Registration lives in `requires.{namespace.operation}` + `modules.{moduleName}` config sections.
- Provider label is `workflow`; entrypoint path fields: `entrypointPath`, `path`, or `workflowPath`.
- Execution path: `callTool` → `toolRuntime.call` → workflow `operationHandler` → `callScript`.
- Policy boundary: workspace tools allow-list is enforced before `toolRuntime.call`, identical to host-backed tools.
- State scoping: each workflow tool invocation receives a scoped state segment keyed by capability id.
- Recursion guard: self-recursion blocked with `WORKFLOW_TOOL_RECURSION` deterministic error code.
- Depth guard: configurable via `NERVEFLOW_WORKFLOW_TOOL_MAX_DEPTH` env (default 16); blocked with `WORKFLOW_TOOL_DEPTH_EXCEEDED`.
- Lineage propagation: call stack is propagated through `event.payload.workflowToolStack` for reliable guard across scoped invocations.
- Error code preservation: `executeFunctionCall` wrapper preserves upstream `err.code` when set, so guard codes surface in `nextv_error.code`.
- Metadata: workflow-backed capabilities expose a tool metadata entry with at minimum name and description fields.

Tests:
- `tests/workflow_capability.test.js` — validates module wiring, recursion guard, and depth-limit guard.
- `tests/runtime_session.test.js` — validates callScript payload passthrough and allow-list boundary.

---

## Motivation

Today Nerveflow exposes capabilities through the `tool()` surface.

Examples:

```nrv
tool("get_time")
tool("memory_retrieve")
```

These capabilities are currently implemented by host providers.

The next step is to generalize the implementation model without changing the workflow language.

The goal is simple:

> A tool can be implemented by host code or by a workflow.

The caller should not care.

---

## Design Principle

Tools remain the public invocation surface.

Capabilities become the implementation abstraction.

```text
tool
  ↓
capability lookup
  ↓
realizer
```

Possible realizers:

```text
host
workflow
```

Future realizers may include:

```text
mcp
remote
embedded runtime
```

but they are outside the scope of this MVP.

---

## Capability Registry

Example:

```json
{
  "capabilities": {
    "get_time": {
      "kind": "host"
    },

    "study_artist": {
      "kind": "workflow",
      "path": "./capabilities/study_artist.nrv"
    }
  }
}
```

---

## Workflow Usage

No language changes.

Host-backed capability:

```nrv
now = tool("get_time")
```

Workflow-backed capability:

```nrv
result = tool("study_artist", {
  artist: "Radiohead"
})
```

Both use the same invocation surface.

---

## Model Usage

Tools exposed to models work exactly the same way.

```nrv
reply = agent(
  "chat",
  event.value,
  tools={
    mode: "governed",
    allow: [
      "get_time",
      "study_artist"
    ]
  }
)
```

The model does not know whether a tool is implemented by:

* host code
* workflow

The runtime resolves the capability.

---

## Example Flow

### Host Capability

```text
LLM
  ↓
get_time
  ↓
host provider
```

### Workflow Capability

```text
LLM
  ↓
study_artist
  ↓
study_artist.nrv
  ↓
knowledge_store
```

The invocation model is identical.

Only the realizer differs.

---

## MVP Validation

The MVP is successful if:

1. Existing host capabilities continue to work.
2. Workflow capabilities can be registered.
3. `tool()` can invoke both kinds.
4. Models can invoke both kinds through governed tools.
5. No DSL changes are required.

---

## Non-Goals

The MVP does not include:

* API exposure
* MCP exposure
* permission systems
* capability discovery
* capability marketplaces
* new language primitives

These can be explored later.

---

## Key Insight

The goal is not "workflows as tools."

The goal is:

> Tools are an invocation surface.
>
> Capabilities are the thing being invoked.

A capability may be implemented by host code or by a workflow.

Users create capabilities and expose them as tools when they want workflows or models to use them.
