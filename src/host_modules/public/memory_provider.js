/**
 * Memory Provider for PG+Vector Knowledge Base
 *
 * Provides semantic storage and retrieval tools:
 * - memory_store(text, embedding?, metadata?) -> { id, stored_at, text_preview }
 * - memory_retrieve(query_text, limit?, filter_metadata?) -> { count, items[] }
 * - memory_delete(id) -> { id, deleted }
 * - memory_update(id, text, metadata?) -> { id, updated, updated_at, text_preview }
 *
 * Requires:
 * - PG connection with pgvector extension
 * - MEMORY_DB_URL environment variable or explicit config
 * - (Phase 2) Ollama embedding model for auto-embedding
 */

import pg from 'pg'

const { Pool } = pg
const DEFAULT_EMBEDDING_DIMENSIONS = 384

function resolveEmbeddingDimensions(config) {
  const value = Number(config?.embeddingDimensions)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_EMBEDDING_DIMENSIONS
}

function isFiniteNumberArray(value) {
  return Array.isArray(value) && value.every((entry) => Number.isFinite(entry))
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isSafeMetadataKey(value) {
  return /^[A-Za-z0-9_]+$/.test(String(value ?? ''))
}

function resolveToolInput(args, positional, named) {
  if (Array.isArray(positional) && positional.length > 0 && isPlainObject(positional[0])) {
    return positional[0]
  }

  if (isPlainObject(named) && Object.keys(named).length > 0) {
    return named
  }

  const argsObject = isPlainObject(args) ? args : {}
  const argsPositional = Array.isArray(argsObject.positional) ? argsObject.positional : []
  if (argsPositional.length > 0 && isPlainObject(argsPositional[0])) {
    return argsPositional[0]
  }

  if (isPlainObject(argsObject.named) && Object.keys(argsObject.named).length > 0) {
    return argsObject.named
  }

  return argsObject
}

/**
 * Create idempotent memory table and indexes
 * @param {pg.Pool} pgPool - connected pool
 * @param {object} [options]
 * @param {number} [options.embeddingDimensions]
 * @returns {Promise<void>}
 */
export async function createMemoryTable(pgPool, options = {}) {
  const embeddingDimensions = resolveEmbeddingDimensions(options)
  const client = await pgPool.connect()
  try {
    // Enable pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')

    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS memory (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        text text NOT NULL CHECK (length(text) <= 52428800),
        embedding vector(${embeddingDimensions}) NOT NULL,
        metadata jsonb DEFAULT '{}',
        stored_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `)

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memory 
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_stored_at ON memory (stored_at DESC)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_metadata ON memory USING gin (metadata)
    `)
  } finally {
    client.release()
  }
}

/**
 * Embed text using Ollama embedding API
 * (Phase 2: will be called by store/retrieve tools)
 *
 * @param {string} text - text to embed
 * @param {string} model - Ollama model name
 * @param {string} baseUrl - Ollama base URL
 * @returns {Promise<number[]>} embedding vector
 */
export async function embedText(text, model, baseUrl) {
  if (!text || typeof text !== 'string') {
    throw new Error('embedText: text must be non-empty string')
  }

  if (!model || typeof model !== 'string') {
    throw new Error('embedText: model must be non-empty string')
  }

  const normalizedBaseUrl = String(baseUrl ?? '').trim().replace(/\/+$/g, '')
  const endpoints = [
    {
      url: `${normalizedBaseUrl}/api/embed`,
      body: { model, input: text },
      parseEmbedding: (data) => (Array.isArray(data?.embeddings?.[0]) ? data.embeddings[0] : null),
    },
    {
      url: `${normalizedBaseUrl}/api/embeddings`,
      body: { model, prompt: text },
      parseEmbedding: (data) => (Array.isArray(data?.embedding) ? data.embedding : null),
    },
    {
      url: `${normalizedBaseUrl}/v1/embeddings`,
      body: { model, input: text },
      parseEmbedding: (data) => {
        if (Array.isArray(data?.data?.[0]?.embedding)) return data.data[0].embedding
        if (Array.isArray(data?.embedding)) return data.embedding
        return null
      },
    },
  ]

  try {
    let lastHttpError = null
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpoint.body),
      })

      if (!response.ok) {
        lastHttpError = `Ollama embed failed: ${response.status} ${response.statusText}`
        if (response.status === 404) {
          continue
        }
        throw new Error(lastHttpError)
      }

      const data = await response.json()
      const embedding = endpoint.parseEmbedding(data)
      if (!Array.isArray(embedding)) {
        throw new Error('embedText: no valid embedding in response')
      }
      return embedding
    }

    throw new Error(lastHttpError || 'embedText: no embedding endpoint available')
  } catch (err) {
    throw new Error(`embedText failed: ${err?.message ?? err}`)
  }
}

