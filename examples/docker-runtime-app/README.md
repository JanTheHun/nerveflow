# Docker Runtime App Example

This workspace is the smallest deployable app example for the Docker runtime container.

It is designed to run with the root `Dockerfile` and `docker-compose.yml`.

## Run with Docker Compose

```bash
docker compose up --build
```

Then call the runtime ingress endpoint:

```bash
curl -X POST http://127.0.0.1:4190/api/runtime/ingress \
  -H "Content-Type: application/json" \
  -d '{"type":"user_message","value":"hello from docker"}'
```

## Files

- `nextv.json` declares the entrypoint and accepted external events
- `workflow.nrv` is the deployed workflow app
- `state.init.json` seeds initial state for the first boot

The entire directory is mounted into the container as `/workspace`.