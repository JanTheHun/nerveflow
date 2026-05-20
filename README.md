# Nerveflow

Deterministic control for probabilistic software.

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

* [Onboarding](docs/onboarding-step-1.md)
* [User Handbook](docs/13-user-handbook.md)
* [Language Reference](docs/03-language-reference.md)
* [Host Integration](docs/04-host-integration.md)

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

