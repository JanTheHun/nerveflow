# News Agent Voice SPA

Browser microphone bridge for the news-agent workflow.

## What It Does

- Accepts audio from the browser at `POST /api/voice-command`
- Transcribes speech with Whisper
- Dispatches transcript to Nerveflow ingress (`user_message` by default)
- Streams workflow output and synthesizes voice with Piper
- Serves the SPA UI from `public/`

## Transport Policy

`VOICE_TRANSPORT_MODE` controls runtime transport behavior:

- `ws-only`: Use runtime WS protocol only. Fail fast on WS errors.
- `ws-fallback`: Prefer WS, then fall back to HTTP ingress/SSE on WS failure.
- `http-only`: Skip WS and always use HTTP ingress/SSE.

`/health` reports both policy and currently active transport.

## API

### `POST /api/voice-command`

- Content-Type must be `audio/*`
- Body must be non-empty
- Body size must be <= `VOICE_MAX_AUDIO_BYTES`
- Rate limiting is enforced per source IP:
  - window: `VOICE_RATE_LIMIT_WINDOW_MS`
  - max requests: `VOICE_RATE_LIMIT_MAX_REQUESTS`

Success response:

```json
{
  "ok": true,
  "transcript": "show urgent headlines",
  "ingressName": "user_message",
  "runtime": { "ok": true }
}
```

Error response:

```json
{
  "ok": false,
  "error": "Audio payload is empty.",
  "code": "empty_audio_payload",
  "retryable": false,
  "stage": "ingress",
  "transportMode": "ws"
}
```

### `GET /api/output/stream`

SSE endpoint that emits `voice_output` events:

```json
{
  "text": "3 urgent news",
  "audioBase64": "..."
}
```

### `GET /health`

Returns runtime endpoints, transport policy/mode, limits, and dependency configuration checks.

## Setup

1. Copy `.env.example` to `.env` and fill your local Whisper/Piper paths.
2. Start runtime and load the news-agent workspace.
3. Start this server:

```bash
node server.js
```

4. Open `http://127.0.0.1:4318`.

## Notes

- `.env` is local-only and should not be committed.
- Keep model/runtime paths machine-local and portable in docs.
