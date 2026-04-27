import { isAbsolute, relative, resolve } from 'node:path'
import { createPublicFileStoreProvider } from '../../../src/host_modules/public/file_store.js'

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function resolveToolInput(args, positional) {
  if (Array.isArray(positional) && positional.length > 0 && isObject(positional[0])) {
    return positional[0]
  }

  const argsObject = toObject(args)
  const argsPositional = Array.isArray(argsObject.positional) ? argsObject.positional : []
  if (argsPositional.length > 0 && isObject(argsPositional[0])) {
    return argsPositional[0]
  }

  if (isObject(argsObject.named) && Object.keys(argsObject.named).length > 0) {
    return argsObject.named
  }

  return argsObject
}

function sourceFromFeed(feed) {
  const value = String(feed ?? '').trim()
  if (!value) return 'news'
  try {
    return new URL(value).hostname || value
  } catch {
    return value
  }
}

function normalizeFeedList(feedsLike) {
  return toArray(feedsLike)
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function normalizeRssItem(itemLike, feed) {
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

const articleStore = []
const articleById = new Map()
const readIds = new Set()
const feedCursor = new Map()
const alertLog = []
let pollIndex = 0
const deliveredArticleIds = new Set()
const DEFAULT_STORE_RELATIVE_PATH = '.data/news-agent-store.json'
let storeInitialized = false
let storeRelativePath = ''
let storeTool = null
const ALLOWED_PRIORITY_LEVELS = new Set(['pending', 'urgent', 'high', 'normal', 'ignore'])
const ALLOWED_TOPICS = new Set(['markets', 'geopolitics', 'ai', 'energy', 'other'])

function resetStoreState() {
  articleStore.length = 0
  articleById.clear()
  readIds.clear()
  feedCursor.clear()
  alertLog.length = 0
  deliveredArticleIds.clear()
  pollIndex = 0
}

function resolveStoreFilePath(workspaceDir) {
  const workspaceRoot = String(workspaceDir ?? '').trim() || process.cwd()
  const configuredPath = String(process.env.NEWS_AGENT_STORE_PATH ?? '').trim()
  const candidatePath = configuredPath || DEFAULT_STORE_RELATIVE_PATH

  if (isAbsolute(candidatePath)) {
    throw new Error('NEWS_AGENT_STORE_PATH must be workspace-relative when using store_file_json.')
  }

  const absolutePath = resolve(workspaceRoot, candidatePath)

  const rel = relative(workspaceRoot, absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('NEWS_AGENT_STORE_PATH must resolve within the workspace directory when relative.')
  }

  return rel.replace(/\\/g, '/')
}

function hydrateStoreFromPayload(parsed) {
  if (!isObject(parsed)) return

  const persistedArticles = Array.isArray(parsed.articleStore)
    ? parsed.articleStore.filter(isObject)
    : []

  for (const row of persistedArticles) {
    articleStore.push(row)
    if (typeof row.id === 'string' && row.id.trim()) {
      articleById.set(row.id, row)
    }
  }

  const persistedDelivered = Array.isArray(parsed.deliveredArticleIds)
    ? parsed.deliveredArticleIds
    : []
  for (const id of persistedDelivered) {
    const normalizedId = String(id ?? '').trim()
    if (normalizedId) deliveredArticleIds.add(normalizedId)
  }

  const persistedReadIds = Array.isArray(parsed.readIds)
    ? parsed.readIds
    : []
  for (const id of persistedReadIds) {
    const normalizedId = String(id ?? '').trim()
    if (normalizedId) readIds.add(normalizedId)
  }

  const persistedAlertLog = Array.isArray(parsed.alertLog)
    ? parsed.alertLog.filter(isObject)
    : []
  for (const row of persistedAlertLog) {
    alertLog.push(row)
  }

  const persistedFeedCursor = isObject(parsed.feedCursor)
    ? parsed.feedCursor
    : {}
  for (const [feedKey, cursorValue] of Object.entries(persistedFeedCursor)) {
    const normalizedFeedKey = String(feedKey ?? '').trim()
    const normalizedCursor = Number(cursorValue)
    if (!normalizedFeedKey || !Number.isFinite(normalizedCursor)) continue
    feedCursor.set(normalizedFeedKey, Math.max(0, Math.floor(normalizedCursor)))
  }

  const persistedPollIndex = Number(parsed.pollIndex)
  if (Number.isFinite(persistedPollIndex)) {
    pollIndex = Math.max(0, Math.floor(persistedPollIndex))
  }
}

function buildStorePayload() {
  const feedCursorObject = {}
  for (const [feedKey, cursorValue] of feedCursor.entries()) {
    feedCursorObject[feedKey] = cursorValue
  }

  return {
    articleStore,
    deliveredArticleIds: Array.from(deliveredArticleIds),
    readIds: Array.from(readIds),
    feedCursor: feedCursorObject,
    alertLog,
    pollIndex,
  }
}

async function loadStoreStateFromDisk() {
  if (!storeTool || !storeRelativePath) return

  let result
  try {
    result = await storeTool({
      args: {
        store: storeRelativePath,
        op: 'get',
        key: 'state',
      },
    })
  } catch {
    return
  }

  if (!result?.found || !isObject(result.value)) return
  hydrateStoreFromPayload(result.value)
}

async function persistStoreStateToDisk() {
  if (!storeTool || !storeRelativePath) return

  await storeTool({
    args: {
      store: storeRelativePath,
      op: 'put',
      key: 'state',
      value: buildStorePayload(),
    },
  })
}

function initializeStoreTool(workspaceDir) {
  const nextStoreRelativePath = resolveStoreFilePath(workspaceDir)
  if (storeTool && storeRelativePath === nextStoreRelativePath) return

  storeRelativePath = nextStoreRelativePath
  storeTool = createPublicFileStoreProvider({ workspaceDir }).store_file_json
  storeInitialized = false
}

async function ensureStoreInitialized() {
  if (storeInitialized) return
  resetStoreState()
  await loadStoreStateFromDisk()
  storeInitialized = true
}

function normalizePriorityLevel(value, fallback = 'pending') {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ALLOWED_PRIORITY_LEVELS.has(normalized) ? normalized : fallback
}

function normalizeTopicValue(value, fallback = 'other') {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ALLOWED_TOPICS.has(normalized) ? normalized : fallback
}

async function fetchRssCandidates(feeds, options = {}) {
  const { createRuntimeBuiltinToolProvider } = await import('../../../src/host_modules/builtin/index.js')
  const builtin = createRuntimeBuiltinToolProvider()
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
      const result = await builtin.rss_fetch({
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

function pickNextArticleFromFeeds(feeds, rssCandidatesByFeed) {
  if (feeds.length === 0) return null
  const startOffset = pollIndex % feeds.length

  for (let i = 0; i < feeds.length; i += 1) {
    const feed = feeds[(startOffset + i) % feeds.length]
    const candidates = toArray(rssCandidatesByFeed.get(feed))
    for (const article of candidates) {
      const articleId = String(article?.id ?? '').trim()
      if (!articleId || deliveredArticleIds.has(articleId)) continue
      deliveredArticleIds.add(articleId)
      return article
    }
  }

  return null
}

function pickNewArticlesFromFeeds(feeds, rssCandidatesByFeed, maxItems = 5) {
  if (feeds.length === 0) return []
  const startOffset = pollIndex % feeds.length
  const picked = []

  for (let i = 0; i < feeds.length; i += 1) {
    const feed = feeds[(startOffset + i) % feeds.length]
    const candidates = toArray(rssCandidatesByFeed.get(feed))
    for (const article of candidates) {
      const articleId = String(article?.id ?? '').trim()
      if (!articleId || deliveredArticleIds.has(articleId) || articleById.has(articleId)) continue
      deliveredArticleIds.add(articleId)
      picked.push(article)
      if (picked.length >= maxItems) return picked
    }
  }

  return picked
}

function buildSyntheticArticle(feed) {
  const feedKey = String(feed ?? '').trim() || 'news://default'
  const nextCursor = Number(feedCursor.get(feedKey) ?? 0) + 1
  feedCursor.set(feedKey, nextCursor)

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

function normalizeArticleRecord(recordLike) {
  const record = toObject(recordLike)
  const article = toObject(record.article)
  const id = String(article.id ?? '').trim() || String(record.id ?? '').trim()
  if (!id) {
    throw new Error('store_article requires article.id')
  }

  const normalized = {
    id,
    article: {
      ...article,
      id,
      title: String(article.title ?? ''),
      source: String(article.source ?? ''),
      url: String(article.url ?? ''),
      publishedAt: String(article.publishedAt ?? new Date().toISOString()),
    },
    priority: normalizePriorityLevel(record.priority),
    topic: normalizeTopicValue(record.topic),
    unread: record.unread !== false,
    updatedAt: new Date().toISOString(),
  }

  return normalized
}

function upsertArticleRecord(recordLike) {
  const normalized = normalizeArticleRecord(recordLike)
  const existingIndex = articleStore.findIndex((entry) => entry.id === normalized.id)
  if (existingIndex >= 0) {
    articleStore[existingIndex] = normalized
  } else {
    articleStore.push(normalized)
  }
  articleById.set(normalized.id, normalized)
  if (normalized.unread) readIds.delete(normalized.id)
  return normalized
}

export default function createNewsAgentWorkspaceProvider({ workspaceDir } = {}) {
  initializeStoreTool(workspaceDir)

  return {
    poll_new_articles: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const feeds = normalizeFeedList(input.feeds)
      if (feeds.length === 0) {
        return {
          count: 0,
          first: null,
          articles: [],
        }
      }

      const limitRaw = Number(input.limit)
      const maxItems = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 100

      const fetchLimitRaw = Number(input.fetchLimit)
      const fetchLimit = Number.isFinite(fetchLimitRaw)
        ? Math.max(1, Math.min(250, Math.floor(fetchLimitRaw)))
        : Math.max(100, maxItems)

      const fetchTimeoutMsRaw = Number(input.fetchTimeoutMs)
      const fetchTimeoutMs = Number.isFinite(fetchTimeoutMsRaw)
        ? Math.max(500, Math.floor(fetchTimeoutMsRaw))
        : 6000

      const rssCandidatesByFeed = await fetchRssCandidates(feeds, {
        limit: fetchLimit,
        timeoutMs: fetchTimeoutMs,
      })
      let newArticles = pickNewArticlesFromFeeds(feeds, rssCandidatesByFeed, maxItems)

      pollIndex += 1

      const storedRows = []
      for (const article of newArticles) {
        const stored = upsertArticleRecord({
          article,
          priority: 'pending',
          topic: 'other',
          unread: true,
        })
        storedRows.push({
          id: stored.id,
          title: stored.article.title,
          source: stored.article.source,
          url: stored.article.url,
          publishedAt: stored.article.publishedAt,
          priority: stored.priority,
          topic: stored.topic,
          unread: stored.unread === true,
        })
      }

      await persistStoreStateToDisk()

      return {
        count: storedRows.length,
        first: storedRows[0] ?? null,
        articles: storedRows,
      }
    },

    poll_next_article: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const feeds = normalizeFeedList(input.feeds)
      if (feeds.length === 0) return null

      const rssCandidatesByFeed = await fetchRssCandidates(feeds)
      let article = pickNextArticleFromFeeds(feeds, rssCandidatesByFeed)
      if (!article) {
        const selectedFeed = feeds[pollIndex % feeds.length]
        const syntheticArticle = buildSyntheticArticle(selectedFeed)
        if (!articleById.has(syntheticArticle.id) && !deliveredArticleIds.has(syntheticArticle.id)) {
          deliveredArticleIds.add(syntheticArticle.id)
          article = syntheticArticle
        }
      }

      if (!article) return null
      pollIndex += 1
      upsertArticleRecord({
        article,
        priority: 'pending',
        topic: 'other',
        unread: true,
      })
      await persistStoreStateToDisk()
      return article
    },

    store_article: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const normalized = upsertArticleRecord(input)
      await persistStoreStateToDisk()
      return { stored: true, id: normalized.id }
    },

    store_articles_batch: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const unread = input.unread !== false
      const articles = toArray(input.articles).filter(isObject)
      const classifications = toArray(input.classifications).filter(isObject)
      const classificationById = new Map(
        classifications
          .map((entry) => [String(entry.id ?? '').trim(), entry])
          .filter(([id]) => Boolean(id))
      )

      const storedRows = []
      let classifiedCount = 0

      for (const article of articles) {
        const articleId = String(article.id ?? '').trim()
        if (!articleId) continue

        const classification = classificationById.get(articleId)
        if (classification) classifiedCount += 1

        const stored = upsertArticleRecord({
          article,
          priority: normalizePriorityLevel(classification?.level, 'pending'),
          topic: normalizeTopicValue(classification?.topic, 'other'),
          unread,
        })

        storedRows.push({
          id: stored.id,
          title: stored.article.title,
          source: stored.article.source,
          url: stored.article.url,
          publishedAt: stored.article.publishedAt,
          priority: stored.priority,
          topic: stored.topic,
          unread: stored.unread === true,
        })
      }

      await persistStoreStateToDisk()

      return {
        stored: storedRows.length,
        classified: classifiedCount,
        articles: storedRows,
      }
    },

    query_articles: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const unreadOnly = input.unread === true
      const topic = String(input.topic ?? '').trim().toLowerCase()
      const priority = String(input.priority ?? '').trim().toLowerCase()
      const limit = Number.isFinite(Number(input.limit)) ? Math.max(1, Math.floor(Number(input.limit))) : 20

      const filtered = articleStore.filter((entry) => {
        if (unreadOnly && entry.unread !== true) return false
        if (topic && String(entry.topic ?? '').trim().toLowerCase() !== topic) return false
        if (priority && String(entry.priority ?? '').trim().toLowerCase() !== priority) return false
        return true
      })

      const rows = filtered
        .slice(-limit)
        .reverse()
        .map((entry) => ({
          id: entry.id,
          title: entry.article.title,
          source: entry.article.source,
          url: entry.article.url,
          publishedAt: entry.article.publishedAt,
          topic: entry.topic,
          priority: entry.priority,
          unread: entry.unread === true,
        }))

      return {
        count: rows.length,
        articles: rows,
        titles: rows.map((r) => r.title),
      }
    },

    send_alert: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const alert = {
        title: String(input.title ?? ''),
        source: String(input.source ?? ''),
        topic: String(input.topic ?? ''),
        reason: String(input.reason ?? ''),
        url: String(input.url ?? ''),
        timestamp: new Date().toISOString(),
      }
      alertLog.push(alert)
      await persistStoreStateToDisk()
      return {
        sent: true,
        count: alertLog.length,
      }
    },

    mark_read: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const articleId = String(input.articleId ?? '').trim()
      if (!articleId) {
        throw new Error('mark_read requires args.articleId')
      }

      const record = articleById.get(articleId)
      if (record) {
        record.unread = false
        record.updatedAt = new Date().toISOString()
      }
      readIds.add(articleId)
      await persistStoreStateToDisk()

      return {
        marked: true,
        articleId,
      }
    },
  }
}