/**
 * Create a memory provider (tool provider factory)
 *
 * @param {object} config
 * @param {string} config.pgUrl - PG connection string
 * @param {string} config.embeddingModel - Ollama model (default: mistral-embed)
 * @param {string} config.embeddingBaseUrl - Ollama base URL (default: http://127.0.0.1:11434)
 * @returns {object} tool provider { memory_store, memory_retrieve, memory_delete, memory_update }
 */
export function createMemoryProvider(config = {}) {
  const pgUrl = String(config.pgUrl ?? process.env.MEMORY_DB_URL ?? '').trim()
  if (!pgUrl) {
    throw new Error('createMemoryProvider: pgUrl required via config or MEMORY_DB_URL env')
  }

  const embeddingModel = String(config.embeddingModel ?? process.env.MEMORY_EMBEDDING_MODEL ?? 'mistral-embed').trim()
  const embeddingBaseUrl = String(config.embeddingBaseUrl ?? process.env.MEMORY_EMBEDDING_BASE_URL ?? 'http://127.0.0.1:11434').trim()
  const embeddingDimensions = resolveEmbeddingDimensions(config)
  const embedTextImpl = typeof config.embedText === 'function' ? config.embedText : embedText

  const poolMinSize = Number.isFinite(Number(config.poolMin)) ? Number(config.poolMin) : 2
  const poolMaxSize = Number.isFinite(Number(config.poolMax)) ? Number(config.poolMax) : 10

  let pgPool = null
  let tableInitialized = false

  // Lazy pool initialization
  async function getPool() {
    if (!pgPool) {
      pgPool = new Pool({
        connectionString: pgUrl,
        min: poolMinSize,
        max: poolMaxSize,
      })
    }
    if (!tableInitialized) {
      await createMemoryTable(pgPool, { embeddingDimensions })
      tableInitialized = true
    }
    return pgPool
  }

  return {
    memory_store: async ({ args, positional, named }) => {
      const pool = await getPool()
      const input = resolveToolInput(args, positional, named)

      const text = String(input?.text ?? '').trim()
      if (!text) {
        throw new Error('memory_store: text is required')
      }

      let embedding = input?.embedding
      if (!Array.isArray(embedding)) {
        embedding = await embedTextImpl(text, embeddingModel, embeddingBaseUrl)
      }

      if (!isFiniteNumberArray(embedding)) {
        throw new Error('memory_store: embedding must be array of numbers')
      }

      if (embedding.length !== embeddingDimensions) {
        throw new Error(`memory_store: embedding dimension mismatch. expected ${embeddingDimensions}, got ${embedding.length}`)
      }

      const metadata = input?.metadata || {}
      if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('memory_store: metadata must be an object')
      }

      try {
        const result = await pool.query(
          `INSERT INTO memory (text, embedding, metadata)
           VALUES ($1, $2::vector, $3)
           RETURNING id, stored_at, substring(text, 1, 100) as text_preview`,
          [text, `[${embedding.join(',')}]`, JSON.stringify(metadata)],
        )

        const row = result.rows[0]
        return {
          ok: true,
          id: row.id,
          stored_at: row.stored_at,
          text_preview: row.text_preview,
        }
      } catch (err) {
        throw new Error(`memory_store PG error: ${err?.message ?? err}`)
      }
    },

    memory_retrieve: async ({ args, positional, named }) => {
      const pool = await getPool()
      const input = resolveToolInput(args, positional, named)

      const queryText = String(input?.query_text ?? '').trim()
      if (!queryText) {
        throw new Error('memory_retrieve: query_text is required')
      }

      const rawLimit = input?.limit
      const limit = Math.min(
        Math.max(Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 5, 1),
        50,
      )

      let filterMetadata = input?.filter_metadata
      if (filterMetadata && (typeof filterMetadata !== 'object' || Array.isArray(filterMetadata))) {
        throw new Error('memory_retrieve: filter_metadata must be an object')
      }
      filterMetadata = filterMetadata || {}

      try {
        let queryEmbedding = input?.embedding
        if (!Array.isArray(queryEmbedding)) {
          queryEmbedding = await embedTextImpl(queryText, embeddingModel, embeddingBaseUrl)
        }

        if (!isFiniteNumberArray(queryEmbedding) || queryEmbedding.length !== embeddingDimensions) {
          throw new Error(`memory_retrieve: query embedding dimension mismatch. expected ${embeddingDimensions}`)
        }

        // Build WHERE clause for metadata filters using parameterized key/value pairs.
        let whereClause = '1=1'
        const params = [`[${queryEmbedding.join(',')}]`, limit]
        let paramIndex = 3

        const filterKeys = Object.keys(filterMetadata)
        for (const key of filterKeys) {
          if (!isSafeMetadataKey(key)) {
            throw new Error(`memory_retrieve: invalid filter_metadata key "${key}"`)
          }
          whereClause += ` AND metadata->>$${paramIndex} = $${paramIndex + 1}`
          params.push(key, String(filterMetadata[key]))
          paramIndex += 2
        }

        const result = await pool.query(
          `SELECT id, text, 
                  (1 - (embedding <=> $1::vector)) as similarity,
                  metadata, stored_at
           FROM memory
           WHERE ${whereClause}
           ORDER BY embedding <=> $1::vector ASC
           LIMIT $2`,
          params,
        )

        return {
          ok: true,
          count: result.rowCount,
          items: result.rows.map((row) => ({
            id: row.id,
            text: row.text,
            similarity: Number(row.similarity),
            metadata: row.metadata,
            stored_at: row.stored_at,
          })),
        }
      } catch (err) {
        throw new Error(`memory_retrieve error: ${err?.message ?? err}`)
      }
    },

    memory_delete: async ({ args, positional, named }) => {
      const pool = await getPool()
      const input = resolveToolInput(args, positional, named)

      const id = String(input?.id ?? '').trim()
      if (!id) {
        throw new Error('memory_delete: id is required')
      }

      try {
        const result = await pool.query(
          `DELETE FROM memory
           WHERE id = $1
           RETURNING id`,
          [id],
        )

        return {
          ok: true,
          id,
          deleted: result.rowCount > 0,
        }
      } catch (err) {
        throw new Error(`memory_delete error: ${err?.message ?? err}`)
      }
    },

    memory_update: async ({ args, positional, named }) => {
      const pool = await getPool()
      const input = resolveToolInput(args, positional, named)

      const id = String(input?.id ?? '').trim()
      if (!id) {
        throw new Error('memory_update: id is required')
      }

      const text = String(input?.text ?? '').trim()
      if (!text) {
        throw new Error('memory_update: text is required')
      }

      const metadata = input?.metadata || {}
      if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('memory_update: metadata must be an object')
      }

      try {
        let embedding = input?.embedding
        if (!Array.isArray(embedding)) {
          embedding = await embedTextImpl(text, embeddingModel, embeddingBaseUrl)
        }

        if (!isFiniteNumberArray(embedding)) {
          throw new Error('memory_update: embedding must be array of numbers')
        }

        if (embedding.length !== embeddingDimensions) {
          throw new Error(`memory_update: embedding dimension mismatch. expected ${embeddingDimensions}, got ${embedding.length}`)
        }

        const result = await pool.query(
          `UPDATE memory
           SET text = $2,
               embedding = $3::vector,
               metadata = $4,
               updated_at = now()
           WHERE id = $1
           RETURNING id, updated_at, substring(text, 1, 100) as text_preview`,
          [id, text, `[${embedding.join(',')}]`, JSON.stringify(metadata)],
        )

        if (result.rowCount < 1) {
          return {
            ok: true,
            id,
            updated: false,
          }
        }

        const row = result.rows[0]
        return {
          ok: true,
          id: row.id,
          updated: true,
          updated_at: row.updated_at,
          text_preview: row.text_preview,
        }
      } catch (err) {
        throw new Error(`memory_update error: ${err?.message ?? err}`)
      }
    },
  }
}
