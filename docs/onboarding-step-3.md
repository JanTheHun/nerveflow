# Onboarding Step 3

Use Nerve Studio to inspect and drive the runtime you configured in Step 2.

## 1. Prerequisite

Use a running runtime from Step 1/2.

Default runtime endpoint:

- `ws://127.0.0.1:4190/api/runtime/ws`

If you are using another port, keep the same path and replace `4190`.

## 2. Launch Studio attached to your runtime

Preferred command:

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

## 3. Open Studio

Open:

```text
http://localhost:4173
```

## 4. Verify the integration

In Studio, confirm this flow:

1. A runtime snapshot is visible.
2. Enqueue `user_message` with `hello nerve` and confirm output is `hello world!`.
3. Enqueue `user_message` with any other text and confirm chatbot output appears.
4. Runtime events continue updating in the UI for both branches.
5. Repeated sends remain deterministic and inspectable.

## 5. Continue

Next onboarding step:

- [onboarding-step-4.md](onboarding-step-4.md)

For advanced Studio modes and remote options, see:

- [../nerve-studio/README.md](../nerve-studio/README.md)