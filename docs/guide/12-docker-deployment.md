# Docker Deployment

This guide shows the first supported Docker deployment story for a Nerveflow workflow app.

The container runs the standalone runtime from [../../bin/nerve-runtime.js](../../bin/nerve-runtime.js) and mounts one workflow workspace as the app.

## Deployment Contract

One container runs one workspace.

Required workspace files:

- `nerve.json` (or `nextv.json` for compatibility)
- one workflow entrypoint such as `workflow.nrv`

Optional workspace files:

- `.env`
- `host_modules/`
- `state.json`
- `state.runtime.json`
- `state.init.json`

The runtime only accepts workspace-relative paths, so the container entrypoint changes into the mounted workspace and starts `.` from there.

## Runtime Surface

The deployed app exposes:

- `GET /health`
- `POST /api/runtime/ingress`
- `ws://<host>:<port>/api/runtime/ws`

The container entrypoint uses these defaults:

- `PORT=4190`
- `WS_PATH=/api/runtime/ws`
- `WORKSPACE_DIR=/workspace`

Optional overrides:

- `ENTRYPOINT_PATH` to override `nerve.json#entrypointPath` (or `nextv.json#entrypointPath`)
- `NO_AUTOSTART=1` to boot the server without automatically starting the workflow runtime

## Build The Image

From the repository root:

```bash
docker build -t nerveflow-workflow-app .
```

## Run A Workflow App

Mount a workflow workspace into `/workspace`:

```bash
docker run --rm -p 4190:4190 \
  -v "$PWD/examples/docker-runtime-app:/workspace" \
  nerveflow-workflow-app
```

Then send an ingress event:

```bash
curl -X POST http://127.0.0.1:4190/api/runtime/ingress \
  -H "Content-Type: application/json" \
  -d '{"type":"user_message","value":"hello from docker"}'
```

The workspace mount is also the persistence boundary for state files.

## Docker Compose

The repository root includes a minimal [../../docker-compose.yml](../../docker-compose.yml) example.

It mounts [../../examples/docker-runtime-app](../../examples/docker-runtime-app) into the container and exposes the runtime on port `4190`.

Start it with:

```bash
docker compose up --build
```

## Agent Workflows

The example workspace does not require a model backend.

For workflows that call `agent(...)`, provide the usual runtime transport env vars to the container, for example:

- `AGENT_TRANSPORT`
- `OLLAMA_BASE_URL`
- `LLAMA_CPP_BASE_URL`
- OpenAI-compatible transport configuration defined by your workspace config

The runtime loads `.env` from the workspace root before startup, so per-app deployment config can live with the workflow workspace when appropriate.

## State Files

State discovery follows the existing runtime rules:

- prefer explicit state path if one is configured
- otherwise discover `state.runtime.json`, `state.json`, and `state.init.json` from the workspace/entrypoint base rules

For Docker deployments, keep the workspace mounted on persistent storage if the app must retain state between restarts.

## What MVP Does Not Cover

This first Docker deployment slice does not attempt to solve:

- multi-instance coordination
- distributed state
- Studio deployment
- bundled model inference
- workflow hot reload
- auth, TLS, or reverse-proxy hardening
- orchestration-specific packaging such as Kubernetes manifests

## Example Workspace

Use [../../examples/docker-runtime-app](../../examples/docker-runtime-app) as the starting point for a workflow app that is meant to be deployed as a containerized service.