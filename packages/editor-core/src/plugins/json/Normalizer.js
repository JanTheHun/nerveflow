function normalizeIndent(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 8) {
    return value
  }
  return 2
}

export function normalizeJson(inputText, options = {}) {
  const text = typeof inputText === 'string' ? inputText : ''
  const indent = normalizeIndent(options.indent)

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const err = new Error(String(error?.message ?? 'invalid json'))
    err.code = 'JSON_PARSE_ERROR'
    throw err
  }

  const normalized = JSON.stringify(parsed, null, indent)
  return options.trailingNewline === true ? `${normalized}\n` : normalized
}
