# Nerveflow

**Deterministic control for probabilistic software.**

Nerveflow is a workflow runtime for AI systems that need:

* explicit orchestration
* inspectable execution
* bounded model behavior
* attachable runtime surfaces

```bash
npm install nerveflow
npx nerve-compose init
npx nerve-runtime start --port 4190
```

Send an event:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello nerve"
```

---

## Start Here

### [Onboarding](docs/onboarding/step-1.md)

Follow the onboarding sequence to:
- start the runtime
- attach a model
- inspect workflows in Studio
- add bounded routing
- attach host capabilities
- connect MCP, vector DB and external systems

### [Quick Language Reference](docs/guide/14-quick-language-reference.md)

## Documentation

* [User Handbook](docs/guide/13-user-handbook.md)
* [Language Reference](docs/guide/03-language-reference.md)
* [Host Integration](docs/guide/04-host-integration.md)

---

## Studio

```bash
npx nerve-studio
```

Attach to any running runtime for inspection and replay.

---

## Philosophy

* [Manifesto](MANIFESTO.md)

---

## Core Idea

Deterministic systems should orchestrate probabilistic ones.

Nerveflow keeps:

* workflow execution deterministic
* model behavior bounded through contracts
* runtime effects explicit and inspectable

Minimal surface. Composable depth.

