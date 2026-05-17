# Getting Started

## 1. Install

```bash
npm install nerveflow
```

## 2. Write your first script

```nrv
state.total_messages = state.total_messages + 1
state.last_message = event.value

on external "user_message"
  output text "messages=${state.total_messages}"
  output text "last=${state.last_message}"
end
```

Expressions support arithmetic directly, so you can write `+`, `-`, `*`, `/`, comparisons, and logical checks without helper calls.

## 3. Run with the reference web host

The repository includes a minimal host at `examples/minimal-web-host`.

```bash
cd examples/minimal-web-host
npm install
npm start
```

Then run the workflow:

```bash
curl -X POST http://127.0.0.1:4173/run -H "Content-Type: application/json" -d "{}"
```

The reference host defaults to event `{ "type": "user_message", "value": "hello nerve" }` and initial state `{ "total_messages": 0, "last_message": "" }` when omitted.

## 4. Embed directly in Node.js

```js
import { runNextVScript } from 'nerveflow'

const source = `
state.count = state.count + 1
remaining = 5 - state.count
on external "user_message"
  output text "count=\${state.count}"
  output text "remaining=\${remaining}"
end
`

const result = await runNextVScript(source, {
  state: { count: 0 },
  event: { type: 'user_message', value: 'hello' },
  hostAdapter: {
    async callTool({ name, args }) {
      return { name, args }
    },
    async callAgent({ prompt }) {
      return JSON.stringify({ status: 'ready', prompt })
    },
  },
})

console.log(result.state)
```

## 5. Model server (required for `agent()` calls)

Workflows that use `agent(...)` calls need a local model server reachable over HTTP. Nerveflow supports two transports, selected by the `AGENT_TRANSPORT` environment variable (default: `ollama`).

### Option A — Ollama (default, easiest)

**Install:**

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download the installer from https://ollama.com/download/windows
```

**Start and pull a model:**

```bash
ollama serve          # starts the server on http://127.0.0.1:11434
ollama pull llama3.2  # or any model from https://ollama.com/library
```

**Verify:**

```bash
npm run model:doctor -- --model llama3.2
```

### Option B — llama.cpp

**Install:**

```bash
# macOS
brew install llama.cpp

# Windows / Linux — download a prebuilt release binary:
# https://github.com/ggml-org/llama.cpp/releases
```

**Get a GGUF model and start the server:**

```bash
# Download a model (e.g. from https://huggingface.co/models?library=gguf)
llama-server --model /path/to/model.gguf --port 8080
```

**Verify:**

```bash
npm run model:doctor -- --transport llama.cpp
```

### Doctor command reference

```bash
# Check default transport (Ollama)
npm run model:doctor

# Check llama.cpp transport
npm run model:doctor -- --transport llama.cpp

# Check that a specific model is loaded
npm run model:doctor -- --model llama3.2

# Full smoke test — checks reachability, model presence, and a live chat round-trip
npm run model:doctor -- --model llama3.2 --ping
```

Exit code 0 means all required checks passed. Exit code 1 means something is missing; the output includes the exact install step to run next.

### Compose-assisted model setup (optional, onboarding-friendly)

You can scaffold transport and model registry entries directly in workspace config:

```bash
node bin/nerve-compose.js add transport ollama
node bin/nerve-compose.js add model llama3.2 --transport ollama
```

Then run the canonical doctor check:

```bash
npm run model:doctor -- --model llama3.2
```

---

## 6. Run as a standalone runtime (optional)

Bootstrap a minimal workspace in your current directory:

```bash
node bin/nerve-compose.js init
```

This creates `nerve.json` (preferred config filename), `workflow.nrv`, and `state.init.json` (baseline state) when they are missing. If only `nextv.json` already exists, `init` leaves it unchanged for compatibility.

Start the runtime process:

```bash
npx nerve-runtime start examples/mqtt-simple-host --port 4190
```

From within a valid workspace directory (contains `nerve.json` or `nextv.json`), you can start directly in the current folder:

```bash
npx nerve-runtime start --port 4190
```

Attach from another terminal:

```bash
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws snapshot
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws random_channel ping
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message ping
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello nerve"
```

Expected behavior:

- undeclared channel (`random_channel`) is rejected because it is not in workspace externals
- declared channel (`user_message`) with non-matching input increments state and returns `(no output, 1)`
- declared channel (`user_message`) with `hello nerve` returns `hello world!`

To watch runtime events continuously:

```bash
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws listen
```

For command semantics and transport details, see the host integration guide.

## 7. Attach Studio UI to the standalone runtime (optional)

With the runtime process running, attach Studio in remote WS full-control mode:

```bash
node nerve-studio/preview-server.js --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Open:

```text
http://localhost:4173
```

In this mode, Studio can observe and control the remote runtime (`start`, `stop`, `enqueue_event`, `snapshot`) through its existing UI and API surfaces.

Helper launcher (starts both runtime and Studio together):

```bash
node bin/nerve-dev-remote.js examples/mqtt-simple-host
```

When Studio reports ready, the launcher opens `http://127.0.0.1:4173` in your default browser.

Optional flags:

- `--entrypoint <path>` runtime entrypoint override
- `--runtime-port <n>` runtime HTTP/WS port (default `4190`)
- `--studio-port <n>` Studio UI port (default `4173`)
- `--ws-path <path>` runtime WS endpoint path (default `/api/runtime/ws`)
- `--no-open` disable automatic browser open
