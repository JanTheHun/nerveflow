# Onboarding Step 6C

## Add MCP-powered assistants to your host

In previous onboarding steps, you built:

* deterministic workflows
* bounded routing
* host-provided tools

In this step, you attach external capabilities through MCP (Model Context Protocol).

The workflow stays deterministic.
The host exposes new capabilities through governed tool surfaces.


## Why this matters

MCP does not change the workflow language.

Capabilities attach through the host layer.

Your workflow still decides:

* when tools are allowed
* which tools are allowed
* how many rounds are permitted
* when execution stops

The runtime enforces those boundaries deterministically.



## Prerequisites

- You completed the composable host setup steps.
- Your workspace has `nerve.json` (or `nextv.json`) and a workflow.
- Node.js is available in your shell.
- For tool-calling validation, prefer `qwen3:14b` as the assistant model.

Recommended setup:

```bash
ollama pull qwen3:14b
```

## 1. Scaffold MCP capability support

From repository root:

```bash
npx nerve-compose add mcp --json
```

This adds:

* `requires.mcp`
* `modules.mcp`
* a local MCP server scaffold

Validate capability bindings:

```bash
npx nerve-compose validate --json
```

Expected:

```json
{
  "ok": true
}
```

## 2. Scaffold and start a local reference host

```bash
npx nerve-compose add host composable --json
node host/server.mjs --hot-swap
```

Hot-swap behavior (optional):

- `--hot-swap` enables file-watch reload for workspace config and active workflow definition files.
- Included workflow files loaded via `include "..."` are watched too.
- Reload is strict: invalid changes are rejected and current runtime state remains active.

Runtime WS endpoint:

```text
ws://127.0.0.1:4190/api/runtime/ws
```


## 3. Configure host MCP servers

`node bin/nerve-compose.js add mcp --json` scaffolds a local MCP server at `mcp-servers/local-mcp.mjs` and wires it into host configuration.

If you want to edit the host MCP server entry manually, use:

```json
{
  "name": "local-mcp",
  "transport": "stdio",
  "config": {
    "command": "node",
    "args": ["./mcp-servers/local-mcp.mjs"]
  }
}
```

Add more MCP servers later by editing the host configuration directly.

# What you learned

You now have:

* deterministic workflow orchestration
* runtime-governed tool execution
* attachable external capabilities through MCP
* bounded assistant specialization
* inspectable external cognition

The workflow stays inspectable while capabilities scale outward.

Minimal surface. Composable depth.



## Reference: Next

- See composable host reference source: [examples/composable-reference-host/README.md](../../examples/composable-reference-host/README.md)
- See provider architecture notes: [docs/guide/10-host-db-connectors.md](../guide/10-host-db-connectors.md)

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
