# @nerveflow/editor-core

Framework-agnostic single-document editor substrate used by Nerve Studio.

This package is the source of truth for editor-core implementation.
The Studio browser mirror at `nerve-studio/public/editor-core` is generated from `packages/editor-core/src` via:

- `npm run sync:editor-core`

## Install

```bash
npm install @nerveflow/editor-core
```

## Usage

```js
import { Surface, Renderer, DiagnosticsChannel } from '@nerveflow/editor-core'
import { createMarkdownPlugin, createJsonPlugin } from '@nerveflow/editor-core'

const surface = new Surface({ text: '# Hello' })
const renderer = new Renderer()
const diagnostics = new DiagnosticsChannel()

const markdown = createMarkdownPlugin({ surface, renderer, diagnostics })
markdown.refresh()
```

## API

Exports:

- `Surface`
- `Renderer`
- `DiagnosticsChannel`
- `tokenizeMarkdown`
- `renderMarkdownPreview`
- `createMarkdownPlugin`
- `tokenizeJson`
- `validateJson`
- `normalizeJson`
- `createJsonPlugin`

## Development in this repository

- Source package: `packages/editor-core/src`
- Studio mirror: `nerve-studio/public/editor-core`
- Sync: `npm run sync:editor-core`
- Verify mirror drift: `npm run verify:editor-core-sync`
