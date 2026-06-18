# MVP Proposal: Refactor VS Code Runtime Surface into Conversation Composer

## Vision

The current VS Code Runtime Surface is an excellent runtime companion.

This proposal changes its primary mental model.

Instead of being viewed as a runtime inspector that happens to include chat, it becomes a **Conversation Composer** that happens to run on a Nerveflow runtime.

This is primarily a UX refactor, not an architectural one.

The runtime remains unchanged.

---

# Goals

* Reuse the existing VS Code Runtime Surface.
* Keep the existing runtime protocol.
* Keep the existing workflow execution.
* Introduce almost no new concepts.
* Make Nerveflow feel familiar to users coming from Cursor, Claude Code or ChatGPT.

The extension should answer one simple question:

> **How do I assemble my assistant?**

---

# Initial Layout

```text
Conversation Composer
────────────────────────────────

Model
[ qwen3-coder ▼ ]

System
────────────────────────────────
coding.md
architecture.md
project.md
[ + Add ]

Tools
────────────────────────────────
✓ Filesystem
✓ Git
✓ Terminal
✓ PostgreSQL
[ + Add ]

────────────────────────────────

Conversation

User:
Assistant:

────────────────────────────────

> Input

[__________________________]

                   [ Send ]
```

Nothing else.

No workflow editor.

No graph.

No DSL.

No orchestration UI.

Just a conversation assembled from explicit pieces.

---

# The Mental Model

The user is not configuring an "agent".

The user is composing a conversation.

A conversation consists of:

* a model
* one or more system messages
* a set of tools
* user messages

Everything maps directly onto concepts developers already know.

---

# System

System is simply a list of Markdown files.

Each file becomes one system message.

Initial features:

* add existing Markdown file
* remove file
* reorder files

Future additions:

* create Markdown
* inline editing
* folders
* workspace presets

---

# Tools

Display capabilities attached to the conversation.

Initially:

* built-in host tools
* MCP tools
* runtime capabilities

Future:

* workflow-backed capabilities
* capability bundles

The user should not care whether a capability comes from JavaScript, MCP or Nerveflow.

It is simply a capability available during the conversation.

---

# Model

Simple dropdown.

Uses existing runtime model configuration.

No provider management UI is required.

---

# Conversation

Reuse the existing runtime conversation.

No behavioral changes.

The Runtime Surface already does this well.

---

# Runtime

Nothing changes architecturally.

Conversation Composer simply drives a normal Nerveflow runtime.

Internally, the runtime still executes a tiny workflow.

```nrv
on external "user_message"

    reply = agent(
        "assistant",
        messages = state.conversation,
        tools = ...
    )

    output text reply

end
```

This workflow remains an implementation detail.

The user never needs to see it.

---

# Bring Your Existing Assistant

This becomes the primary onboarding experience.

Most existing coding assistants already consist of:

```text
Markdown instructions

+

MCP configuration

+

Conversation
```

Conversation Composer imports these directly.

Markdown files become System.

MCP servers become Tools.

The assistant immediately works.

No migration.

No conversion.

No rewrite.

---

# The Gentle Introduction to Nerveflow

At this stage, users are not learning workflows.

They are simply assembling conversations.

This keeps the learning curve almost identical to existing AI coding tools.

---

# The Natural Evolution

Over time, a Markdown file becomes increasingly procedural.

```text
When editing...

If...

Unless...

Before...

After...

Always...
```

Conversation Composer can gently suggest:

> 💡 This looks like behavior.
>
> Consider extracting it into a workflow.

No automation.

No magic.

Just a recommendation.

---

# Extract Workflow

The migration path is intentionally gradual.

```text
Markdown

↓

Markdown + Tools

↓

Markdown + Workflow

↓

Composable AI Application
```

The user is not replacing their assistant.

They are refactoring it.

Exactly like software.

---

# Future Workflow Capabilities

Eventually, workflows become reusable capabilities.

The Tools section might contain:

```text
Filesystem

Git

Smart Edit

Generate Tests

Summarize Changes
```

Some capabilities are implemented in JavaScript.

Some come from MCP.

Some are implemented as tiny `.nrv` workflows.

From the user's perspective, they are simply capabilities.

This is one of the core strengths of Nerveflow.

---

# Out of Scope

Not part of this MVP:

* graph editor
* workflow editor
* workflow extraction
* visual node editor
* runtime inspector redesign
* multi-agent orchestration

Those become future evolutions of the same extension.

---

# Future Roadmap

## Phase 1

Conversation Composer

* Model
* System
* Tools
* Conversation

---

## Phase 2

Workflow-backed capabilities

Workflows appear alongside traditional tools.

The distinction becomes largely invisible to users.

---

## Phase 3

Workflow editing

Double-click a workflow capability.

Edit its `.nrv`.

Save.

Continue chatting.

---

## Phase 4

Graph View

An optional architectural visualization.

The graph does not replace code.

It visualizes relationships between workflows and capabilities.

Users who never need it never have to open it.

---

# Why This Matters

Conversation Composer removes the biggest adoption barrier to Nerveflow.

Users do not begin by learning a workflow language.

They begin with the assistant they already have.

Their Markdown files still work.

Their MCP servers still work.

Their conversation still works.

Only when prompt engineering starts becoming software do they discover workflows.

By then, Nerveflow no longer feels like a new platform.

It feels like the natural evolution of the one they were already using.

---

## One Sentence

**Conversation Composer transforms the existing VS Code Runtime Surface from a runtime viewer into the front door of the Nerveflow ecosystem, allowing developers to bring the assistant they already have and gradually evolve it into a composable AI application.**
