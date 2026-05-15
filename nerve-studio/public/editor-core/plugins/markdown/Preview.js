function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInline(line) {
  let html = escapeHtml(line)

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>')

  return html
}

export function renderMarkdownPreview(inputText) {
  const text = typeof inputText === 'string' ? inputText : ''
  const lines = text.split('\n')
  const html = []

  let insideCodeFence = false
  let insideList = false

  for (const rawLine of lines) {
    const line = rawLine ?? ''

    if (/^\s*```/.test(line)) {
      if (!insideCodeFence) {
        if (insideList) {
          html.push('</ul>')
          insideList = false
        }
        html.push('<pre><code>')
      } else {
        html.push('</code></pre>')
      }
      insideCodeFence = !insideCodeFence
      continue
    }

    if (insideCodeFence) {
      html.push(`${escapeHtml(line)}\n`)
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      if (insideList) {
        html.push('</ul>')
        insideList = false
      }
      const level = headingMatch[1].length
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
      continue
    }

    const listMatch = line.match(/^\s*[-*+]\s+(.+)$/)
    if (listMatch) {
      if (!insideList) {
        html.push('<ul>')
        insideList = true
      }
      html.push(`<li>${renderInline(listMatch[1])}</li>`)
      continue
    }

    if (insideList) {
      html.push('</ul>')
      insideList = false
    }

    if (line.trim().length === 0) {
      html.push('')
      continue
    }

    html.push(`<p>${renderInline(line)}</p>`)
  }

  if (insideList) {
    html.push('</ul>')
  }
  if (insideCodeFence) {
    html.push('</code></pre>')
  }

  return html.join('\n')
}
