# Onboarding Step 2

Step 2 of onboarding: add an LLM and run a stateful chatbot from the command line.

## 1. Register transport and model

From your workspace root:

```bash
npx nerve-compose add transport ollama
npx nerve-compose add model llama3.2:latest --transport ollama
```

Repository-local alternative:

```bash
node bin/nerve-compose.js add transport ollama
node bin/nerve-compose.js add model llama3.2:latest --transport ollama
```

## 2. Ensure the model server is ready

```bash
ollama serve
ollama pull llama3.2:latest
npx nerve-model-check --model llama3.2:latest
```

## 3. Seed conversation state

Create or replace `state.init.json`:

```json
{
  "conversation": [
    {
      "role": "system",
      "content": "You are a concise, helpful assistant."
    }
  ]
}
```

## 4. Paste chatbot workflow

Create or replace `workflow.nrv`:

```nrv
on external "user_message"
  state.conversation = state.conversation + [
    {
      role: "user",
      content: event.value
    }
  ]

  reply = model("llama3.2:latest", messages=state.conversation)

  if reply.content
    assistant_text = reply.content
  else
    assistant_text = reply
  end

  state.conversation = state.conversation + [
    {
      role: "assistant",
      content: assistant_text
    }
  ]

  output text assistant_text
end
```

## 5. Chat from CLI

Use the standalone runtime WS endpoint (default: `ws://127.0.0.1:4190/api/runtime/ws`).

Quick connectivity check:

```bash
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws snapshot
```

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello there"
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "remember my favorite color is green"
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "what is my favorite color?"
```

`nerve-send` syntax:

```bash
npx nerve-send <wsUrl> <eventType> [message]
```

If you have not started the runtime yet, return to Step 1 in [02-getting-started.md](02-getting-started.md) and run `npx nerve-runtime start --port 4190`.

## If chat fails

Run these checks in order:

1. Verify runtime WS connectivity:

```bash
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws snapshot
```

2. Verify the model label is installed:

```bash
ollama list
```

3. Ensure the expected label exists locally:

```bash
ollama pull llama3.2:latest
```

4. Re-run model preflight:

```bash
npx nerve-model-check --model llama3.2:latest
```
