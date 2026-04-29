# Host DB Connectors

This page describes how we added a real PostgreSQL + pgvector capability to Nerveflow without pushing database concerns into the runtime core.

The result is a useful proof point for the platform architecture: the runtime stayed deterministic, the host substrate stayed generic, and the database behavior lived in host modules where it belongs.

## Architectural split

The implementation used three layers:

1. `host_core`
2. `host-modules`
3. a workspace host module composition layer

Each layer had a different job.

## 1. host_core: execution substrate, not database logic

`host_core` was not turned into a database framework.

It already provided the execution substrate we needed:

- tool runtime composition
- host adapter boundaries
- event and execution transport
- runtime command routing and surface plumbing

That separation mattered. The database connector did not require special cases in the runtime evaluator or workflow language. The workflow still called tools through the existing `tool(...)` boundary.

Conceptually:

```js
import { createToolRuntime } from 'nerveflow/host_core'
import { loadHostModules } from 'nerveflow/host-modules'

const providers = await loadHostModules({ workspaceDir })
const toolRuntime = createToolRuntime({ providers })
```

The important point is that `host_core` stayed responsible for orchestration, not persistence semantics.

## 2. host-modules: capability composition layer

The database integration was implemented as a public host module provider in [src/host_modules/public/memory_provider.js](../src/host_modules/public/memory_provider.js).

That provider exports `createMemoryProvider(config)`, which returns two workflow-callable tools:

- `memory_store`
- `memory_retrieve`

This is the key architectural move: the connector is expressed as a host capability, not as a runtime feature.

Responsibilities inside the provider:

- open a lazy PostgreSQL pool with `pg`
- create the `vector` extension if needed
- create the `memory` table and indexes idempotently
- turn text into embeddings through Ollama
- insert text, embedding, and metadata
- run similarity search with optional metadata filters

Because this is a provider, any workspace can opt in by composing it, and the runtime does not need to know anything about PostgreSQL, `pgvector`, connection strings, or embedding APIs.

## 3. Workspace composition: bind concrete infrastructure

The example workspace in [examples/memory-agent/host_modules/index.js](../examples/memory-agent/host_modules/index.js) is where generic capability became a real connector.

That file does three things:

1. loads workspace-local environment values
2. instantiates `createMemoryProvider(...)`
3. binds concrete infrastructure settings like DB URL, embedding model, and embedding dimensions

Example shape:

```js
export function createProviders() {
  return [
    createMemoryProvider({
      pgUrl: process.env.MEMORY_DB_URL,
      embeddingModel: process.env.MEMORY_EMBEDDING_MODEL,
      embeddingBaseUrl: process.env.MEMORY_EMBEDDING_BASE_URL,
      embeddingDimensions: Number(process.env.MEMORY_EMBEDDING_DIMENSIONS ?? 768),
    }),
  ]
}
```

This is where host-specific reality belongs.

The runtime remains portable; the workspace chooses which infrastructure to attach.

## Tool contract at the workflow layer

The workflow in [examples/memory-agent/entry.nrv](../examples/memory-agent/entry.nrv) does not know about SQL or driver APIs.

It just calls tools:

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

This is exactly the boundary we want:

- workflows express intent
- host modules implement capability
- host_core executes deterministically

## What we had to solve in reality

This implementation was useful because it forced the architecture through real integration friction.

### Environment and workspace binding

We added workspace-local `.env` loading in the example workspace so local DB credentials and embedding settings stay outside the runtime core and outside committed shared config.

### Provider input normalization

Tool providers needed to handle the actual runtime call shape (`positional` and `named`) as well as direct test invocation shape. That normalization belongs in the provider boundary, not in the runtime language.

### Embedding API compatibility

Different Ollama setups exposed different embedding routes. The provider now probes compatible endpoint shapes:

- `/api/embed`
- `/api/embeddings`
- `/v1/embeddings`

Again, this logic stays in the capability adapter where transport differences belong.

### Embedding dimension mismatch

The first default assumption was `384`, but the installed embedding model returned `768` dimensions. The fix was not to weaken the contract. The fix was to make dimensions configurable and let the workspace bind the correct value.

That preserved explicitness and surfaced bad assumptions early.

## Why this validates the platform

This connector is a concrete example of the platform surviving contact with real infrastructure.

We had to deal with:

- Docker Postgres credentials
- `pgvector` schema bootstrapping
- embedding model availability
- endpoint/version differences in Ollama
- real similarity search output and runtime traces

The architecture held up because responsibilities were separated correctly:

- `host_core` handled orchestration
- `host-modules` handled capability composition
- the workspace handled local infrastructure binding
- the workflow remained declarative and deterministic

## Files involved

- [src/host_modules/public/memory_provider.js](../src/host_modules/public/memory_provider.js)
- [src/host_modules/public/index.js](../src/host_modules/public/index.js)
- [tests/memory_provider.test.js](../tests/memory_provider.test.js)
- [examples/memory-agent/host_modules/index.js](../examples/memory-agent/host_modules/index.js)
- [examples/memory-agent/entry.nrv](../examples/memory-agent/entry.nrv)
- [examples/memory-agent/.env](../examples/memory-agent/.env)

## Design takeaway

If you want to add a database, queue, vector store, filesystem adapter, or external API to Nerveflow, the pattern is:

1. keep `host_core` generic
2. implement the capability as a host module provider
3. bind infrastructure details in workspace composition
4. expose only stable tool contracts to workflows

That gives you real integrations without contaminating the deterministic runtime with infrastructure-specific code.

This is an example of capability growth around a stable execution core, not feature growth inside the core.