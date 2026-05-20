# Onboarding Step 1

Install and verify the base runtime.

```bash
# 1) Install
npm install nerveflow

# 2) Initialize a workspace
npx nerve-compose init

# 3) Start runtime
npx nerve-runtime start --port 4190

# 4) Quick test with helper CLI

# wrong channel -> rejected
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws random_channel ping

# right channel, wrong message -> deterministic fallback
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message ping

# right channel, right message -> expected result
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello nerve"
```

## Command Reference

`nerve-send` syntax:

```bash
npx nerve-send <wsUrl> <eventType> [message]
```

## Nerve Studio

Attach a visual inspector to any running runtime:

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Then open:

```
http://localhost:4173
```

## Learn More

- [Language Reference](03-language-reference.md)
- [Host Integration](04-host-integration.md)
- [User Handbook](13-user-handbook.md)

## Next

Add an LLM and run a stateful chatbot from CLI.

See [onboarding-step-2.md](onboarding-step-2.md) for the Step 2 walkthrough.

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../MANIFESTO.md).
