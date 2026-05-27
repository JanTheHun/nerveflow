# memory-spa

Workflow-independent memory CRUD UI backed by pgvector.

## Prerequisite

Run this first in your workspace:

```bash
npx nerve-compose add memory-pgvector
```

That command scaffolds memory provider binding and memory env keys.

## Run

```bash
node memory-spa/server.mjs
```

Defaults:

- workspace discovery: parent directory (or set `WORKSPACE_DIR`)
- http url: `http://127.0.0.1:4320`

## API endpoints

- `POST /api/memory/store`
- `POST /api/memory/recall`
- `POST /api/memory/update`
- `POST /api/memory/delete`
- `GET /health`
