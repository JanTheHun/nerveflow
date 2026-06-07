# Nerveflow Runtime Surface (AV1)

Protocol-only VS Code surface for Architecture Validation 1.

## Scope

Implemented in this MVP:

- Activity bar container: Nerveflow
- Sidebar runtime view with connect/disconnect
- Send `user_message` via `enqueue_event`
- Receive and display runtime events:
  - `nextv_execution`
  - `nextv_runtime_event`
  - `nextv_error`
- Refresh and display raw `snapshot` JSON

Out of scope:

- Workflow graph, replay, call inspector, state editing, runtime process management

## Run

From this extension folder:

```bash
npm install
npm run check:boundaries
```

## Run In Extension Development Host

1. Open `extensions/vscode-runtime-surface` as its own VS Code workspace.
2. Open Run and Debug.
3. Select `Run AV1 Extension`.
4. Start debugging (F5).
5. In the Extension Development Host window, open the Nerveflow activity bar icon.

If you prefer command palette flow, run `Debug: Select and Start Debugging` and choose `Run AV1 Extension`.

## Settings

- `nerveflow.runtimeEndpoint` (default: `ws://127.0.0.1:4190/api/runtime/ws`)

In the sidebar UI, the `Endpoint Setting` button opens this setting directly.

## Manual Validation

1. Connect to runtime endpoint.
2. Send a user message.
3. Observe stream events in the sidebar and output channel.
4. Refresh snapshot and inspect raw JSON.
5. Run boundary check and capture output.

## Optional: Package As VSIX

From this extension folder:

```bash
npx @vscode/vsce package
```

Then in VS Code:

1. Open Extensions view.
2. Use `...` menu -> `Install from VSIX...`.
3. Select the generated `.vsix` file.

## Boundary Assurance

See [BOUNDARY_POLICY.md](./BOUNDARY_POLICY.md) and `npm run check:boundaries`.
