# nerve-studio

**Reference web host for the Nerveflow runtime**

---

## What this is

`nerve-studio` is the canonical web-based host implementation for Nerveflow.

It demonstrates how a host integrates with the runtime:

- executes workflows on incoming events
- persists and reloads state between runs
- renders the runtime event stream (output, tools, agents)
- provides an interactive UI for developing and testing workflows

This is not just a UI - it is a **working host adapter**.

---

## Architecture role

In Nerveflow:

- the **runtime** is deterministic and host-agnostic
- the **host** provides:
  - state persistence
  - tool and agent integrations
  - event ingress
  - UI and output rendering

`nerve-studio` implements that host layer in a browser-based environment.

---

## What's included

- Static UI (`public/`)
  - editor, output panel, graph view
- Lightweight preview server (`preview-server.js`)
- Event-driven interaction model (UI -> runtime -> UI)

---

## What's NOT included (yet)

- Tool adapters
- Persistent runtime state storage

These are intentionally left out to keep the host boundary explicit.

---

## Run locally

Installable path (preferred):

```bash
npx nerve-studio
```

Repository-local alternative:

```bash
node nerve-studio/preview-server.js
```

Open:

```text
http://localhost:4173
```

### Run as remote MQTT observability surface

Remote mode is explicit per launch.

```bash
npx nerve-studio --remote --remote-mqtt mqtt://localhost:1883
```

Repository-local alternative:

```bash
node nerve-studio/preview-server.js --remote --remote-mqtt mqtt://localhost:1883
```

Optional topic prefix override:

```bash
npx nerve-studio --remote --remote-mqtt mqtt://localhost:1883 --remote-mqtt-topic-prefix nextv/event
```

Repository-local alternative:

```bash
node nerve-studio/preview-server.js --remote --remote-mqtt mqtt://localhost:1883 --remote-mqtt-topic-prefix nextv/event
```

You can also use environment fallback for the broker URL:

```powershell
$env:NERVE_STUDIO_REMOTE_MQTT = 'mqtt://localhost:1883'
npx nerve-studio --remote
```

Notes:

- without `--remote`, nerve-studio runs in local mode
- MQTT remote mode is read-only (start/stop/enqueue are disabled in UI and return 405 on API)

### Run as remote WS full-control surface

Attach Studio directly to a standalone runtime websocket endpoint:

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Repository-local alternative:

```bash
node nerve-studio/preview-server.js --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Or use env fallback:

```powershell
$env:NERVE_STUDIO_REMOTE_WS = 'ws://127.0.0.1:4190/api/runtime/ws'
npx nerve-studio --remote
```

Notes:

- WS remote mode allows full control from Studio UI/API (start/stop/enqueue/snapshot)
- MQTT and WS remote options are mutually exclusive per launch

### First-class attach mode (from local Studio)

When Studio is launched in local mode (no `--remote-ws`), the UI runtime target now includes **attach WS runtime**.

- choose runtime target: `attach WS runtime`
- set attach ws url (for example: `ws://127.0.0.1:4190/api/runtime/ws`)
- click `attach` to handshake against snapshot and bind UI controls
- click `detach` to unbind UI controls without stopping the remote runtime
- Studio controls that runtime over WS without spawning or owning its process lifecycle

Attach URL precedence:

1. UI value (sent as `attachWsUrl` query parameter)
2. `NERVE_STUDIO_ATTACH_WS` env default

Notes:

- `run`/`kill` remain external-process-only controls
- attach mode supports control operations like start/stop/enqueue/snapshot
- existing `--remote-ws` launch mode continues to work unchanged

---

## Workspaces

Use two workspace paths depending on purpose:

- Public canonical examples: `nerve-studio/examples`
  - includes: `hello-router.nrv`, `signal-queue-pattern.nrv`, `stateful-pipeline.nrv`
  - safe to commit and share
- Private local testing: `nerve-studio/workspaces-local`
  - local scratch area for experiments
  - ignored in this clone via `.git/info/exclude`

Set the workspace directory in the UI to either path above.

---

## Status

Early reference implementation.

This will evolve into **Nerve Studio**, the primary interface for building and running Nerveflow workflows.

---

## Why this matters

This project shows how to build a host around Nerveflow.

If you want to:

- build your own UI
- integrate Nerveflow into a service
- understand the runtime/host boundary

-> start here.
