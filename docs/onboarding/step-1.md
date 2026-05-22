# Onboarding Step 1

Install and verify the base runtime.

## 1. Install

```bash
npm install nerveflow
```
## 2. Initialize a workspace
```
npx nerve-compose init
```
## 3. Start runtime
```
npx nerve-runtime start --port 4190
```

<details>
  <summary>Optional: scaffold documentation profiles</summary>

If you want guided project-generation or AI-assisted workflows, you can scaffold documentation profiles into your workspace:

#### Minimal guide docs
```bash
npx nerve-compose add docs minimal
```

#### AI/project-generation docs
```
npx nerve-compose add docs ai
```
</details>

## 4. Quick test with helper CLI

### wrong channel -> rejected
```
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws random_channel ping
```

### right channel, wrong message -> deterministic fallback
```
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message ping
```

### right channel, right message -> expected result
```
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

- [Language Reference](../guide/03-language-reference.md)
- [Host Integration](../guide/04-host-integration.md)
- [User Handbook](../guide/13-user-handbook.md)

## Next

Add a model and run a stateful chatbot from CLI in [step-2.md](step-2.md).

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
