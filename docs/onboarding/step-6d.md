# Onboarding Step 6D

Add the semantic-surface capability and test a semantic interaction loop.

This step uses the composable host boundary to attach an interactive surface without pushing browser mechanics into the runtime.

Your workflow remains deterministic.
The surface realizes semantic intent and returns semantic ingress.

## What you will add

- semantic-surface capability bindings in `nerve.json` (or `nextv.json`)
- a scaffolded surface under `semantic-surface/`
- a capability module under `capabilities/semantic-surface/`
- one semantic `choice` interaction you can emit and verify end to end

## Requirements

- You completed Step 5 and can run the host (`node host/server.mjs --hot-swap`)
- Your workspace can already receive declared external events through the runtime WS surface
- You want an attachable interactive surface without changing workflow grammar

## 1. Scaffold semantic-surface

From your workspace root:

```bash
npx nerve-compose add semantic-surface
```

This scaffolds:

- `semantic-surface/server.js`
- `semantic-surface/public/*`
- `semantic-surface/.env.example`
- `semantic-surface/package.json` (`type: module`)
- `capabilities/semantic-surface/server.mjs`

It also updates workspace capability config:

- `requires["semantic-surface"].provider = "semantic-surface"`
- `modules["semantic-surface"].provider = "semantic-surface"`
- `effects["semantic_surface"] = { kind: "surface", format: "json" }`
- `externals` includes `semantic_surface_event`

## 2. Confirm the capability boundary

Semantic-surface is not a new workflow grammar feature.

The workflow emits a declared custom effect channel.
The host realizes that effect into a UI surface.
The surface sends semantic ingress back.

For MVP, keep scope narrow:

- one interaction type: `choice`
- one target: `main`
- one ingress event: `semantic_surface_event`

## 3. Verify declared semantic effect and ingress channels

`nerve-compose add semantic-surface` now upserts these declarations automatically.

In your `nerve.json`, verify the custom effect channel and external ingress are present:

```json
{
  "entrypointPath": "workflow.nrv",
  "externals": ["user_message", "semantic_surface_event"],
  "effects": {
    "semantic_surface": {
      "kind": "surface",
      "format": "json"
    }
  }
}
```

If you are still on compatibility config, the same shape works in `nextv.json`.

## 4. Add a minimal semantic choice flow

In your `workflow.nrv`, emit semantic intent on a normal external event:

```nrv
on external "user_message"
  if event.value == "open choice"
    output semantic_surface {
      schemaVersion: "1.0",
      capability: "semantic-surface",
      effectName: "semantic_surface",
      interactionId: "confirm_delete_1",
      target: "main",
      intent: {
        type: "choice",
        text: "Delete reminders?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" }
        ]
      },
      timestamp: "2026-05-29T12:00:00Z",
      runtimeEventId: "demo_confirm_delete_1"
    }

    output text "choice opened"
  end
end

on external "semantic_surface_event"
  if event.value.action == "selected" && event.value.payload.selected == "yes"
    output text "confirmed yes"
  else if event.value.action == "selected" && event.value.payload.selected == "no"
    output text "confirmed no"
  else
    output text "interaction updated"
  end
end
```

This is the key design rule:

- runtime sees semantic intent and semantic reply
- runtime does not see DOM clicks, browser focus changes, or component state

## 5. Start the host and the surface

Terminal A (host/runtime):

```bash
node host/server.mjs --hot-swap
```

Terminal B (semantic surface scaffold):

```bash
cd semantic-surface
node server.js
```

Open:

`http://127.0.0.1:4180`

If you changed `SEMANTIC_SURFACE_PORT`, use that port instead.

The preview page subscribes to `ws://127.0.0.1:4180/api/semantic-surface/ws`
for live interaction updates and sends choice clicks back through the same
socket.

If `RUNTIME_WS_URL` is set for the scaffold server, those clicks are relayed to
the runtime websocket as real `dispatch_ingress` commands.

## 6. Test the semantic output

From another terminal, trigger the workflow branch:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "open choice"
```

What to verify:

1. The runtime emits a `semantic_surface` output event.
2. The payload includes `interactionId`, `target`, and `intent.type = "choice"`.
3. The host effect realizer accepts the declared channel.
4. The browser surface updates live over websocket rather than polling.
5. If configured, semantic choice clicks dispatch into the runtime over ws.

If you want a known-good example, see:

- [../../examples/semantic-surface-choice-demo/README.md](../../examples/semantic-surface-choice-demo/README.md)

## 7. Test semantic ingress

Now send the semantic reply event back into runtime:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws semantic_surface_event "{\"interactionId\":\"confirm_delete_1\",\"target\":\"main\",\"action\":\"selected\",\"payload\":{\"selected\":\"yes\"}}"
```

Expected behavior:

1. The runtime queues `semantic_surface_event` as an external event.
2. The workflow takes the semantic branch.
3. Output becomes `confirmed yes`.

The choice buttons on the preview page now send `semantic_surface_event`
ingress directly when clicked.

With `RUNTIME_WS_URL` configured, those clicks are forwarded to runtime rather
than only updating the local preview state.

Repeat with `no` and confirm the other branch.

## 8. What to inspect

If you are also running Nerve Studio or listening to runtime events, inspect:

- `nextv_effect_realized`
- `nextv_ingress_dispatched`
- output events on `semantic_surface`
- output events on `text`

This is the MVP proof that the loop closes:

`workflow output -> semantic surface realization -> semantic ingress -> deterministic workflow continuation`

## 9. Troubleshooting

- If runtime rejects `semantic_surface`, make sure the effect channel is declared in `nerve.json`.
- If runtime rejects `semantic_surface_event`, make sure it is declared in `externals`.
- If direct script validation fails with `INVALID_OUTPUT_FORMAT`, pass custom `effectChannels` at the top level of runtime options.
- If the host starts but surface files do not exist, rerun `npx nerve-compose add semantic-surface` from the workspace root.

## 10. What you learned

1. Semantic-surface attaches at the host boundary, not inside workflow grammar.
2. The runtime remains deterministic while the surface remains replaceable.
3. Semantic ingress is the stable boundary; browser mechanics stay local to the surface.
4. A testable MVP only needs one interaction type to prove the architecture.

Minimal surface. Composable depth.

## Next

Explore adjacent capability paths:

- [Step 6 A](step-6a.md) — Add a vector database for real RAG
- [Step 6 B](step-6b.md) — Add speech capability
- [Step 6 C](step-6c.md) — Add MCP servers

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).