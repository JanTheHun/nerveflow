# Nerveflow Conversation Composer

Conversation Composer is a VS Code view for assembling an assistant from:

- model
- system markdown files
- tool capabilities
- conversation history

It targets a running Nerveflow runtime endpoint and sends user messages through the existing host protocol.

## Non-Invasive Storage Model

Conversation Composer now works on the active folder without writing Composer-owned files into that folder.

- Composer session state is stored in VS Code extension global storage.
- Session state is isolated per opened folder/workspace identity.
- Active project files are not scaffolded or modified during Composer initialization.

Composer-owned state includes:

- `config.json`
- conversation history (`conversations/default.jsonl`)
- runtime setup files used by embedded Composer runtime (`nextv.json`, `models.json`, `transports.json`, `capabilities/conversation.nrv`)

These files are written under the extension storage root, not inside the project directory.

## Setup Data

Provider setup metadata is stored in the Composer session root (`env.local.json`, `models.json`, `transports.json`).
No `.env` file is written to the active project folder.
