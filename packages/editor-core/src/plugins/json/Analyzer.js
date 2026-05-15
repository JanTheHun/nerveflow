function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function analyzeJsonCursorContext(inputText, cursorOffset) {
  const text = typeof inputText === 'string' ? inputText : ''
  const offset = clamp(Number.isInteger(cursorOffset) ? cursorOffset : 0, 0, text.length)

  let line = 1
  let column = 1
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  let alphaStart = offset
  while (alphaStart > 0 && /[a-z]/i.test(text[alphaStart - 1])) {
    alphaStart -= 1
  }
  let alphaEnd = offset
  while (alphaEnd < text.length && /[a-z]/i.test(text[alphaEnd])) {
    alphaEnd += 1
  }

  const word = alphaEnd > alphaStart ? text.slice(alphaStart, alphaEnd) : ''
  const isBooleanWord = word === 'true' || word === 'false'

  const before = text.slice(0, offset)
  const after = text.slice(offset)

  return {
    cursorOffset: offset,
    line,
    column,
    word,
    isBooleanWord,
    charBefore: before.length > 0 ? before[before.length - 1] : '',
    charAfter: after.length > 0 ? after[0] : '',
    insideStringApprox: (before.match(/"/g)?.length ?? 0) % 2 === 1,
  }
}
