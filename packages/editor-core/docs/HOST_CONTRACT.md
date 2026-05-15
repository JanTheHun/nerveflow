# Host Contract (Draft)

The host owns layout, file trees, tabs, routing, persistence, and multi-surface orchestration.
The editor surface owns only one document at a time.

## Required Host Capabilities

1. Document lifecycle
- Provide initial document text.
- Receive change events.
- Save externally when requested.

2. Selection and focus
- Set or read selection by character offsets.
- Focus or blur the editor surface.

3. Command bridge
- Register host commands.
- Dispatch named commands with payload.

4. Diagnostics bridge
- Push diagnostics into the surface.
- Listen for diagnostics updates.

5. Theme and read modes
- Apply theme tokens.
- Toggle readonly mode.

## Core API Surface

- Surface.getText()
- Surface.setText(text, options?)
- Surface.getSelection()
- Surface.setSelection(start, end?)
- Surface.replaceRange(start, end, text)
- Surface.insertText(index, text)
- Surface.deleteRange(start, end)
- Surface.setReadonly(boolean)
- Surface.isReadonly()
- Surface.setTheme(theme)
- Surface.getTheme()
- Surface.registerCommand(name, handler)
- Surface.dispatchCommand(name, payload)
- Surface.listCommands()
- Surface.undo()
- Surface.redo()
- Surface.on(eventName, listener)

## Events

- change: emitted when document text changes
- selection: emitted when selection changes

## Out of Scope

- tabs
- pane splits
- workspace routing
- file tree rendering
- persistence ownership
