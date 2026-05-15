import { tokenizeJson } from './Tokenizer.js'
import { validateJson } from './Validator.js'
import { normalizeJson } from './Normalizer.js'
import { analyzeJsonCursorContext } from './Analyzer.js'
import { applyTextPatch, createBooleanTogglePatch } from './Patches.js'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePath(path) {
  if (!Array.isArray(path)) {
    return []
  }
  return path
}

function getNodeByPath(root, path) {
  let current = root
  for (const segment of normalizePath(path)) {
    if (Array.isArray(current) && Number.isInteger(segment) && segment >= 0 && segment < current.length) {
      current = current[segment]
      continue
    }
    if (isPlainObject(current) && typeof segment === 'string' && Object.hasOwn(current, segment)) {
      current = current[segment]
      continue
    }
    return { found: false, node: undefined }
  }
  return { found: true, node: current }
}

function getParentByPath(root, path) {
  const normalizedPath = normalizePath(path)
  if (normalizedPath.length === 0) {
    return { found: true, parent: null, key: null }
  }

  const parentPath = normalizedPath.slice(0, -1)
  const key = normalizedPath[normalizedPath.length - 1]
  const parentResult = getNodeByPath(root, parentPath)
  if (!parentResult.found) {
    return { found: false, parent: null, key }
  }
  return { found: true, parent: parentResult.node, key }
}

function resolveToggleRange(text, cursorOffset) {
  const offset = Number.isInteger(cursorOffset) ? cursorOffset : 0
  const clampedOffset = Math.max(0, Math.min(offset, text.length))

  const before = text.slice(0, clampedOffset)
  const after = text.slice(clampedOffset)

  const leftWordMatch = before.match(/(true|false)$/)
  if (leftWordMatch) {
    const value = leftWordMatch[1]
    const start = clampedOffset - value.length
    const end = clampedOffset
    return { found: true, start, end, value }
  }

  const rightWordMatch = after.match(/^(true|false)/)
  if (rightWordMatch) {
    const value = rightWordMatch[1]
    const start = clampedOffset
    const end = clampedOffset + value.length
    return { found: true, start, end, value }
  }

  // Cursor can be inside a boolean token; scan the contiguous alpha word.
  let wordStart = clampedOffset
  while (wordStart > 0 && /[a-z]/i.test(text[wordStart - 1])) {
    wordStart -= 1
  }
  let wordEnd = clampedOffset
  while (wordEnd < text.length && /[a-z]/i.test(text[wordEnd])) {
    wordEnd += 1
  }

  if (wordEnd > wordStart) {
    const word = text.slice(wordStart, wordEnd)
    if (word === 'true' || word === 'false') {
      return { found: true, start: wordStart, end: wordEnd, value: word }
    }
  }

  return { found: false }
}

function normalizeSelectionRange(text, selection, options = {}) {
  const value = typeof text === 'string' ? text : ''
  const start = Number.isInteger(selection?.start) ? selection.start : 0
  const end = Number.isInteger(selection?.end) ? selection.end : start
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(0, Math.min(end, value.length))
  const range = safeStart <= safeEnd
    ? { start: safeStart, end: safeEnd }
    : { start: safeEnd, end: safeStart }

  if (range.start === range.end) {
    return { start: 0, end: value.length, wholeDocument: true }
  }

  const normalizeBoundary = options.normalizeBoundary !== false
  if (!normalizeBoundary) {
    return { ...range, wholeDocument: false }
  }

  let expandedStart = range.start
  let expandedEnd = range.end
  while (expandedStart > 0 && value[expandedStart - 1] !== '\n') {
    expandedStart -= 1
  }
  while (expandedEnd < value.length && value[expandedEnd] !== '\n') {
    expandedEnd += 1
  }

  return { start: expandedStart, end: expandedEnd, wholeDocument: false }
}

function getLineLeadingWhitespace(text, offset) {
  const value = typeof text === 'string' ? text : ''
  const safeOffset = Math.max(0, Math.min(Number.isInteger(offset) ? offset : 0, value.length))
  const lineStart = value.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1

  let cursor = lineStart
  while (cursor < value.length) {
    const ch = value[cursor]
    if (ch === ' ' || ch === '\t') {
      cursor += 1
      continue
    }
    break
  }

  return value.slice(lineStart, cursor)
}

function reindentNormalizedFragment(normalizedText, baseIndent) {
  const text = typeof normalizedText === 'string' ? normalizedText : ''
  const indent = typeof baseIndent === 'string' ? baseIndent : ''
  if (!text.includes('\n') || indent.length === 0) {
    return text
  }

  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i += 1) {
    lines[i] = `${indent}${lines[i]}`
  }
  return lines.join('\n')
}

