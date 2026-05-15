import { tokenizeMarkdown } from './Tokenizer.js'
import { renderMarkdownPreview } from './Preview.js'

function wrapSelection(surface, wrapper) {
  const text = surface.getText()
  const selection = surface.getSelection()
  const selectedText = text.slice(selection.start, selection.end)
  const wrapped = `${wrapper}${selectedText}${wrapper}`

  surface.replaceRange(selection.start, selection.end, wrapped)
  surface.setSelection(
    selection.start + wrapper.length,
    selection.start + wrapper.length + selectedText.length,
  )
}

export function createMarkdownPlugin(options = {}) {
  const state = {
    previewEnabled: Boolean(options.previewEnabled),
  }

  return {
    id: 'markdown',
    tokenize(inputText) {
      return tokenizeMarkdown(inputText)
    },
    renderPreview(inputText) {
      return renderMarkdownPreview(inputText)
    },
    isPreviewEnabled() {
      return state.previewEnabled
    },
    attach({ surface, renderer }) {
      if (!surface || typeof surface.getText !== 'function') {
        throw new TypeError('markdown plugin requires a surface instance')
      }

      const unsubs = []

      if (renderer && typeof renderer.setTokens === 'function') {
        renderer.setTokens(tokenizeMarkdown(surface.getText()))
        unsubs.push(surface.on('change', () => {
          renderer.setTokens(tokenizeMarkdown(surface.getText()))
        }))
      }

      unsubs.push(surface.registerCommand('markdown.wrapBold', ({ surface: target }) => {
        wrapSelection(target, '**')
        return target.getText()
      }))

      unsubs.push(surface.registerCommand('markdown.wrapItalic', ({ surface: target }) => {
        wrapSelection(target, '*')
        return target.getText()
      }))

      unsubs.push(surface.registerCommand('markdown.togglePreview', () => {
        state.previewEnabled = !state.previewEnabled
        return state.previewEnabled
      }))

      return () => {
        for (const unsubscribe of unsubs) {
          if (typeof unsubscribe === 'function') {
            unsubscribe()
          }
        }
      }
    },
  }
}
