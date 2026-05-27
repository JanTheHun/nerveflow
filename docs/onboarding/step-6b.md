# Onboarding Step 6B

Add speech input/output capability to your host.

This step uses the composable-reference-host to integrate speech input/output surfaces.

## What you will add

- a browser voice surface in `voice-spa/`
- shared speech runtime helpers in `capabilities/speech/server_lib.mjs`
- speech capability bindings in `nerve.json` (or `nextv.json`)

Your workflow remains deterministic.
Speech is attached at the host boundary.

## Requirements

- You completed Step 5 and can run the host (`node host/server.mjs --hot-swap`)
- A workflow is configured with at least one declared external input (for example `user_message`)
- Local Whisper and Piper binaries/models are available on your machine

## 1. Scaffold speech capability

From workspace root:

```bash
npx nerve-compose add speech
```

This scaffolds:

- `voice-spa/server.js`
- `voice-spa/public/*`
- `voice-spa/.env.example`
- `voice-spa/package.json` (`type: module`)
- `capabilities/speech/server_lib.mjs`

It also updates workspace capability config:

- `requires.speech.provider = "speech"`
- `modules.speech.provider = "speech-surface"`

## 2. Configure speech env (local to voice-spa)

Copy `voice-spa/.env.example` to `voice-spa/.env` and set machine-local paths.

Example local settings:

```bash
PORT=4318
RUNTIME_INGRESS_URL=http://127.0.0.1:4190/api/runtime/ingress
RUNTIME_SSE_URL=http://127.0.0.1:4190/api/runtime/stream
VOICE_INGRESS_NAME=user_message
VOICE_OUTPUT_CHANNEL=voice
WHISPER_RUN_PATH=C:/path/to/whisper-cli.exe
WHISPER_MODEL=C:/path/to/ggml-base.en.bin
WHISPER_RUN_ARGS=-m "{model}" -oj -of "{output}" -f "{input}"
PIPER_RUN_PATH=C:/path/to/piper.exe
PIPER_MODEL=C:/path/to/en_GB-aru-medium.onnx
PIPER_RUN_ARGS=--model "{model}" --output_file "{output}"
```

Important policy:

- speech env is local to `voice-spa/.env`
- `add speech` does not write speech keys to root `.env` or `.env.example`

## 3. Confirm workflow external input contract

Speech ingress dispatches an external event name.
By default that name is `user_message`.

Make sure your workflow config declares the same external input:

```json
{
	"externals": ["user_message"]
}
```

If the ingress name and declared external differ, runtime enqueue may be rejected or ignored by your workflow logic.

## 4. Start runtime and speech surface

Terminal A (host/runtime):

```bash
node host/server.mjs --hot-swap
```

Terminal B (voice surface):

```bash
cd voice-spa
node server.js
```

Open:

`http://127.0.0.1:4318`

## 5. Verify end-to-end

1. Speak a short prompt in the voice SPA.
2. Confirm `/api/voice-command` returns `ok: true` and a transcript.
3. Confirm runtime receives ingress as the declared external input (for example `user_message`).
4. Confirm output events stream back and are rendered in the SPA (`/api/output/stream`).

If you also run nerve-studio:

- graph/console should show queued external events
- IO pane should reflect input echo/output when channels and declared externals match your runtime config


## Troubleshooting quick checks

- `voice-spa /health` should report dependency and transport status.
- Verify `RUNTIME_INGRESS_URL` and `RUNTIME_SSE_URL` point to your active runtime surface.
- Verify `VOICE_INGRESS_NAME` matches a declared external channel.
- Verify Whisper/Piper executable and model paths are valid on your machine.
- If using strict transport behavior, adjust `VOICE_TRANSPORT_MODE` (`ws-only`, `ws-fallback`, `http-only`).

## What you learned

1. Speech surfaces are host-attached capabilities, not workflow-side side effects.
2. Event naming contracts (`VOICE_INGRESS_NAME` vs declared externals) are the deterministic boundary.
3. Environment ownership is local to the speech surface (`voice-spa/.env`), keeping root config clean.

Minimal surface. Composable depth.

## Next

Add other capabilities:

- [Step 6 A](step-6a.md) — Add a vector database for real RAG
- [step 6 C](step-6c.md) — Add MCP servers

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
