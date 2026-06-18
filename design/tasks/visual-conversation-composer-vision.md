# Conversation Composer

*Start with the agent you already have. Grow into Nerveflow naturally.*

---

## The Problem

Today's coding agents are remarkably simple.

They are usually composed of:

* one or more system prompt files (`.md`)
* a model
* a set of tools (often MCP servers)
* a conversation

This works surprisingly well.

Until it doesn't.

As prompts grow, they gradually become software disguised as instructions.

```
If user asks...

Unless...

When editing...

Before writing...

After reading...

If the project uses...
```

Eventually the system prompt becomes hundreds of lines long, containing branching logic, workflows, and policies that would be easier to express as code.

Most platforms offer only one solution:

**Write better prompts.**

Nerveflow offers another.

---

# Conversation Composer

Conversation Composer is a visual environment for assembling AI conversations.

Not AI agents.

Conversations.

At its simplest, it contains only four concepts:

```
Model

System

Tools

Conversation
```

A user can:

* choose a model
* attach Markdown files as system messages
* attach tools (MCP, built-in, or custom)
* start chatting

That's it.

No workflows.

No graphs.

No DSL.

No new concepts.

If you already use Cursor, Claude Code, or ChatGPT with Markdown instructions and MCP tools, you already know how to use Conversation Composer.

---

# Import Your Existing Agent

Existing setups already contain almost everything needed.

```
System/
    coding.md
    architecture.md
    project.md

Tools/
    Filesystem
    Git
    Terminal
    MCP
```

Import them.

Conversation Composer creates a working assistant immediately.

Under the hood, Nerveflow runs a tiny workflow.

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

Users don't need to know this exists.

It simply works.

---

# When Prompts Become Programs

Over time, one Markdown file starts growing.

```
coding.md

"When editing files...

If the project contains tests...

Unless the user requested otherwise...

Always inspect...

Never modify...

When..."
```

This isn't documentation anymore.

It's behavior.

Conversation Composer gently suggests another option.

**Extract Workflow...**

One click later:

```
smart_edit.nrv
```

appears.

The Markdown becomes:

```
When editing files, use Smart Edit.
```

Behavior has moved from prompting into programming.

No rewrite.

Just refactoring.

---

# Extract Workflow

Software developers already understand this pattern.

```
Extract Method

Extract Class

Extract Module
```

Conversation Composer introduces:

**Extract Workflow**

Instead of making prompts increasingly complicated, behavior moves into explicit, inspectable workflows.

```
Markdown

↓

Markdown + Workflow

↓

Workflow + Workflow

↓

Composable application
```

The transition is gradual.

Users don't stop building assistants.

They slowly refactor them.

---

# Visual Conversation

Conversation Composer focuses on conversations.

The conversation is assembled from components.

```
System
      \
Tools ----> Conversation
      /
Model
```

The conversation emerges naturally.

The user composes the participants.

---

# Visual Workflow

When needed, workflows become available.

Small reusable capabilities.

```
Smart Edit

Read File
↓

Summarize Context
↓

Coding Agent
↓

Write File
```

Each workflow typically remains small.

20–30 lines of Nerveflow code.

Easy to inspect.

Easy to reuse.

Easy to test.

---

# Graphs Are Optional

Conversation Composer is usable without ever opening a graph.

For users who prefer visual architecture, the graph is always available.

The graph is not where logic is written.

The graph shows how capabilities connect.

Each workflow node contains a small `.nrv` program.

Double-click a node.

Edit its workflow.

Save.

The graph updates automatically.

Architecture remains visual.

Behavior remains code.

---

# A Natural Learning Path

Instead of teaching workflows first, Conversation Composer follows the user's existing mental model.

```
Markdown

↓

Markdown + Tools

↓

Markdown + Workflow

↓

Multiple Workflows

↓

Composable AI Application
```

Every step feels like a natural evolution.

There is no point where users are asked to abandon what they already built.

---

# The Gentle Introduction to Nerveflow

Conversation Composer is not another agent builder.

It is a bridge.

Users arrive with existing prompts, Markdown files, and MCP tools.

They leave with composable workflows.

Without ever feeling like they switched platforms.

They simply refactored their agent into software.

---

## One Sentence

**Start with the agent you already have. When prompts stop being enough, extract behavior into workflows.**
