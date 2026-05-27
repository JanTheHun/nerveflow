# Onboarding Step 6C

## Attach ecosystem capabilities through MCP

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

## 1. Configure host MCP servers

Depending on how you added MCP capability to your composable reference host, you have a `servers` property either your `nerve.json` or in a separate `capabilities/mcp/mcp.json` file. Here you can add your MCP servers, for example filesystem MCP:

Replace or expand your `servers` list with:
```json
{
  "name": "filesystem",
  "transport": "stdio",
  "config": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "<allowed directory>"
    ]
  }
}
```

## 2. Expose some filesystem tools to the assistant

Attaching an MCP server does not automatically expose its tools to workflows.

Workflows must still explicitly allow tools through governed tool policy.

In your `workflow.nrv`, allow `list_directory` and `list_allowed_directories` for the assistant:
```nrv
tools={
  mode: "governed",
  allow: [ "get_time", "list_directory", "list_allowed_directories" ],
  maxRounds: 4
}
```

## 3. Restart host

Restart host to pick up changes - unless you already use `--hot-swap` when you start it.


## 4. Test tool calling

```
 npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "show me the structure of the first allowed directory"
```

or if you are working with a slower local call, try with raised timeout:

```
 npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "show me the structure of the first allowed directory" --timeout-ms 120000
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

## Next

Add real capability surfaces:

- [Step 6 A](step-6a.md) — Add a vector database for real RAG
- [step 6 B](step-6b.md) — Add speech capability


## Reference

- See composable host reference source: [examples/composable-reference-host/README.md](../../examples/composable-reference-host/README.md)
- See provider architecture notes: [docs/guide/10-host-db-connectors.md](../guide/10-host-db-connectors.md)

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
