import { createMemoryProvider } from '../../host_modules/public/index.js'

const DEFAULT_EMBEDDING_MODEL = 'mistral-embed'
const DEFAULT_EMBEDDING_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_EMBEDDING_DIMENSIONS = 384
const DEFAULT_POOL_MIN = 2
const DEFAULT_POOL_MAX = 10

function pickNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

/**
 * resolveLocalVectorConfig normalizes local vector provider config from
 * explicit overrides and environment variables.
 */
export function resolveLocalVectorConfig(overrides = {}, env = process.env) {
  return {
    pgUrl: String(overrides.pgUrl ?? env.MEMORY_DB_URL ?? '').trim(),
    embeddingModel: String(overrides.embeddingModel ?? env.MEMORY_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL).trim(),
    embeddingBaseUrl: String(overrides.embeddingBaseUrl ?? env.MEMORY_EMBEDDING_BASE_URL ?? DEFAULT_EMBEDDING_BASE_URL).trim(),
    embeddingDimensions: pickNumber(overrides.embeddingDimensions ?? env.MEMORY_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSIONS),
    poolMin: pickNumber(overrides.poolMin ?? env.MEMORY_POOL_MIN, DEFAULT_POOL_MIN),
    poolMax: pickNumber(overrides.poolMax ?? env.MEMORY_POOL_MAX, DEFAULT_POOL_MAX),
  }
}

/**
 * localVectorProvider creates a vector store provider using local PostgreSQL + pgvector.
 *
 * Configuration:
 *   pgUrl: PostgreSQL connection URL (required)
 *   embeddingModel: Ollama embedding model name (default: 'mistral-embed')
 *   embeddingBaseUrl: Ollama base URL (default: 'http://127.0.0.1:11434')
 *   embeddingDimensions: Embedding vector dimensions (default: 384 for mistral-embed)
 *   poolMin: Minimum pool connections (default: 2)
 *   poolMax: Maximum pool connections (default: 10)
 *
 * Provides tools:
 *   - memory_store(text, embedding?, metadata?)
 *   - memory_retrieve(query_text, limit?, filter_metadata?, embedding?)
 *   - memory_delete(id)
 *   - memory_update(id, text, metadata?, embedding?)
 */
export function localVectorProvider(config = {}) {
  return createMemoryProvider(resolveLocalVectorConfig(config))
}

/**
 * localVectorProviderFromEnv creates a local vector provider using environment
 * variables, with optional explicit overrides.
 */
export function localVectorProviderFromEnv(overrides = {}) {
  return localVectorProvider(resolveLocalVectorConfig(overrides))
}
