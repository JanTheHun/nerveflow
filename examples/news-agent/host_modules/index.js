import { isAbsolute, relative, resolve } from 'node:path'
import { createPublicFileStoreProvider } from '../../../src/host_modules/public/file_store.js'
import { createPollingIngressConnector } from '../../../src/host_modules/public/polling_ingress_connector.js'
import {
  buildSyntheticRssItem,
  fetchRssCandidatesByFeed,
  mapRssItemsToIngressEvents,
  normalizeFeedList,
  pickNewRssItemsFromFeeds,
  pickNextRssItemFromFeeds,
} from '../../../src/host_modules/public/rss_source.js'

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

const articleStore = []
const articleById = new Map()
const readIds = new Set()
const feedCursor = new Map()
const alertLog = []
let pollIndex = 0
let ingestProgress = {
  batch: 0,
  batchSize: 0,
  totalIngested: 0,
  updatedAt: '',
}
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
  ingestProgress = {
    batch: 0,
    batchSize: 0,
    totalIngested: 0,
    updatedAt: '',
  }
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

  ingestProgress = normalizeIngestProgress(parsed.ingestProgress, ingestProgress)
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
    ingestProgress,
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

async function clearStoreStateFromDisk() {
  if (!storeTool || !storeRelativePath) return

  await storeTool({
    args: {
      store: storeRelativePath,
      op: 'delete',
      key: 'state',
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

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    const parsedFallback = Number(fallback)
    return Number.isFinite(parsedFallback) ? Math.max(0, Math.floor(parsedFallback)) : 0
  }
  return Math.max(0, Math.floor(parsed))
}

function normalizeIngestProgress(value, fallback = {}) {
  const source = isObject(value) ? value : {}
  return {
    batch: toNonNegativeInteger(source.batch, fallback.batch ?? 0),
    batchSize: toNonNegativeInteger(source.batchSize, fallback.batchSize ?? 0),
    totalIngested: toNonNegativeInteger(source.totalIngested, fallback.totalIngested ?? 0),
    updatedAt: String(source.updatedAt ?? fallback.updatedAt ?? ''),
  }
}

let builtinRssFetchPromise = null

async function getBuiltinRssFetch() {
  if (builtinRssFetchPromise) return builtinRssFetchPromise

  builtinRssFetchPromise = (async () => {
    const { createRuntimeBuiltinToolProvider } = await import('../../../src/host_modules/builtin/index.js')
    const builtin = createRuntimeBuiltinToolProvider()
    return builtin.rss_fetch
  })()

  return builtinRssFetchPromise
}

async function fetchRssCandidates(feeds, options = {}) {
  const rssFetch = await getBuiltinRssFetch()
  return await fetchRssCandidatesByFeed(feeds, options, { rssFetch })
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

function clearUnreadArticles() {
  const clearedCount = articleStore.reduce(
    (count, record) => count + (record.unread === true ? 1 : 0),
    0
  )

  resetStoreState()

  return {
    clearedCount,
    unreadCount: 0,
    storeCleared: true,
  }
}

export default function createNewsAgentWorkspaceProvider({ workspaceDir } = {}) {
  initializeStoreTool(workspaceDir)

  return {
    poll_source_items: async ({ args, positional }) => {
      await ensureStoreInitialized()
      const input = resolveToolInput(args, positional)
      const sourceType = String(input.sourceType ?? 'rss').trim().toLowerCase() || 'rss'
      if (sourceType !== 'rss') {
        throw new Error('poll_source_items currently supports sourceType="rss" only.')
      }

      const feeds = normalizeFeedList(input.sources ?? input.feeds)
      if (feeds.length === 0) {
        return {
          sourceType,
          count: 0,
          first: null,
          items: [],
        }
      }

      const limitRaw = Number(input.limit)
      const maxItems = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 25
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

      const mode = String(input.mode ?? 'new').trim().toLowerCase() || 'new'
      let items
      if (mode === 'next') {
        const nextItem = pickNextRssItemFromFeeds(feeds, rssCandidatesByFeed, {
          pollIndex,
          deliveredIds: deliveredArticleIds,
        })
        items = nextItem ? [nextItem] : []
      } else {
        items = pickNewRssItemsFromFeeds(feeds, rssCandidatesByFeed, {
          maxItems,
          pollIndex,
          deliveredIds: deliveredArticleIds,
          excludeIds: new Set(articleById.keys()),
        })
      }

      pollIndex += 1

      return {
        sourceType,
        count: items.length,
        first: items[0] ?? null,
        items,
      }
    },

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

      const polled = await (async () => {
        const sourceType = 'rss'
        const rssCandidatesByFeed = await fetchRssCandidates(feeds, {
          limit: fetchLimit,
          timeoutMs: fetchTimeoutMs,
        })
        const items = pickNewRssItemsFromFeeds(feeds, rssCandidatesByFeed, {
          maxItems,
          pollIndex,
          deliveredIds: deliveredArticleIds,
          excludeIds: new Set(articleById.keys()),
        })
        pollIndex += 1
        return {
          sourceType,
          count: items.length,
          first: items[0] ?? null,
          items,
        }
      })()

      const newArticles = polled.items

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
      let article = pickNextRssItemFromFeeds(feeds, rssCandidatesByFeed, {
        pollIndex,
        deliveredIds: deliveredArticleIds,
      })
      if (!article) {
        const selectedFeed = feeds[pollIndex % feeds.length]
        const syntheticArticle = buildSyntheticRssItem(selectedFeed, feedCursor)
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

      const nextIngestProgress = normalizeIngestProgress(input.ingestProgress, {
        batch: ingestProgress.batch + 1,
        batchSize: storedRows.length,
        totalIngested: ingestProgress.totalIngested + storedRows.length,
        updatedAt: ingestProgress.updatedAt,
      })
      ingestProgress = {
        ...nextIngestProgress,
        updatedAt: new Date().toISOString(),
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

    reset_unread_articles: async () => {
      await ensureStoreInitialized()
      const result = clearUnreadArticles()
      await clearStoreStateFromDisk()
      storeInitialized = false
      return {
        cleared: true,
        ...result,
      }
    },
  }
}

export function createIngressConnectors() {
  const rssPollConnector = createPollingIngressConnector({
    normalizeInput: (input) => toObject(input),
    poll: async (input) => {
      const feeds = normalizeFeedList(input.feeds ?? input.sources)
      if (feeds.length === 0) return { items: [] }

      const fetchLimitRaw = Number(input.fetchLimit)
      const fetchLimit = Number.isFinite(fetchLimitRaw)
        ? Math.max(1, Math.min(250, Math.floor(fetchLimitRaw)))
        : 100
      const fetchTimeoutMsRaw = Number(input.fetchTimeoutMs)
      const fetchTimeoutMs = Number.isFinite(fetchTimeoutMsRaw)
        ? Math.max(500, Math.floor(fetchTimeoutMsRaw))
        : 4000
      const limitRaw = Number(input.limit)
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 10

      const rssCandidatesByFeed = await fetchRssCandidates(feeds, {
        limit: fetchLimit,
        timeoutMs: fetchTimeoutMs,
      })
      const items = pickNewRssItemsFromFeeds(feeds, rssCandidatesByFeed, {
        maxItems: limit,
        pollIndex,
        deliveredIds: deliveredArticleIds,
      })
      pollIndex += 1
      return { items }
    },
    mapItemsToEvents: (items, { input }) => {
      return mapRssItemsToIngressEvents(items, {
        eventType: input.eventType,
        source: 'rss_poll',
      })
    },
    defaultEventType: 'rss_item',
  })

  return {
    user_message: async (payload) => {
      const value = String(payload?.value ?? '').trim()
      if (!value) throw new Error('user_message ingress requires a non-empty value')
      return [{ type: 'user_message', value }]
    },

    poll: async () => {
      return [{ type: 'news_tick', value: 'ingress' }]
    },

    rss_poll: async (payload) => rssPollConnector(payload),
  }
}
