# Host DB Connectors

This page focuses on the recommended package-first path for database-backed capabilities: composable host auto-attach using the composable reference host.

If you need manual provider wiring and low-level host-modules composition, see [10-host-db-connectors-low-level.md](10-host-db-connectors-low-level.md).

## Recommended path: composable reference host

The composable path keeps workflow semantics deterministic while moving infrastructure binding into workspace configuration and host capability factories.

Typical flow:

```bash
# 1) Declare capability in workspace config
npx nerve-compose add memory-pgvector <workspaceDir>

# 2) Validate resolved bindings before host startup
npx nerve-compose validate <workspaceDir> --json

# 3) Run host against your workflow workspace
WORKSPACE_DIR=<workspaceDir> node node_modules/nerveflow/examples/composable-reference-host/server.js
```

## Workspace contract

`nerve-compose add memory-pgvector` writes capability declarations into workspace config (`nerve.json`, or `nextv.json` fallback), including:

- `requires.memory`
- `modules.memory.provider = memory-pgvector`

At startup, the composable host resolves module provider labels into capability factories and attaches tool providers/connectors/realizers.

## Stable provider labels

Current composable auto-attach provider labels:

- `memory-pgvector`
- `speech-surface`
- `mcp` (alias: `mcp-client`)

## Validation and failure model

Use `nerve-compose validate` as the preflight gate for package workflows:

- confirms required capabilities are resolvable
- reports resolved capability bindings
- fails early on unsupported provider labels or missing workspace setup

For memory capability, `MEMORY_DB_URL` must be provided through workspace environment before runtime use.

## Architecture boundary (unchanged)

The composable path still follows the same boundary:

- workflows express intent through stable tool contracts
- host capability adapters handle infrastructure behavior
- runtime execution remains deterministic and inspectable

## References

- [examples/composable-reference-host/server.js](../../examples/composable-reference-host/server.js)
- [src/host_core/composable_host.js](../../src/host_core/composable_host.js)
- [src/host_core/capabilities/storage.js](../../src/host_core/capabilities/storage.js)
- [src/host_core/providers/local_vector.js](../../src/host_core/providers/local_vector.js)
- [tests/composable_host.test.js](../../tests/composable_host.test.js)
- [tests/composable_reference_host_example.test.js](../../tests/composable_reference_host_example.test.js)
- [10-host-db-connectors-low-level.md](10-host-db-connectors-low-level.md)