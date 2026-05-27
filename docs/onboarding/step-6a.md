# Onboarding Step 6A

Add a vector database for real RAG (Retrieval-Augmented Generation).

This step uses the composable-reference-host to integrate a vector database.

## Requirements

- Running Postgres instance with vector support
- Host started with composable capability auto-attach

## 1. Add memory capability

```bash
npx nerve-compose add memory-pgvector
```

## 2. Set environment variables

Set these values in `.env`:

```bash
MEMORY_DB_URL=postgres://user:pass@db.example.invalid:5432/mock_memory
MEMORY_EMBEDDING_MODEL=nomic-embed-text:latest
MEMORY_EMBEDDING_BASE_URL=https://embedding.example.invalid/v1
MEMORY_EMBEDDING_API_KEY=sk-example-invalid
MEMORY_EMBEDDING_DIMENSIONS=768
MEMORY_POOL_MIN=2
MEMORY_POOL_MAX=10
```

<details>
<summary>environment variables policy</summary>

When you scaffold memory with `nerve-compose add memory-pgvector`, compose appends missing memory keys to both `.env.example` and `.env`.
Generated `.env` sensitive fields use mock placeholder values and must be replaced for real database or embedding service usage.
Use `--blank` if you want sensitive fields scaffolded as empty values instead (for example, `npx nerve-compose add memory-pgvector <workspaceDir> --blank`).

</details>

## 3. Use memory in your script

Use metadata-filtered retrieval like the working example:

```nrv
music_filter = { category: "music" }
music_result = tool("memory_retrieve", {
    query_text: event.value,
    limit: 5,
    filter_metadata: music_filter
})

lights_filter = { category: "lights" }
lights_result = tool("memory_retrieve", {
    query_text: event.value,
    limit: 5,
    filter_metadata: lights_filter
})

limit = 0.7

relevant_music = cut(music_result.items, "similarity", ">=", limit)
music = to_json(relevant_music)

relevant_lights = cut(lights_result.items, "similarity", ">=", limit)
lights = to_json(relevant_lights)

decision = model(
    "gpt-4o-mini",
    "knowledge retrieval result: lights:${lights}, music: ${music}, user prompt:${event.value}",
    "Decide workflow branching based on relevant knowledge retrieved. Only choose music if there is relevant knowledge from music category. Only choose lights if there is relevant knowledge from lights category. Otherwise choose chat.",
    decide=["chat","music","lights"],
    retry_on_contract_violation=1
)
```

`filter_metadata` must be an object map, not a string.

## 4. Verify

Send an event to your running host and confirm retrieval executes:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "play garbage"
```
As long as your vector DB is empty, model should always choose `chat` branch.

## 5. Add knowledge chunks

You can easily add knowledge chunks with the provided memory SPA:

```bash
npx nerve-compose add memory-spa
node memory-spa/server.mjs
```

Open `http://127.0.0.1:4320` and use store/recall/update/delete directly against the configured memory database.

Add a chunk with:
- category: `music`
- text: `garbage`

![alt text](image.png)


## 6. Test again

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "play garbage"
```

Even weak local models become dramatically more reliable once retrieval narrows the ambiguity space before bounded routing.


## Next

Add other capabilities:

- [step 6 B](step-6b.md) — Add speech capability
- [step 6 C](step-6c.md) — Add MCP servers


---
If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
