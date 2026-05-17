# Onboarding Step 3

## 1. Prerequisite

Use a running runtime from Step 1/2.

Default runtime endpoint:

- `ws://127.0.0.1:4190/api/runtime/ws`

If you are using another port, keep the same path and replace `4190`.

## 2. Launch Studio

From any directory:

```bash
npx nerve-studio
```

Repository-local alternative:

```bash
node nerve-studio/preview-server.js
```

Open:

```text
http://localhost:4173
```

## 3. Attach Studio to your runtime

Use explicit remote WS mode:

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Repository-local alternative:

```bash
node nerve-studio/preview-server.js --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

You can also use environment fallback:

```powershell
$env:NERVE_STUDIO_REMOTE_WS = 'ws://127.0.0.1:4190/api/runtime/ws'
npx nerve-studio --remote
```

## 4. Verify the integration

In Studio, confirm this flow:

1. A runtime snapshot is visible.
2. Enqueue `user_message` with a short value.
3. Output and runtime events update in the UI.
4. Repeated sends remain deterministic and inspectable.

## 5. Continue

For advanced Studio modes and remote options, see:

- [../nerve-studio/README.md](../nerve-studio/README.md)