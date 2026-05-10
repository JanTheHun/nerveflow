#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  } catch {
    // Optional .env file.
  }
}

async function main() {
  try {
    loadDotEnv(resolve(__dirname, '.env'))

    const dbUrl = process.env.MEMORY_DB_URL
    if (!dbUrl) {
      throw new Error('MEMORY_DB_URL environment variable not set')
    }

    const pool = new Pool({ connectionString: dbUrl })
    const result = await pool.query('SELECT COUNT(*) as count FROM memory')
    const count = result.rows[0].count
    
    console.log(`✓ Memory records in database: ${count}`)
    
    // Show sample records
    const samples = await pool.query(`
      SELECT id, text, metadata FROM memory LIMIT 3
    `)
    console.log('\nSample records:')
    samples.rows.forEach((row, i) => {
      console.log(`\n  ${i + 1}. ${row.text.substring(0, 50)}...`)
      console.log(`     ID: ${row.id}`)
      console.log(`     Metadata: ${JSON.stringify(row.metadata)}`)
    })

    await pool.end()
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

main()
