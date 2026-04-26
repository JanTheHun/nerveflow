# Chatbot Workflow (Public Example)

Public workflow example for a local chatbot with deterministic routing.

Current public scope:

- Externals: `user_message`, `reset_chat`
- Instruction domains: `lighting`, `other`

## Files

- `nextv.json`: workspace config and effect declarations
- `agents.json`: agent profiles and model mapping for `chat` and `intent`
- `contracts/`: return contracts for intent, instruction domain, and lighting output
- `prompts/`: prompt files for intent, subject routing, and lighting instruction parsing
- `entry.nrv`: workflow composition entrypoint
- `intent.nrv`: routes external events into workflow events
- `chat.nrv`: conversational stateful chat turns
- `domain.nrv`: domain classification and routing
- `lighting.nrv`: lighting command extraction and effect output
- `reset.nrv`: chat reset handling
- `output.nrv`: final user output surface

## Run with standalone runtime

From repository root:

```powershell
node bin/nerve-runtime.js start examples/chatbot-workflow --port 4190
```

Then in another terminal:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue user_message "turn on the living room lights"
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue user_message "hello there"
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue reset_chat "reset"
```

Optional: stream runtime events

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws listen
```
