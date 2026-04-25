# Getting Started

## 1. Install

```bash
npm install nerveflow
```

## 2. Write your first script

```wfs
state.count = state.count + 1
doubled = state.count * 2

on external "user_message"
  output text "count=${state.count}"
  output text "double=${doubled}"
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

## 4. Embed directly in Node.js

```js
import { runNextVScript } from 'nerveflow'

const source = `
state.count = state.count + 1
remaining = 5 - state.count
on external "user_message"
  output text "count=${state.count}"
  output text "remaining=${remaining}"
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

## 5. Run as a standalone runtime (optional)

Start the runtime process:

```bash
node bin/nerve-runtime.js start examples/mqtt-simple-host --port 4190
```

Attach from another terminal:

```bash
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws snapshot
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue user_message hello
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws stop
```

To watch runtime events continuously:

```bash
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws listen
```

For command semantics and transport details, see the host integration guide.

## 6. Attach Studio UI to the standalone runtime (optional)

With the runtime process running, attach Studio in remote WS full-control mode:

```bash
node nerve-studio/preview-server.js --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Open:

```text
http://localhost:4173
```

In this mode, Studio can observe and control the remote runtime (`start`, `stop`, `enqueue_event`, `snapshot`) through its existing UI and API surfaces.
