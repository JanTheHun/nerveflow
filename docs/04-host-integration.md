# Host Integration Guide

Nerveflow is host-agnostic. A host integrates runtime execution with real tools, model calls, and external events.

## Minimal integration shape

```js
import { runNextVScript } from 'nerveflow'

const result = await runNextVScript(source, {
  state,
  event,
  hostAdapter: {
    async callTool(name, args) {
      // Your tool runtime
    },
    async callAgent(prompt, options) {
      // Your model runtime
    },
    async callScript(path, state) {
      // Nested script execution
    },
    resolveOperatorPath(operatorId) {
      // Optional operator path resolution
    },
    onEvent(eventRecord) {
      // Optional event stream hook
    },
  },
})
```

## Recommended host responsibilities

- Validate and sanitize external input events
- Implement deterministic tool permission boundaries
- Store and restore `state` if workflows are long-lived
- Capture runtime event logs for debugging
- Enforce timeout/step limits around script execution

## Reference implementation

See `examples/minimal-web-host/server.js`.
