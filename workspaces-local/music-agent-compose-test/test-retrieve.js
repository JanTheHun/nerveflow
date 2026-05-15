#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryProvider } from '../../src/host_modules/public/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

function loadDotEnv(envPath) {
  try {
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = line.match(/^([^#=\s][^=]*)=(.*)$/)
      if (!match) continue
      const key = match[1].trim()
      const value = match[2].trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch (err) {
    console.warn('Warning: Could not load .env file:', err.message)
  }
}

async function main() {
  try {
    loadDotEnv(resolve(__dirname, '.env'))

    console.log('🧪 Testing memory_retrieve with embedding...\n')
    console.log(`Using config:`)
    console.log(`  DB: ${process.env.MEMORY_DB_URL}`)
    console.log(`  Model: ${process.env.MEMORY_EMBEDDING_MODEL}`)
    console.log(`  Embedding Base URL: ${process.env.MEMORY_EMBEDDING_BASE_URL}`)
    console.log(`  Dimensions: ${process.env.MEMORY_EMBEDDING_DIMENSIONS}\n`)

    const provider = createMemoryProvider({
      pgUrl: process.env.MEMORY_DB_URL,
      embeddingModel: process.env.MEMORY_EMBEDDING_MODEL,
      embeddingBaseUrl: process.env.MEMORY_EMBEDDING_BASE_URL,
      embeddingDimensions: Number(process.env.MEMORY_EMBEDDING_DIMENSIONS ?? 768),
    })

    console.log('Calling memory_retrieve("garbage music")...')
    const result = await provider.memory_retrieve({
      args: {},
      positional: [
        {
          query_text: 'garbage music',
          limit: 5,
          filter_metadata: { category: 'music' },
        },
      ],
      named: {},
    })

    console.log('\n✓ Success!')
    console.log(`Found ${result.count} results:`)
    result.items.forEach((item, i) => {
      console.log(`\n  ${i + 1}. ${item.text}`)
      console.log(`     Similarity: ${(item.similarity * 100).toFixed(1)}%`)
    })

    process.exit(0)
  } catch (err) {
    console.error('\n❌ Error:', err.message)
    console.error('\nFull error:')
    console.error(err)
    process.exit(1)
  }
}

main()
