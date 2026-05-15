function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

function isLiteralStart(ch) {
  return ch === 't' || ch === 'f' || ch === 'n'
}

function pushToken(tokens, token) {
  if (!token || typeof token !== 'object') return
  if (!Number.isInteger(token.line) || token.line < 1) return
  if (!Number.isInteger(token.start) || token.start < 0) return
  if (!Number.isInteger(token.end) || token.end < token.start) return
  tokens.push(token)
}

export function tokenizeJson(inputText) {
  const text = typeof inputText === 'string' ? inputText : ''
  const tokens = []

  let index = 0
  let line = 1
  let column = 0

  while (index < text.length) {
    const ch = text[index]

    if (ch === '\n') {
      index += 1
      line += 1
      column = 0
      continue
    }

    if (isWhitespace(ch)) {
      index += 1
      column += 1
      continue
    }

    const start = column

    if (ch === '{') {
      pushToken(tokens, { line, start, end: start + 1, type: 'brace-open', value: ch })
      index += 1
      column += 1
      continue
    }
    if (ch === '}') {
      pushToken(tokens, { line, start, end: start + 1, type: 'brace-close', value: ch })
      index += 1
      column += 1
      continue
    }
    if (ch === '[') {
      pushToken(tokens, { line, start, end: start + 1, type: 'bracket-open', value: ch })
      index += 1
      column += 1
      continue
    }
    if (ch === ']') {
      pushToken(tokens, { line, start, end: start + 1, type: 'bracket-close', value: ch })
      index += 1
      column += 1
      continue
    }
    if (ch === ':') {
      pushToken(tokens, { line, start, end: start + 1, type: 'colon', value: ch })
      index += 1
      column += 1
      continue
    }
    if (ch === ',') {
      pushToken(tokens, { line, start, end: start + 1, type: 'comma', value: ch })
      index += 1
      column += 1
      continue
    }

    if (ch === '"') {
      let cursor = index + 1
      let escaped = false
      while (cursor < text.length) {
        const current = text[cursor]
        if (current === '\n') {
          break
        }
        if (escaped) {
          escaped = false
          cursor += 1
          continue
        }
        if (current === '\\') {
          escaped = true
          cursor += 1
          continue
        }
        if (current === '"') {
          cursor += 1
          break
        }
        cursor += 1
      }

      const value = text.slice(index, cursor)
      const width = value.length
      pushToken(tokens, {
        line,
        start,
        end: start + width,
        type: value.endsWith('"') ? 'string' : 'string-invalid',
        value,
      })
      index = cursor
      column += width
      continue
    }

    if (ch === '-' || isDigit(ch)) {
      let cursor = index + 1
      while (cursor < text.length) {
        const current = text[cursor]
        if (!/[0-9eE+\-.]/.test(current)) {
          break
        }
        cursor += 1
      }
      const value = text.slice(index, cursor)
      pushToken(tokens, { line, start, end: start + value.length, type: 'number', value })
      index = cursor
      column += value.length
      continue
    }

    if (isLiteralStart(ch)) {
      let cursor = index + 1
      while (cursor < text.length && /[a-z]/i.test(text[cursor])) {
        cursor += 1
      }
      const value = text.slice(index, cursor)
      let type = 'literal-invalid'
      if (value === 'true' || value === 'false') type = 'boolean'
      if (value === 'null') type = 'null'
      pushToken(tokens, { line, start, end: start + value.length, type, value })
      index = cursor
      column += value.length
      continue
    }

    pushToken(tokens, { line, start, end: start + 1, type: 'unknown', value: ch })
    index += 1
    column += 1
  }

  return tokens
}
