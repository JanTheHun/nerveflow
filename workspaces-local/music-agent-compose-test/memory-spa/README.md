# memory-spa

Minimal browser UI for the music-agent memory store.

## What it does

- **Remember** — paste any text (e.g. a band description) and optional JSON metadata, then hit **Save to Memory**. The text is embedded and stored in the Postgres+pgvector table via the `remember_music` external event.
- **Recall** — type a semantic query and hit **Recall** to retrieve the closest stored entries via the `recall_music` external event.

## Prerequisites

- The music-agent runtime is running on port 4190 (nerve-studio or `bin/nerve-runtime.js`).
- Postgres+pgvector is reachable (configured in `../.env`).
- Ollama is running with `nomic-embed-text:latest` pulled.

## Run

```bash
node memory-spa/server.js
```

Opens at **http://127.0.0.1:4320** (override port with `$env:PORT`).

## Metadata field

The metadata textarea accepts any JSON object. Default:

```json
{ "category": "music", "songList": [] }
```

Whatever you pass is stored alongside the embedding and used as a filter on recall when provided.