function applyJsonMutation(surface, mutation, options = {}) {
  const text = surface.getText()

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  const result = mutation(parsed)
  if (result && result.ok === false) {
    return result
  }

  const effectiveValue = result?.replaceRoot === true
    ? (result?.value ?? null)
    : parsed

  const trailingNewline = options.trailingNewline === true || text.endsWith('\n')
  const indent = Number.isInteger(options.indent) ? options.indent : 2
  const normalized = normalizeJson(JSON.stringify(effectiveValue), { indent, trailingNewline })
  surface.setText(normalized)
  return { ok: true, value: normalized }
}

function updateDiagnostics(inputText, diagnosticsChannel) {
  if (!diagnosticsChannel || typeof diagnosticsChannel.setDiagnostics !== 'function') {
    return
  }
  diagnosticsChannel.setDiagnostics(validateJson(inputText))
}

export function createJsonPlugin(options = {}) {
  const state = {
    indent: Number.isInteger(options.indent) ? options.indent : 2,
    trailingNewline: options.trailingNewline === true,
  }

  return {
    id: 'json',
    tokenize(inputText) {
      return tokenizeJson(inputText)
    },
    validate(inputText) {
      return validateJson(inputText)
    },
    normalize(inputText, normalizeOptions = {}) {
      return normalizeJson(inputText, {
        indent: normalizeOptions.indent ?? state.indent,
        trailingNewline: normalizeOptions.trailingNewline ?? state.trailingNewline,
      })
    },
    attach({ surface, renderer, diagnosticsChannel }) {
      if (!surface || typeof surface.getText !== 'function') {
        throw new TypeError('json plugin requires a surface instance')
      }

      const unsubs = []
      const refresh = () => {
        const currentText = surface.getText()
        if (renderer && typeof renderer.setTokens === 'function') {
          renderer.setTokens(tokenizeJson(currentText))
        }
        updateDiagnostics(currentText, diagnosticsChannel)
      }

      refresh()
      unsubs.push(surface.on('change', refresh))

      unsubs.push(surface.registerCommand('json.normalizeDocument', ({ surface: target, payload }) => {
        const indent = Number.isInteger(payload?.indent) ? payload.indent : state.indent
        const trailingNewline = payload?.trailingNewline === true || state.trailingNewline
        try {
          const normalized = normalizeJson(target.getText(), { indent, trailingNewline })
          target.setText(normalized)
          return { ok: true, value: normalized }
        } catch (error) {
          return { ok: false, reason: String(error?.code ?? 'invalid-json') }
        }
      }))

      unsubs.push(surface.registerCommand('json.normalizeSelection', ({ surface: target, payload }) => {
        const text = target.getText()
        const selection = target.getSelection()
        const range = normalizeSelectionRange(text, selection, {
          normalizeBoundary: payload?.normalizeBoundary !== false,
        })

        if (range.wholeDocument) {
          const delegated = target.dispatchCommand('json.normalizeDocument', payload)
          if (delegated?.ok === true && delegated?.value?.ok === true) {
            return delegated.value
          }
          return { ok: false, reason: 'invalid-json' }
        }

        const indent = Number.isInteger(payload?.indent) ? payload.indent : state.indent
        const selectedText = text.slice(range.start, range.end)
        try {
          const normalizedRaw = normalizeJson(selectedText, {
            indent,
            trailingNewline: false,
          })
          const baseIndent = getLineLeadingWhitespace(text, range.start)
          const normalized = reindentNormalizedFragment(normalizedRaw, baseIndent)

          const patch = {
            start: range.start,
            end: range.end,
            text: normalized,
            selection: {
              start: range.start,
              end: range.start + normalized.length,
            },
          }
          return applyTextPatch(target, patch)
        } catch (error) {
          return { ok: false, reason: String(error?.code ?? 'invalid-json') }
        }
      }))

      unsubs.push(surface.registerCommand('json.toggleBoolean', ({ surface: target, payload }) => {
        if (Array.isArray(payload?.path)) {
          return applyJsonMutation(target, (doc) => {
            const nodeResult = getNodeByPath(doc, payload.path)
            if (!nodeResult.found || typeof nodeResult.node !== 'boolean') {
              return { ok: false, reason: 'path-not-boolean' }
            }

            const parentResult = getParentByPath(doc, payload.path)
            if (!parentResult.found) {
              return { ok: false, reason: 'path-not-found' }
            }

            if (parentResult.parent === null) {
              return { ok: false, reason: 'root-not-boolean' }
            }

            if (Array.isArray(parentResult.parent)) {
              parentResult.parent[parentResult.key] = !nodeResult.node
            } else {
              parentResult.parent[parentResult.key] = !nodeResult.node
            }

            return { ok: true }
          }, state)
        }

        const text = target.getText()
        const selection = target.getSelection()
        const context = analyzeJsonCursorContext(text, selection.start)
        if (context.insideStringApprox) {
          return { ok: false, reason: 'cursor-inside-string' }
        }
        const toggle = resolveToggleRange(text, selection.start)
        if (!toggle.found) {
          return { ok: false, reason: 'no-boolean-at-cursor' }
        }

        const patch = createBooleanTogglePatch(text, toggle.start, toggle.end, toggle.value)
        return applyTextPatch(target, patch)
      }))

      unsubs.push(surface.registerCommand('json.addProperty', ({ surface: target, payload }) => {
        const key = String(payload?.key ?? '').trim()
        if (!key) {
          return { ok: false, reason: 'missing-key' }
        }

        return applyJsonMutation(target, (doc) => {
          const result = getNodeByPath(doc, payload?.path)
          if (!result.found || !isPlainObject(result.node)) {
            return { ok: false, reason: 'path-not-object' }
          }
          result.node[key] = payload?.value ?? null
          return { ok: true }
        }, state)
      }))

      unsubs.push(surface.registerCommand('json.removeProperty', ({ surface: target, payload }) => {
        const key = String(payload?.key ?? '').trim()
        if (!key) {
          return { ok: false, reason: 'missing-key' }
        }

        return applyJsonMutation(target, (doc) => {
          const result = getNodeByPath(doc, payload?.path)
          if (!result.found || !isPlainObject(result.node)) {
            return { ok: false, reason: 'path-not-object' }
          }
          if (!Object.hasOwn(result.node, key)) {
            return { ok: false, reason: 'key-not-found' }
          }
          delete result.node[key]
          return { ok: true }
        }, state)
      }))

      unsubs.push(surface.registerCommand('json.renameKey', ({ surface: target, payload }) => {
        const fromKey = String(payload?.fromKey ?? '').trim()
        const toKey = String(payload?.toKey ?? '').trim()
        if (!fromKey || !toKey) {
          return { ok: false, reason: 'missing-key' }
        }

        return applyJsonMutation(target, (doc) => {
          const result = getNodeByPath(doc, payload?.path)
          if (!result.found || !isPlainObject(result.node)) {
            return { ok: false, reason: 'path-not-object' }
          }
          if (!Object.hasOwn(result.node, fromKey)) {
            return { ok: false, reason: 'key-not-found' }
          }

          result.node[toKey] = result.node[fromKey]
          delete result.node[fromKey]
          return { ok: true }
        }, state)
      }))

      unsubs.push(surface.registerCommand('json.setValue', ({ surface: target, payload }) => {
        if (!Array.isArray(payload?.path)) {
          return { ok: false, reason: 'missing-path' }
        }

        return applyJsonMutation(target, (doc) => {
          if (payload.path.length === 0) {
            return { ok: true, value: payload?.value ?? null, replaceRoot: true }
          }

          const parentResult = getParentByPath(doc, payload.path)
          if (!parentResult.found) {
            return { ok: false, reason: 'path-not-found' }
          }
          const parent = parentResult.parent
          const key = parentResult.key

          if (parent === null) {
            return { ok: false, reason: 'cannot-set-root' }
          }

          if (Array.isArray(parent)) {
            if (!Number.isInteger(key) || key < 0 || key >= parent.length) {
              return { ok: false, reason: 'index-not-found' }
            }
            parent[key] = payload?.value ?? null
            return { ok: true }
          }

          if (!Object.hasOwn(parent, key)) {
            return { ok: false, reason: 'key-not-found' }
          }
          parent[key] = payload?.value ?? null
          return { ok: true }
        }, state)
      }))

      unsubs.push(surface.registerCommand('json.addArrayItem', ({ surface: target, payload }) => {
        return applyJsonMutation(target, (doc) => {
          const result = getNodeByPath(doc, payload?.path)
          if (!result.found || !Array.isArray(result.node)) {
            return { ok: false, reason: 'path-not-array' }
          }
          result.node.push(payload?.value ?? null)
          return { ok: true }
        }, state)
      }))

      unsubs.push(surface.registerCommand('json.removeArrayItem', ({ surface: target, payload }) => {
        return applyJsonMutation(target, (doc) => {
          const result = getNodeByPath(doc, payload?.path)
          const index = Number(payload?.index)
          if (!result.found || !Array.isArray(result.node)) {
            return { ok: false, reason: 'path-not-array' }
          }
          if (!Number.isInteger(index) || index < 0 || index >= result.node.length) {
            return { ok: false, reason: 'index-not-found' }
          }
          result.node.splice(index, 1)
          return { ok: true }
        }, state)
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
