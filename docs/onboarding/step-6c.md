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

## 2. Start the composable host

```bash
node examples/composable-reference-host/server.js
```

Runtime WS endpoint:

```text
ws://127.0.0.1:4190/api/runtime/ws
```


## 3. Configure filesystem MCP

Replace your MCP servers config with:

```json
{
  "name": "filesystem",
  "transport": "stdio",
  "config": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
}
```

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

- See composable host details: `examples/composable-reference-host/README.md`
- See provider architecture notes: `docs/guide/10-host-db-connectors.md`

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
