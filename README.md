# Nerveflow

Deterministic control for probabilistic software.

Nerveflow gives AI workflows an explicit execution spine: declared events, inspectable state, bounded decisions, and controlled effects.

## Quick Onboarding


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

Next step: add an LLM and run a stateful chatbot from CLI.

See [Onboarding Step 2](docs/onboarding-step-2.md) for the Step 2 walkthrough.

## Composable Capability Flow (Package-First)

When using Nerveflow from npm, the recommended capability setup flow is:

```bash
# 1) Declare capabilities in your workspace config
npx nerve-compose add memory-pgvector <workspaceDir>
npx nerve-compose add speech <workspaceDir>

# 2) Validate workspace capability bindings
npx nerve-compose validate <workspaceDir> --json

# 3) Run composable reference host against that workspace
WORKSPACE_DIR=<workspaceDir> node node_modules/nerveflow/examples/composable-reference-host/server.js
```

Stable module provider labels for composable auto-attach:

- `memory-pgvector`
- `speech-surface`
- `mcp` (and `mcp-client`)

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](MANIFESTO.md).

`nerve-send` syntax:

```bash
npx nerve-send <wsUrl> <eventType> [message]
```

## Learn More

- [Getting Started](docs/02-getting-started.md)
- [Language Reference](docs/03-language-reference.md)
- [Host Integration](docs/04-host-integration.md)
- [User Handbook](docs/13-user-handbook.md)
- [Documentation Index](docs/README.md)

## Nerve Studio

Launch with:

```bash
npx nerve-studio
```

Repository-local alternative: run files under [nerve-studio/](nerve-studio/).

