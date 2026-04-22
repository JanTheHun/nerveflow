# Getting Started

## 1. Install

```bash
npm install nerveflow
```

## 2. Write your first script

```wfs
state.count = state.count + 1

on external "user_message"
  output text "count=${state.count}"
end
```

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
on external "user_message"
  output text "count=${state.count}"
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
