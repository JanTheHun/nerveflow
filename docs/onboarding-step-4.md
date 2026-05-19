# Onboarding Step 4

Build your first bounded-decision workflow.

In Step 2, you added a chatbot.
In this step, you add a deterministic router in front of it.

Goal:

1. Keep a deterministic control flow.
2. Bound model output to a small intent enum.
3. Route each intent explicitly.

## 1. Keep your runtime and Studio running

If needed, start runtime:

```bash
npx nerve-runtime start --port 4190
```

If needed, attach Studio:

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Open:

```text
http://localhost:4173
```

## 2. Replace workflow.nrv with bounded routing

Replace `workflow.nrv` with:

```nrv
on external "user_message"
  if event.value == "hello nerve"
    output text "hello world!"
  else
    decision = model(
      "llama3.2:latest",
      event.value,
      "Classify user intent. Return one of: chat, lights, music, other.",
      returns={ intent:["chat","lights","music","other"] },
      retry_on_contract_violation=1
    )

    if decision.intent == "lights"
      output text "Lighting route selected. (Scaffold)"
    else if decision.intent == "music"
      output text "Music route selected. (Scaffold)"
    else if decision.intent == "chat"
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
    else
      output text "I can help with chat, lights, or music."
    end
  end
end
```

If you are using the external API path, replace both model labels with your configured model label (for example `gpt-4o-mini`).

## 3. Other bounded-call patterns

`returns` is one way to bound model behavior. It is not the only way.

Other useful patterns:

1. `decide=[...]` on `agent(...)` for a single bounded scalar decision.
2. `try ...` to convert supported runtime/model/tool failures into an explicit `{ ok, ... }` envelope.
3. `format="json"` when you want JSON-shaped output formatting, even without a strict decision contract.

In this step, we use `returns` because it keeps routing explicit with an enum contract.

## 4. Keep or replace state.init.json

Ensure `state.init.json` contains:

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

## 5. Verify routing in Studio

In Studio, enqueue these events:

1. `hello nerve`
Expected: `hello world!`
2. `turn on the kitchen lights`
Expected: `Lighting route selected. (Scaffold)`
3. `play some music`
Expected: `Music route selected. (Scaffold)`
4. `what did I just ask?`
Expected: chatbot response from the `chat` branch

## 6. What you learned

1. Probabilistic output is bounded by a contract.
2. Workflow routing remains explicit and deterministic.
3. You can scale this pattern into specialized multi-agent flows.

Next: continue with [onboarding-step-5.md](onboarding-step-5.md) for a simple home-assistant scaffold.

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../MANIFESTO.md).
