# Onboarding Step 2

Add an LLM and run a stateful chatbot from the command line.

To run this step, you need a model endpoint you can call. Choose one path:

1. Local path: run a model on your machine (recommended for this tutorial: Ollama)
2. External API path: use a hosted provider with an API key (example in this tutorial: OpenAI)

## Local path (Ollama)

### 1. Install Ollama
Download and install Ollama:
https://ollama.com/download

### 2. Pull a model
Run:

```bash
ollama pull llama3.2:latest
```

Verify the model is available:

```bash
ollama list
```

### 3. Register local transport and model
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

## External API path (OpenAI-compatible)

### 1. Register transport and model
From your workspace root, choose one provider:

OpenAI:

```bash
npx nerve-compose add transport openai
npx nerve-compose add model gpt-4o-mini --transport openai
```

Groq:

```bash
npx nerve-compose add transport groq
npx nerve-compose add model llama-3.3-70b-versatile --transport groq
```

Gemini:

```bash
npx nerve-compose add transport gemini
npx nerve-compose add model gemini-2.5-flash-lite --transport gemini
```

### 2. Verify generated transport config in nerve.json
`nerve-compose add transport <name>` now scaffolds OpenAI-compatible transport config automatically.

Examples:

```json
{
  "transports": {
    "openai": {
      "provider": "openai_compat",
      "baseUrl": "${env:OPENAI_BASE_URL}",
      "apiKey": "${env:OPENAI_API_KEY}"
    },
    "groq": {
      "provider": "openai_compat",
      "baseUrl": "${env:GROQ_BASE_URL}",
      "apiKey": "${env:GROQ_API_KEY}"
    },
    "gemini": {
      "provider": "openai_compat",
      "baseUrl": "${env:GEMINI_BASE_URL}",
      "apiKey": "${env:GEMINI_API_KEY}"
    }
  }
}
```

### 3. Add API key to .env
Set the key for the provider you chose:

```bash
OPENAI_API_KEY=your_api_key_here
# or
GROQ_API_KEY=your_api_key_here
# or
GEMINI_API_KEY=your_api_key_here
```

## Seed conversation state

Replace state.init.json with:

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

## Paste chatbot workflow

Replace workflow.nrv with:

```nrv
on external "user_message"
  if event.value == "hello nerve"
    output text "hello world!"
  else
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
end
```

Set the model label in that workflow based on your path:

1. Local path:
reply = model("llama3.2:latest", messages=state.conversation)
2. External API path:
reply = model("gpt-4o-mini", messages=state.conversation)
or reply = model("llama-3.3-70b-versatile", messages=state.conversation)
or reply = model("gemini-2.5-flash-lite", messages=state.conversation)

Expected behavior:

1. `hello nerve` still prints `hello world!`.
2. Everything else is routed to the chatbot branch.

## Model variability (important)

Behavior depends strongly on model choice and hardware.

Try these experiments:

1. Cloud path:
Use openai_compat with API key and run a remote model.
2. Fast local path:
Run a local model on a capable GPU.
3. Constrained local path:
Run local on CPU or limited hardware and compare with a smaller model.

What to expect:

1. Quality and latency can vary significantly.
2. Some events may fail if model or transport is unavailable or overloaded.
3. The runtime process remains active and can process later events.

## Chat from CLI

If runtime is not started yet:

```bash
npx nerve-runtime start --port 4190
```

Use the runtime WS endpoint:
ws://127.0.0.1:4190/api/runtime/ws

Quick connectivity check:

```bash
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws snapshot
```

Send test messages:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello there"
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "remember my favorite color is green"
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "what is my favorite color?"
```

nerve-send syntax:

```bash
npx nerve-send <wsUrl> <eventType> [message]
```

Next: continue with onboarding-step-3.md to introduce Nerve Studio.

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../MANIFESTO.md).