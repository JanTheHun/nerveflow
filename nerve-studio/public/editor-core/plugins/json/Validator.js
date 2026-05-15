function offsetToLineColumn(text, offset) {
  let line = 1
  let column = 1
  const stop = Math.max(0, Math.min(offset, text.length))

  for (let i = 0; i < stop; i += 1) {
    if (text[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return { line, column }
}

function extractParseErrorOffset(errorMessage) {
  const message = String(errorMessage ?? '')
  const positionMatch = message.match(/position\s+(\d+)/i)
  if (positionMatch) {
    return Number(positionMatch[1])
  }

  return null
}

export function validateJson(inputText) {
  const text = typeof inputText === 'string' ? inputText : ''

  if (text.trim().length === 0) {
    return [{
      severity: 'warning',
      code: 'JSON_EMPTY_DOCUMENT',
      message: 'document is empty',
      line: 1,
      column: 1,
    }]
  }

  try {
    JSON.parse(text)
    return []
  } catch (error) {
    const offset = extractParseErrorOffset(error?.message)
    const location = offset == null ? { line: 1, column: 1 } : offsetToLineColumn(text, offset)

    return [{
      severity: 'error',
      code: 'JSON_PARSE_ERROR',
      message: String(error?.message ?? 'invalid json'),
      line: location.line,
      column: location.column,
    }]
  }
}
