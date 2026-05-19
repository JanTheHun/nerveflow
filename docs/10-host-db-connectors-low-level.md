# Host DB Connectors (Low-Level Mode)

This page documents the low-level host-modules composition path for PostgreSQL + pgvector capability wiring.

For the recommended package-first path, start with [10-host-db-connectors.md](10-host-db-connectors.md).

## When to use low-level mode

Use this mode when you need manual control over provider composition, custom workspace host module wiring, or provider internals beyond composable auto-attach labels.

## Architectural split

The implementation uses three layers:

1. `host_core`
2. `host-modules`
3. workspace host module composition

Each layer has a specific responsibility.

## 1. host_core: execution substrate, not database logic

`host_core` remains a generic execution substrate.

It provides:

- tool runtime composition
- host adapter boundaries
- event and execution transport
- runtime command routing and surface plumbing

Conceptually:

```js
import { createToolRuntime } from 'nerveflow/host_core'
import { loadHostModules } from 'nerveflow/host-modules'

const providers = await loadHostModules({ workspaceDir })
const toolRuntime = createToolRuntime({ providers })
```

The runtime evaluator and workflow language do not need database-specific branching.

## 2. host-modules: capability composition layer

The database integration is implemented as a public provider in [../src/host_modules/public/memory_provider.js](../src/host_modules/public/memory_provider.js).

`createMemoryProvider(config)` exposes two workflow-callable tools:

- `memory_store`
- `memory_retrieve`

Provider responsibilities include:

- lazy PostgreSQL pool setup via `pg`
- idempotent `pgvector` extension/table/index setup
- embedding generation via configured embedding service
- insert and similarity retrieval with metadata filters

This keeps infrastructure semantics in capability adapters, not in runtime core.

## 3. Workspace composition: bind concrete infrastructure

The example workspace [../examples/memory-agent/host_modules/index.js](../examples/memory-agent/host_modules/index.js) binds real infrastructure.

Typical shape:

```js
export function createProviders() {
  return [
    createMemoryProvider({
      pgUrl: process.env.MEMORY_DB_URL,
      embeddingModel: process.env.MEMORY_EMBEDDING_MODEL,
      embeddingBaseUrl: process.env.MEMORY_EMBEDDING_BASE_URL,
      embeddingDimensions: Number(process.env.MEMORY_EMBEDDING_DIMENSIONS ?? 768),
      poolMin: Number(process.env.MEMORY_POOL_MIN ?? 2),
      poolMax: Number(process.env.MEMORY_POOL_MAX ?? 10),
    }),
  ]
}
```

This is where host-specific details belong.

## Tool contract at workflow layer

Workflows call tools by contract and do not depend on SQL or driver APIs.

```nrv
stored = tool("memory_store", {
  text: event.value,
  metadata: {
    category: "fact"
  }
})

results = tool("memory_retrieve", {
  query_text: event.value,
  limit: 5
})
```

## Operational friction points addressed

- workspace env binding for credentials and embedding settings
- provider argument shape normalization (`named` and `positional`)
- embedding endpoint compatibility (`/api/embed`, `/api/embeddings`, `/v1/embeddings`)
- embedding dimension mismatch resolved through explicit config

## Files involved

- [../src/host_modules/public/memory_provider.js](../src/host_modules/public/memory_provider.js)
- [../src/host_modules/public/index.js](../src/host_modules/public/index.js)
- [../src/host_modules/README.md](../src/host_modules/README.md)
- [../tests/memory_provider.test.js](../tests/memory_provider.test.js)
- [../tests/host_modules.test.js](../tests/host_modules.test.js)
- [../examples/memory-agent/host_modules/index.js](../examples/memory-agent/host_modules/index.js)
- [../examples/memory-agent/entry.nrv](../examples/memory-agent/entry.nrv)

## Design takeaway

For low-level mode:

1. keep `host_core` generic
2. implement capability as a provider in host-modules
3. bind concrete infrastructure in workspace composition
4. expose stable tool contracts to workflows

This preserves deterministic runtime behavior while allowing custom infrastructure integration.