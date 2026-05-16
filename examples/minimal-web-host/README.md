# Minimal Web Host Example

This example shows how to host `nerveflow` with Express.

It is intentionally small and tool-like: a script editor, a message input, and a runtime snapshot panel.

## Run

1. Install dependencies from this folder:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open the UI:

- `http://127.0.0.1:4173`

4. Run the default workflow from the UI:

- The default event message is `hello nerve`.
- `Run` executes the current script against `/run`.
- `Reset` reloads the demo script and clears local UI state/output.

5. Run the default workflow from CLI:

```bash
curl -X POST http://127.0.0.1:4173/run -H "Content-Type: application/json" -d "{}"
```

6. Run with a custom inline workflow:

```bash
curl -X POST http://127.0.0.1:4173/run -H "Content-Type: application/json" -d "{\"source\":\"state.total_messages = state.total_messages + 1\\nstate.last_message = event.value\\noutput text \\\"Messages processed: \\${state.total_messages}\\\"\",\"state\":{\"total_messages\":0,\"last_message\":\"\"},\"event\":{\"type\":\"user_message\",\"value\":\"hello nerve\"}}"
```

## Endpoints

- `GET /health`
- `POST /run`

`POST /run` body fields:

- `source`: optional string script source
- `event`: optional object, defaults to `{ "type": "user_message", "value": "hello nerve" }`
- `state`: optional object initial state, defaults to `{ "total_messages": 0, "last_message": "" }`

Notes:

- The browser UI keeps state between `Run` clicks using the previous `/run` response state.
- API calls are stateless unless you pass `state` explicitly.
