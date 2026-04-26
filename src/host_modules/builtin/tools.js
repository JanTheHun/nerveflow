function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripXmlTags(value) {
  return decodeXmlEntities(value).replace(/<[^>]*>/g, '').trim()
}

function extractTag(block, tag) {
  const match = String(block ?? '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? stripXmlTags(match[1]) : ''
}

function extractLink(block) {
  const atomMatch = String(block ?? '').match(/<link[^>]*href="([^"]+)"[^>]*>/i)
  if (atomMatch?.[1]) return atomMatch[1].trim()
  return extractTag(block, 'link')
}

function normalizeDate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return new Date().toISOString()
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function parseRssOrAtom(xmlText, sourceUrl, limit) {
  const xml = String(xmlText ?? '')
  const rows = []
  const channelTitle = extractTag(xml, 'title')
  const source = channelTitle || (() => {
    try {
      return new URL(sourceUrl).hostname
    } catch {
      return 'unknown'
    }
  })()

  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || []
  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []

  for (const block of itemBlocks) {
    const title = extractTag(block, 'title')
    const url = extractLink(block)
    const guid = extractTag(block, 'guid')
    if (!title || !url) continue
    rows.push({
      id: guid || url,
      title,
      source,
      url,
      publishedAt: normalizeDate(extractTag(block, 'pubDate')),
    })
    if (rows.length >= limit) return rows
  }

  for (const block of entryBlocks) {
    const title = extractTag(block, 'title')
    const url = extractLink(block)
    const id = extractTag(block, 'id')
    if (!title || !url) continue
    rows.push({
      id: id || url,
      title,
      source,
      url,
      publishedAt: normalizeDate(extractTag(block, 'updated') || extractTag(block, 'published')),
    })
    if (rows.length >= limit) return rows
  }

  return rows
}

function buildHeaders(headersInput) {
  const headers = toObject(headersInput)
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    const headerName = String(key ?? '').trim()
    if (!headerName) continue
    out[headerName] = String(value ?? '')
  }
  return out
}

function createTimeoutSignal(timeoutMsRaw) {
  const timeoutMs = Number(timeoutMsRaw)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.floor(timeoutMs))
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  }
}

export function createRuntimeBuiltinToolProvider({ fetchImpl = fetch } = {}) {
  return {
    get_time: async ({ args }) => {
      const input = toObject(args)
      const now = new Date()
      const timeZone = String(input.timeZone ?? 'UTC').trim() || 'UTC'
      return {
        iso: now.toISOString(),
        epochMs: now.getTime(),
        timeZone,
      }
    },

    http_fetch: async ({ args }) => {
      const input = toObject(args)
      const url = String(input.url ?? '').trim()
      if (!url) throw new Error('http_fetch requires args.url')

      const method = String(input.method ?? 'GET').trim().toUpperCase() || 'GET'
      const headers = buildHeaders(input.headers)
      const body = input.body == null ? undefined : String(input.body)
      const timeout = createTimeoutSignal(input.timeoutMs)

      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          body,
          signal: timeout?.signal,
        })
        const contentType = String(response.headers.get('content-type') ?? '')
        const text = await response.text()

        let parsedJson = null
        if (contentType.includes('application/json')) {
          try {
            parsedJson = JSON.parse(text)
          } catch {
            parsedJson = null
          }
        }

        return {
          ok: response.ok,
          status: response.status,
          url,
          contentType,
          text,
          json: parsedJson,
        }
      } finally {
        timeout?.cleanup()
      }
    },

    rss_fetch: async ({ args }) => {
      const input = toObject(args)
      const urlsRaw = Array.isArray(input.urls) ? input.urls : [input.url]
      const urls = urlsRaw.map((item) => String(item ?? '').trim()).filter(Boolean)
      if (urls.length === 0) throw new Error('rss_fetch requires args.url or args.urls')
      const limit = Number.isFinite(Number(input.limit)) ? Math.max(1, Math.floor(Number(input.limit))) : 20

      const allItems = []
      for (const url of urls) {
        const timeout = createTimeoutSignal(input.timeoutMs)
        try {
          const response = await fetchImpl(url, {
            method: 'GET',
            signal: timeout?.signal,
            headers: {
              Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            },
          })
          if (!response.ok) continue
          const xml = await response.text()
          allItems.push(...parseRssOrAtom(xml, url, limit))
          if (allItems.length >= limit) break
        } catch {
          // Keep runtime resilient when one feed fails.
        } finally {
          timeout?.cleanup()
        }
      }

      const deduped = []
      const seen = new Set()
      for (const item of allItems) {
        const id = String(item?.id ?? '').trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        deduped.push(item)
        if (deduped.length >= limit) break
      }

      return {
        count: deduped.length,
        items: deduped,
      }
    },
  }
}
