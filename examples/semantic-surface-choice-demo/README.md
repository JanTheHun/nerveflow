# Semantic Surface Choice Demo

Minimal workspace demonstrating the semantic-surface MVP authoring pattern.

Current scope:

- Externals: `user_message`, `semantic_surface_event`
- Effect channel: `semantic_surface`
- Interaction type: `choice`

## Files

- `nerve.json`: workspace config and declared effect channel
- `workflow.nrv`: emits semantic choice intent and handles semantic reply ingress
- `state.init.json`: initial demo state

## Run with standalone runtime

From repository root:

```powershell
node bin/nerve-runtime.js start examples/semantic-surface-choice-demo --port 4190
```

In another terminal, send the initial event:

```powershell
node bin/nerve-send.js ws://127.0.0.1:4190/api/runtime/ws user_message "open choice"
```

Then submit a semantic reply event:

```powershell
node bin/nerve-send.js ws://127.0.0.1:4190/api/runtime/ws semantic_surface_event "{\"interactionId\":\"confirm_delete_1\",\"target\":\"main\",\"action\":\"selected\",\"payload\":{\"selected\":\"yes\"}}"
```

Expected behavior:

1. The first event emits a `semantic_surface` output payload for a choice interaction.
2. The second event drives the workflow through semantic ingress only.
3. The runtime emits deterministic observable events for both steps.
