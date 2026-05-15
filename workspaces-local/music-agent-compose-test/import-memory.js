#!/usr/bin/env node
import { readFileSync, createReadStream } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

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

function parseArgs(argv) {
  const args = {
    file: '',
    table: 'memory',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]
    if (part === '--file') {
      args.file = String(argv[i + 1] || '')
      i += 1
      continue
    }
    if (part === '--table') {
      args.table = String(argv[i + 1] || '')
      i += 1
      continue
    }
  }

  if (!args.file) {
    throw new Error('Missing --file argument. Usage: import-memory.js --file <jsonl-file> [--table <table-name>]')
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.table)) {
    throw new Error('Invalid --table value. Use letters, numbers, and underscores only.')
  }

  return args
}

async function ensureMemoryTable(pgPool, tableName, dimensions) {
  const client = await pgPool.connect()
  try {
    // Enable pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')

    // Create table with dynamic name
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        text text NOT NULL CHECK (length(text) <= 52428800),
        embedding vector(${dimensions}) NOT NULL,
        metadata jsonb DEFAULT '{}',
        stored_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `)

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding ON ${tableName} 
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${tableName}_stored_at ON ${tableName} (stored_at DESC)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${tableName}_metadata ON ${tableName} USING gin (metadata)
    `)

    console.log(`✓ Table ${tableName} ready`)
  } finally {
    client.release()
  }
}

async function importJsonlFile(pgPool, filePath, tableName) {
  return new Promise((resolve, reject) => {
    const fileStream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity })

    let lineNumber = 0
    let importedCount = 0
    let errorCount = 0
    const batch = []
    const batchSize = 100

    rl.on('line', async (line) => {
      lineNumber += 1
      
      if (!line.trim()) return

      try {
        const record = JSON.parse(line)
        
        // Validate required fields
        if (!record.id || !record.text || !record.embedding_vector) {
          console.warn(`Line ${lineNumber}: Skipping record - missing required fields (id, text, embedding_vector)`)
          errorCount += 1
          return
        }

        // Parse embedding vector
        let embedding
        if (typeof record.embedding_vector === 'string') {
          embedding = JSON.parse(record.embedding_vector)
        } else if (Array.isArray(record.embedding_vector)) {
          embedding = record.embedding_vector
        } else {
          console.warn(`Line ${lineNumber}: Skipping record - invalid embedding_vector format`)
          errorCount += 1
          return
        }

        // Parse metadata
        let metadata = {}
        if (typeof record.metadata_json === 'string') {
          try {
            metadata = JSON.parse(record.metadata_json)
          } catch {
            console.warn(`Line ${lineNumber}: Could not parse metadata_json, using empty object`)
          }
        } else if (typeof record.metadata_json === 'object') {
          metadata = record.metadata_json
        }

        batch.push({
          id: record.id,
          text: record.text,
          embedding,
          metadata,
          stored_at: record.stored_at || new Date().toISOString(),
          updated_at: record.updated_at || new Date().toISOString(),
        })

        if (batch.length >= batchSize) {
          rl.pause()
          await insertBatch(pgPool, tableName, batch)
          importedCount += batch.length
          batch.length = 0
          rl.resume()
        }
      } catch (err) {
        console.warn(`Line ${lineNumber}: Error parsing record: ${err.message}`)
        errorCount += 1
      }
    })

    rl.on('close', async () => {
      try {
        if (batch.length > 0) {
          await insertBatch(pgPool, tableName, batch)
          importedCount += batch.length
        }
        console.log(`\n✓ Import complete: ${importedCount} records imported, ${errorCount} errors`)
        resolve()
      } catch (err) {
        reject(err)
      }
    })

    rl.on('error', reject)
  })
}

async function insertBatch(pgPool, tableName, batch) {
  if (batch.length === 0) return

  const client = await pgPool.connect()
  try {
    await client.query('BEGIN')
    
    for (const record of batch) {
      await client.query(
        `INSERT INTO ${tableName} (id, text, embedding, metadata, stored_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           text = EXCLUDED.text,
           embedding = EXCLUDED.embedding,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at`,
        [
          record.id,
          record.text,
          JSON.stringify(record.embedding),
          JSON.stringify(record.metadata),
          record.stored_at,
          record.updated_at,
        ]
      )
    }

    await client.query('COMMIT')
    process.stdout.write('.')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function main() {
  try {
    loadDotEnv(resolve(__dirname, '.env'))
    const args = parseArgs(process.argv.slice(2))

    const dbUrl = process.env.MEMORY_DB_URL
    if (!dbUrl) {
      throw new Error('MEMORY_DB_URL environment variable not set. Check .env file.')
    }

    const embeddingDimensions = Number(process.env.MEMORY_EMBEDDING_DIMENSIONS ?? 768)
    console.log(`📚 Memory Importer`)
    console.log(`Database: ${dbUrl}`)
    console.log(`Table: ${args.table}`)
    console.log(`Embedding dimensions: ${embeddingDimensions}`)
    console.log(`File: ${args.file}\n`)

    const pgPool = new Pool({ connectionString: dbUrl })

    console.log('Creating/ensuring memory table...')
    await ensureMemoryTable(pgPool, args.table, embeddingDimensions)

    console.log('Importing records from JSONL file...')
    await importJsonlFile(pgPool, args.file, args.table)

    await pgPool.end()
    console.log('\n✓ Done!')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

main()
