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
  } catch (err) {
    console.warn('Warning: Could not load .env file:', err.message)
  }
}

async function setupDatabase() {
  try {
    loadDotEnv(resolve(__dirname, '.env'))

    const dbUrl = process.env.MEMORY_DB_URL
    if (!dbUrl) {
      throw new Error('MEMORY_DB_URL environment variable not set. Check .env file.')
    }

    // Parse the connection URL to extract database name
    const urlObj = new URL(dbUrl)
    const dbName = urlObj.pathname.slice(1) // Remove leading /
    if (!dbName) {
      throw new Error('No database name found in MEMORY_DB_URL')
    }

    // Create a pool that connects to the postgres database (default admin db)
    const adminUrl = dbUrl.replace(`/${dbName}`, '/postgres')
    console.log(`🔧 Setting up database: ${dbName}`)
    console.log(`Connecting to PostgreSQL server...`)

    const adminPool = new Pool({ connectionString: adminUrl })

    try {
      const client = await adminPool.connect()
      try {
        // Check if database exists
        const result = await client.query(
          `SELECT 1 FROM pg_database WHERE datname = $1`,
          [dbName]
        )

        if (result.rows.length === 0) {
          console.log(`Creating database ${dbName}...`)
          await client.query(`CREATE DATABASE ${dbName}`)
          console.log(`✓ Database ${dbName} created`)
        } else {
          console.log(`✓ Database ${dbName} already exists`)
        }
      } finally {
        client.release()
      }
    } finally {
      await adminPool.end()
    }

    console.log('✓ Database setup complete!')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

setupDatabase()
