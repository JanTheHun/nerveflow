# Onboarding Step 4

Build your first bounded-decision workflow.

In Step 2, you added a chatbot.
In this step, you add a deterministic router in front of it.

Goal:

1. Keep a deterministic control flow.
2. Bound model output to a small intent enum.
3. Route each intent explicitly.

## 1. Update workflow.nrv with bounded routing

In `workflow.nrv` replace your `else` branch with:

```nrv
decision = model(
  "llama3.2:latest",
  event.value,
  "Decide which workflow branch to use: if user prompt is to to play a song or any music, choose music. If user wants to manipulate lights, choose lights. Otherwise choose chat.",
  decide=["chat","music","lights"],
  retry_on_contract_violation=1
)

if decision == "music"
  output text "Music route selected. (Scaffold)"
else if decision == "lights"
  output text "Lights route selected. (Scaffold)"
else
  state.conversation = state.conversation + [
    {
      role: "user",
      content: event.value
    }
  ]
  reply = model("llama3.2:1b", messages=state.conversation)
  state.conversation = state.conversation + [
    {
      role: "assistant",
      content: reply
    }
  ]
  output text reply
end
```

If you are using the external API path, replace both model labels with your configured model label (for example `gpt-4o-mini`).

## 2. Restart runtime

Stop the runtime if it is running, then restart to load your updated workflow:

```bash
npx nerve-runtime start --port 4190
```

## 3. Verify routing

### using CLI

```
 npx nerve-send ws://127.0.0.1:5000/api/runtime/ws user_message "play me some music"

 npx nerve-send ws://127.0.0.1:5000/api/runtime/ws user_message "turn off kitchen lights"
```

### Using Nerve Studio

If Studio is not already running, attach it:

```bash
npx nerve-studio --remote-ws ws://127.0.0.1:4190/api/runtime/ws
```

Open:

```text
http://localhost:4173
```

In Studio, enqueue your events on `user_message` channel.

## 4. Other bounded-call patterns

`decide` is one way to bound model behavior. It is not the only way.

Other useful patterns:

1. `returns=[...]` for more detailed contracts.
2. `try ...` to convert supported runtime/model/tool failures into an explicit `{ ok, ... }` envelope.
3. `format="json"` when you want JSON-shaped output formatting, even without a strict decision contract.

In this step, we use `decide` because it keeps routing explicit with bounded scalar contract.

## 5. What you learned

1. Probabilistic output is bounded by a contract.
2. Workflow routing remains explicit and deterministic.
3. You can scale this pattern into specialized multi-agent flows.

The goal of this tutorial is not to teach AI workflow architecture.
It is to show how Nerveflow can help you design it.

## Next

Meet your first host and add your first tool call in [step-5.md](step-5.md).

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
