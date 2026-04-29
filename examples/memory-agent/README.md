# Memory Agent

Minimal example workspace for semantic memory backed by PostgreSQL + pgvector.

## What It Demonstrates

- `memory_store` for storing text with embeddings
- `memory_retrieve` for semantic recall
- metadata filtering via separate workflow routes
- workspace-level provider registration through `host_modules/index.js`

## Workspace Files

- `nextv.json`: entrypoint and exposed externals
- `entry.nrv`: workflow with store and recall routes
- `host_modules/index.js`: opt-in registration for the memory provider

## Required Environment

Set these before starting the runtime:

- `MEMORY_DB_URL`: PostgreSQL connection string
- `MEMORY_EMBEDDING_MODEL`: Ollama embedding model name
- `MEMORY_EMBEDDING_BASE_URL`: optional Ollama base URL, defaults to `http://127.0.0.1:11434`

Optional:

- `MEMORY_POOL_MIN`
- `MEMORY_POOL_MAX`

## Database Notes

This example expects PostgreSQL with the `pgvector` extension available.

Example setup:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The provider creates the `memory` table lazily on first use.

## Run

From repository root:

```powershell
$env:MEMORY_DB_URL = 'postgres://localhost/nerveflow_memory'
$env:MEMORY_EMBEDDING_MODEL = 'mistral-embed'
node bin/nerve-runtime.js start examples/memory-agent --port 4190
```

In another terminal, listen for results:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws listen
```

## Example Commands

Store a factual note:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue remember_fact "PostgreSQL plus pgvector supports semantic recall."
```

Store a reusable pattern:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue remember_pattern "Use metadata filters to narrow retrieval by category."
```

Recall across all stored memories:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue recall_memory "semantic search with postgres"
```

Recall only stored patterns:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue recall_patterns "filters by category"
```

## Behavior

- `remember_fact` stores the incoming event text with `metadata.category = "fact"`
- `remember_pattern` stores the incoming event text with `metadata.category = "pattern"`
- `recall_memory` performs unrestricted semantic retrieval
- `recall_patterns` performs semantic retrieval filtered to `category = "pattern"`
