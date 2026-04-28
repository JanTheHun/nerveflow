function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function sourceFromFeed(feed) {
  const value = String(feed ?? '').trim()
  if (!value) return 'news'
  try {
    return new URL(value).hostname || value
  } catch {
    return value
  }
}

export function normalizeFeedList(feedsLike) {
  return toArray(feedsLike)
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

export function normalizeRssItem(itemLike, feed) {
  const item = toObject(itemLike)
  const rawId = String(item.id ?? '').trim()
  const rawUrl = String(item.url ?? '').trim()
  const rawTitle = String(item.title ?? '').trim()
  const normalizedId = rawId || rawUrl || `${feed}:${rawTitle}`
  if (!normalizedId) return null

  return {
    id: normalizedId,
    title: rawTitle || 'Untitled article',
    source: String(item.source ?? sourceFromFeed(feed)).trim() || sourceFromFeed(feed),
    url: rawUrl || String(feed ?? '').trim(),
    publishedAt: String(item.publishedAt ?? new Date().toISOString()),
  }
}

export async function fetchRssCandidatesByFeed(feeds, options = {}, { rssFetch } = {}) {
  if (typeof rssFetch !== 'function') {
    throw new Error('fetchRssCandidatesByFeed requires rssFetch function.')
  }

  const limitRaw = Number(options.limit)
  const timeoutMsRaw = Number(options.timeoutMs)
  const perFeedLimit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(250, Math.floor(limitRaw)))
    : 100
  const timeoutMs = Number.isFinite(timeoutMsRaw)
    ? Math.max(500, Math.floor(timeoutMsRaw))
    : 4000

  const byFeed = new Map()
  for (const feed of feeds) {
    try {
      const result = await rssFetch({
        args: {
          url: feed,
          limit: perFeedLimit,
          timeoutMs,
        },
      })

      const items = toArray(result?.items)
        .map((item) => normalizeRssItem(item, feed))
        .filter(Boolean)

      byFeed.set(feed, items)
    } catch {
      byFeed.set(feed, [])
    }
  }

  return byFeed
}

export function pickNextRssItemFromFeeds(feeds, rssCandidatesByFeed, state = {}) {
  if (feeds.length === 0) return null
  const deliveredIds = state.deliveredIds instanceof Set ? state.deliveredIds : new Set()
  const pollIndex = Number.isFinite(Number(state.pollIndex)) ? Math.max(0, Math.floor(Number(state.pollIndex))) : 0
  const startOffset = pollIndex % feeds.length

  for (let i = 0; i < feeds.length; i += 1) {
    const feed = feeds[(startOffset + i) % feeds.length]
    const candidates = toArray(rssCandidatesByFeed.get(feed))
    for (const article of candidates) {
      const articleId = String(article?.id ?? '').trim()
      if (!articleId || deliveredIds.has(articleId)) continue
      deliveredIds.add(articleId)
      return article
    }
  }

  return null
}

export function pickNewRssItemsFromFeeds(feeds, rssCandidatesByFeed, state = {}) {
  if (feeds.length === 0) return []
  const deliveredIds = state.deliveredIds instanceof Set ? state.deliveredIds : new Set()
  const excludeIds = state.excludeIds instanceof Set ? state.excludeIds : new Set()
  const maxItems = Number.isFinite(Number(state.maxItems)) ? Math.max(1, Math.floor(Number(state.maxItems))) : 5
  const pollIndex = Number.isFinite(Number(state.pollIndex)) ? Math.max(0, Math.floor(Number(state.pollIndex))) : 0
  const startOffset = pollIndex % feeds.length
  const picked = []

  for (let i = 0; i < feeds.length; i += 1) {
    const feed = feeds[(startOffset + i) % feeds.length]
    const candidates = toArray(rssCandidatesByFeed.get(feed))
    for (const article of candidates) {
      const articleId = String(article?.id ?? '').trim()
      if (!articleId || deliveredIds.has(articleId) || excludeIds.has(articleId)) continue
      deliveredIds.add(articleId)
      picked.push(article)
      if (picked.length >= maxItems) return picked
    }
  }

  return picked
}

export function buildSyntheticRssItem(feed, feedCursor) {
  const cursor = feedCursor instanceof Map ? feedCursor : new Map()
  const feedKey = String(feed ?? '').trim() || 'news://default'
  const nextCursor = Number(cursor.get(feedKey) ?? 0) + 1
  cursor.set(feedKey, nextCursor)

  const source = sourceFromFeed(feedKey)
  const id = `${source.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'news'}-${nextCursor}`

  return {
    id,
    title: `${source} headline #${nextCursor}`,
    source,
    url: feedKey.startsWith('http') ? `${feedKey}#item-${nextCursor}` : `https://${source}/item/${nextCursor}`,
    publishedAt: new Date().toISOString(),
  }
}

export function mapRssItemsToIngressEvents(itemsLike, options = {}) {
  const items = toArray(itemsLike).filter((item) => item && typeof item === 'object')
  const eventType = String(options.eventType ?? 'rss_item').trim() || 'rss_item'
  const sourceLabel = String(options.source ?? 'rss_poll').trim() || 'rss_poll'

  return items.map((item) => ({
    type: eventType,
    value: item,
    source: sourceLabel,
  }))
}
