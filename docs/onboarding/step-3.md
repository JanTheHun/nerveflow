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

## 3. Open Nerve Studio

Open it in a browser:

```text
http://localhost:4173
```

## 4. Verify the integration

In Studio, click on the **"show input"** button to open the Input Panel, then confirm this flow:

1. A runtime snapshot is visible.
2. In the Input Panel, select the `user_message` channel.
3. Send `hello nerve` and confirm the output is `hello world!`.
4. Send any other text (e.g., `what time is it?`) and confirm output appears.
5. Runtime events continue updating in the UI for both branches.
6. Repeated sends remain deterministic and inspectable.

## 5. Advanced Nerve Studio features:

- [nerve-studio/README.md](../../nerve-studio/README.md)


## 6. What you learned

1. The runtime can be inspected through attachable surfaces.
2. Events, state, and outputs remain observable while workflows execute.
3. Deterministic orchestration becomes easier to debug and trust when execution is visible.

## Next

Learn about bounded decisions in [Step 4](step-4.md).

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).