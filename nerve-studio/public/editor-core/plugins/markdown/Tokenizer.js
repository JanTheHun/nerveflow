function pushToken(tokens, token) {
  if (!token || typeof token !== 'object') {
    return
  }

  if (!Number.isInteger(token.line) || token.line < 1) {
    return
  }

  const start = Number.isInteger(token.start) ? token.start : 0
  const end = Number.isInteger(token.end) ? token.end : start
  if (end < start) {
    return
  }

  tokens.push({ ...token, start, end })
}

function collectInlineTokens(tokens, lineNumber, lineText) {
  const inlineMatchers = [
    { type: 'inline-code', pattern: /`[^`]+`/g },
    { type: 'bold', pattern: /\*\*[^*]+\*\*/g },
    { type: 'italic', pattern: /\*[^*]+\*/g },
    { type: 'link', pattern: /\[[^\]]+\]\([^\)]+\)/g },
  ]

  for (const matcher of inlineMatchers) {
    for (const match of lineText.matchAll(matcher.pattern)) {
      const value = match[0]
      const index = match.index ?? -1
      if (index < 0) {
        continue
      }
      pushToken(tokens, {
        line: lineNumber,
        start: index,
        end: index + value.length,
        type: matcher.type,
        value,
      })
    }
  }
}

export function tokenizeMarkdown(inputText) {
  const text = typeof inputText === 'string' ? inputText : ''
  const lines = text.split('\n')
  const tokens = []

  let insideFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1
    const line = lines[i]

    const fenceMatch = line.match(/^\s*```/)
    if (fenceMatch) {
      pushToken(tokens, {
        line: lineNumber,
        start: fenceMatch.index ?? 0,
        end: (fenceMatch.index ?? 0) + 3,
        type: 'fence',
        value: '```',
      })
      insideFence = !insideFence
      continue
    }

    if (insideFence) {
      pushToken(tokens, {
        line: lineNumber,
        start: 0,
        end: line.length,
        type: 'code-line',
        value: line,
      })
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+/)
    if (headingMatch) {
      const headingText = headingMatch[0]
      pushToken(tokens, {
        line: lineNumber,
        start: 0,
        end: headingText.length,
        type: 'heading',
        value: headingText,
      })
    }

    const listMatch = line.match(/^(\s*)([-*+]\s+|\d+\.\s+)/)
    if (listMatch) {
      const markerText = listMatch[0]
      pushToken(tokens, {
        line: lineNumber,
        start: 0,
        end: markerText.length,
        type: 'list-marker',
        value: markerText,
      })
    }

    collectInlineTokens(tokens, lineNumber, line)
  }

  return tokens.sort((a, b) => {
    if (a.line !== b.line) {
      return a.line - b.line
    }
    if (a.start !== b.start) {
      return a.start - b.start
    }
    return a.end - b.end
  })
}
