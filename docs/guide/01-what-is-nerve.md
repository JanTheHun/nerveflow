# What Is Nerveflow

Nerveflow is a **deterministic control layer for AI workflows**.

It gives you explicit routing, state updates, and event handling while letting your host decide how to call tools and models.

## Why use it

LLM output is probabilistic, but workflow control should be deterministic. Nerveflow lets you:

- keep routing in code instead of prompt-only logic
- make state transitions explicit and inspectable
- separate model/tool integration from control flow
- replay and test workflows with stable behavior

## What Nerveflow is

- A parser and runtime for nextV scripts (`.nrv` / `.wfs`)
- A compiler that lowers scripts to IR for execution
- An event-driven runner with optional persistence
- Utilities for extracting event graphs

## What Nerveflow is not

- Not a full agent framework
- Not tied to one model provider
- Not a UI framework
- Not a job scheduler

## Runtime boundary

Nerveflow executes workflow logic. Your host is responsible for:

- tool execution (`callTool`)
- model/agent calls (`callAgent`)
- nested script calls (`callScript`)
- external signal ingestion
- persistence and API/UI surfaces
