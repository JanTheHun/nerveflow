# Minimal Web Host Example

This example shows how to host `nerveflow` with Express.

## Run

1. Install dependencies from this folder:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Run the default workflow:

```bash
curl -X POST http://127.0.0.1:4173/run -H "Content-Type: application/json" -d "{}"
```

4. Run with a custom inline workflow:

```bash
curl -X POST http://127.0.0.1:4173/run -H "Content-Type: application/json" -d "{\"source\":\"state.count = state.count + 1\\noutput text \\\"count=${state.count}\\\"\"}"
```

## Endpoints

- `GET /health`
- `POST /run`

`POST /run` body fields:

- `source`: optional string script source
- `event`: optional object, defaults to `{ "type": "user_message", "value": "hello" }`
- `state`: optional object initial state
