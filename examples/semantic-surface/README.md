# Semantic Surface Scaffold

This template is used by `npx nerve-compose add semantic-surface`.

It creates:

- `semantic-surface/` UI shell and local preview server
- `capabilities/semantic-surface/server.mjs` connector/realizer module

The browser surface listens on a websocket channel and updates when the shared
semantic state changes, rather than polling the snapshot endpoint.

Start from your workspace root:

```bash
node semantic-surface/server.js
```

Then open:

```text
http://localhost:4180
```

For isolated tests, override `SEMANTIC_SURFACE_STATE_PATH` before starting the
server.
