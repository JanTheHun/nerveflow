# Onboarding Step 4

Build your first bounded-decision workflow.

In Step 2, you added a chatbot.
In this step, you add a deterministic router in front of it.

Goal:

1. Keep a deterministic control flow.
2. Bound model output to a small intent enum.
3. Route each intent explicitly.

## 1. Update workflow.nrv with bounded routing

Replace `workflow.nrv` with:

```nrv
on external "user_message"
  if event.value == "hello nerve"
    output text "hello world!"
  else
    decision = model(
      "llama3.2:latest",
      event.value,
      "Classify user intent. Return one of: chat, knowledge, tools, other.",
      returns={ intent:["chat","knowledge","tools","other"] },
      retry_on_contract_violation=1
    )

    if decision.intent == "knowledge"
      output text "Knowledge route selected. (Scaffold)"
    else if decision.intent == "tools"
      output text "Tools route selected. (Scaffold)"
    else
      state.conversation = state.conversation + [
        {
          role: "user",
          content: event.value
        }
      ]

      reply = model("llama3.2:latest", messages=state.conversation)

      state.conversation = state.conversation + [
        {
          role: "assistant",
          content: reply
        }
      ]

      output text reply
    end
  end
end
```

If you are using the external API path, replace both model labels with your configured model label (for example `gpt-4o-mini`).

## 2. Restart runtime

Stop the runtime if it is running, then restart to load your updated workflow:

```bash
npx nerve-runtime start --port 4190
```

## 3. Attach Studio (if needed)

If Studio is not already running, attach it:

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Open:

```text
http://localhost:4173
```

## 4. Verify routing in Studio

In Studio, enqueue these events:

1. `hello nerve`
Expected: `hello world!`
2. `summarize Winston Churchill's life in 5 sentences`
Expected: `Knowledge route selected. (Scaffold)`
3. `list files in my working folder`
Expected: `Tools route selected. (Scaffold)`
4. `what do you think about cats?`
Expected: chatbot response from the `chat` branch

## 5. Other bounded-call patterns

`returns` is one way to bound model behavior. It is not the only way.

Other useful patterns:

1. `decide=[...]` on `model(...)` or `agent(...)` for a single bounded scalar decision.
2. `try ...` to convert supported runtime/model/tool failures into an explicit `{ ok, ... }` envelope.
3. `format="json"` when you want JSON-shaped output formatting, even without a strict decision contract.

In this step, we use `returns` because it keeps routing explicit with an enum contract.

## 6. What you learned

1. Probabilistic output is bounded by a contract.
2. Workflow routing remains explicit and deterministic.
3. You can scale this pattern into specialized multi-agent flows.

## Next

Meet your first host and add your first tool call in [step-5.md](step-5.md).

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
