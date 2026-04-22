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

```bash
node nerve-studio/preview-server.js
```

Open:

```text
http://localhost:4173
```

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
