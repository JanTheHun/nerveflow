import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryProvider } from '../../../src/host_modules/public/index.js'

try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const lines = readFileSync(resolve(__dirname, '../.env'), 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (match) process.env[match[1].trim()] = match[2].trim()
  }
} catch {}

export function createProviders() {
  return [
    createMemoryProvider({
      pgUrl: process.env.MEMORY_DB_URL,
      embeddingModel: process.env.MEMORY_EMBEDDING_MODEL || 'mistral-embed',
      embeddingBaseUrl: process.env.MEMORY_EMBEDDING_BASE_URL || 'http://127.0.0.1:11434',
      embeddingDimensions: Number(process.env.MEMORY_EMBEDDING_DIMENSIONS ?? 768),
      poolMin: Number(process.env.MEMORY_POOL_MIN ?? 2),
      poolMax: Number(process.env.MEMORY_POOL_MAX ?? 10),
    }),
  ]
}
