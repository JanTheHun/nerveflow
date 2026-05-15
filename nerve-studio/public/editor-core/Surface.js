import { EventEmitter } from './internal/event_emitter.js'

function clampIndex(value, max) {
  const numeric = Number.isFinite(value) ? value : 0
  if (numeric < 0) {
    return 0
  }
  if (numeric > max) {
    return max
  }
  return Math.floor(numeric)
}

function normalizeRange(start, end) {
  return start <= end ? { start, end } : { start: end, end: start }
}

export class Surface {
  constructor(options = {}) {
    const initialText = typeof options.text === 'string' ? options.text : ''

    this.text = initialText
    this.readonly = Boolean(options.readonly)
    this.theme = options.theme && typeof options.theme === 'object' ? { ...options.theme } : {}
    this.selection = { start: 0, end: 0 }
    this.undoStack = []
    this.redoStack = []
    this.commands = new Map()
    this.events = new EventEmitter()
  }

  getText() {
    return this.text
  }

  setText(nextText, options = {}) {
    const normalizedText = typeof nextText === 'string' ? nextText : ''
    const shouldRecord = options.recordHistory !== false

    if (this.readonly) {
      return false
    }

    if (normalizedText === this.text) {
      return true
    }

    this.#commitText(normalizedText, shouldRecord)
    const end = normalizedText.length
    this.selection = { start: end, end }
    this.events.emit('change', { text: this.text })
    return true
  }

  setReadonly(readonly) {
    this.readonly = Boolean(readonly)
  }

  isReadonly() {
    return this.readonly
  }

  setTheme(theme) {
    if (!theme || typeof theme !== 'object') {
      this.theme = {}
      return
    }

    this.theme = { ...theme }
  }

  getTheme() {
    return { ...this.theme }
  }

  getSelection() {
    return { ...this.selection }
  }

  setSelection(start, end = start) {
    const max = this.text.length
    const clampedStart = clampIndex(start, max)
    const clampedEnd = clampIndex(end, max)
    this.selection = normalizeRange(clampedStart, clampedEnd)
    this.events.emit('selection', this.getSelection())
    return this.getSelection()
  }

  replaceRange(start, end, replacementText) {
    if (this.readonly) {
      return false
    }

    const max = this.text.length
    const normalized = normalizeRange(clampIndex(start, max), clampIndex(end, max))
    const insertText = typeof replacementText === 'string' ? replacementText : ''

    const nextText = this.text.slice(0, normalized.start) + insertText + this.text.slice(normalized.end)
    this.#commitText(nextText, true)

    const cursor = normalized.start + insertText.length
    this.selection = { start: cursor, end: cursor }
    this.events.emit('change', {
      text: this.text,
      range: normalized,
      insertedText: insertText,
    })
    return true
  }

  insertText(index, value) {
    return this.replaceRange(index, index, value)
  }

  deleteRange(start, end) {
    return this.replaceRange(start, end, '')
  }

  undo() {
    if (this.readonly || this.undoStack.length === 0) {
      return false
    }

    this.redoStack.push(this.text)
    const previous = this.undoStack.pop()
    this.text = previous

    const end = previous.length
    this.selection = { start: end, end }
    this.events.emit('change', { text: this.text, source: 'undo' })
    return true
  }

  redo() {
    if (this.readonly || this.redoStack.length === 0) {
      return false
    }

    this.undoStack.push(this.text)
    const next = this.redoStack.pop()
    this.text = next

    const end = next.length
    this.selection = { start: end, end }
    this.events.emit('change', { text: this.text, source: 'redo' })
    return true
  }

  registerCommand(name, handler) {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('command name must be a non-empty string')
    }
    if (typeof handler !== 'function') {
      throw new TypeError('command handler must be a function')
    }

    this.commands.set(name, handler)
    return () => {
      if (this.commands.get(name) === handler) {
        this.commands.delete(name)
      }
    }
  }

  listCommands() {
    return [...this.commands.keys()].sort()
  }

  dispatchCommand(name, payload) {
    const handler = this.commands.get(name)
    if (!handler) {
      return { ok: false, reason: 'unknown-command' }
    }

    const value = handler({ surface: this, payload })
    return { ok: true, value }
  }

  on(eventName, listener) {
    return this.events.on(eventName, listener)
  }

  #commitText(nextText, recordHistory) {
    if (recordHistory && nextText !== this.text) {
      this.undoStack.push(this.text)
      this.redoStack = []
    }
    this.text = nextText
  }
}
