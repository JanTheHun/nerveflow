import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Surface,
  Renderer,
  tokenizeMarkdown,
  renderMarkdownPreview,
  createMarkdownPlugin,
} from '../packages/editor-core/src/index.js'

test('tokenizeMarkdown detects heading, list, and inline emphasis', () => {
  const tokens = tokenizeMarkdown([
    '# Title',
    '- item with **bold** and *italic* and `code`',
  ].join('\n'))

  const tokenTypes = new Set(tokens.map((token) => token.type))
  assert.equal(tokenTypes.has('heading'), true)
  assert.equal(tokenTypes.has('list-marker'), true)
  assert.equal(tokenTypes.has('bold'), true)
  assert.equal(tokenTypes.has('italic'), true)
  assert.equal(tokenTypes.has('inline-code'), true)
})

test('renderMarkdownPreview escapes html and renders markdown tags', () => {
  const html = renderMarkdownPreview([
    '# Hello',
    '- **safe** item',
    '<script>alert(1)</script>',
  ].join('\n'))

  assert.match(html, /<h1>Hello<\/h1>/)
  assert.match(html, /<strong>safe<\/strong>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})

test('markdown plugin attaches to surface and updates renderer tokens', () => {
  const surface = new Surface({ text: '# First' })
  const renderer = new Renderer()
  const plugin = createMarkdownPlugin()

  const detach = plugin.attach({ surface, renderer })
  assert.equal(renderer.getTokens().some((token) => token.type === 'heading'), true)

  surface.setText('plain text')
  assert.equal(renderer.getTokens().some((token) => token.type === 'heading'), false)

  detach()
})

test('markdown wrap commands edit selection deterministically', () => {
  const surface = new Surface({ text: 'alpha beta' })
  const plugin = createMarkdownPlugin()
  const detach = plugin.attach({ surface })

  surface.setSelection(0, 5)
  const boldResult = surface.dispatchCommand('markdown.wrapBold')
  assert.equal(boldResult.ok, true)
  assert.equal(surface.getText(), '**alpha** beta')

  surface.setSelection(10, 14)
  const italicResult = surface.dispatchCommand('markdown.wrapItalic')
  assert.equal(italicResult.ok, true)
  assert.equal(surface.getText(), '**alpha** *beta*')

  detach()
})

test('markdown preview toggle command flips plugin state', () => {
  const surface = new Surface({ text: 'x' })
  const plugin = createMarkdownPlugin({ previewEnabled: false })
  const detach = plugin.attach({ surface })

  assert.equal(plugin.isPreviewEnabled(), false)
  assert.deepEqual(surface.dispatchCommand('markdown.togglePreview'), { ok: true, value: true })
  assert.equal(plugin.isPreviewEnabled(), true)
  assert.deepEqual(surface.dispatchCommand('markdown.togglePreview'), { ok: true, value: false })
  assert.equal(plugin.isPreviewEnabled(), false)

  detach()
})
