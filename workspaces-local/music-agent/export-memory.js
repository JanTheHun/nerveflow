#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

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

function parseArgs(argv) {
  const args = {
    format: 'jsonl',
    out: '',
    table: 'memory',
    limit: 0,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]
    if (part === '--format') {
      args.format = String(argv[i + 1] || '').toLowerCase()
      i += 1
      continue
    }
    if (part === '--out') {
      args.out = String(argv[i + 1] || '')
      i += 1
      continue
    }
    if (part === '--table') {
      args.table = String(argv[i + 1] || '')
      i += 1
      continue
    }
    if (part === '--limit') {
      args.limit = Number(argv[i + 1] || 0)
      i += 1
      continue
    }
  }

  if (args.format !== 'jsonl' && args.format !== 'csv') {
    throw new Error('Invalid --format. Use jsonl or csv.')
  }
  if (!args.table) throw new Error('Invalid --table value.')
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw new Error('Invalid --limit value. Use a positive integer or 0.')
  }

  return args
}

function toSafeSqlIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}. Use letters, numbers, and underscores only.`)
  }
  return value
}

function toCsvCell(value) {
  const text = value == null ? '' : String(value)
  const escaped = text.replace(/"/g, '""')
  return `"${escaped}"`
}

function toCsv(rows) {
  const header = [
    'id',
    'text',
    'metadata_json',
    'stored_at',
    'updated_at',
    'embedding_vector',
  ]
  const lines = [header.join(',')]

  for (const row of rows) {
    lines.push([
      toCsvCell(row.id),
      toCsvCell(row.text),
      toCsvCell(row.metadata_json),
      toCsvCell(row.stored_at),
      toCsvCell(row.updated_at),
      toCsvCell(row.embedding_vector),
    ].join(','))
  }

  return `${lines.join('\n')}\n`
}

function formatError(err) {
  if (!err) return 'Unknown error'

  if (Array.isArray(err.errors) && err.errors.length > 0) {
    const details = err.errors
      .map((subErr) => {
        const code = subErr?.code ? ` (${subErr.code})` : ''
        return `- ${subErr?.message || String(subErr)}${code}`
      })
      .join('\n')
    return `${err?.message || 'AggregateError'}\n${details}`
  }

  return err?.stack || err?.message || String(err)
}

function withIpv4Localhost(connectionString) {
  try {
    const url = new URL(connectionString)
    if (url.hostname !== 'localhost') return null
    url.hostname = '127.0.0.1'
    return url.toString()
  } catch {
    return null
  }
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  loadDotEnv(resolve(__dirname, '.env'))

  const args = parseArgs(process.argv.slice(2))
  const dbUrl = process.env.MUSIC_MEMORY_DB_URL || process.env.MEMORY_DB_URL
  if (!dbUrl) {
    throw new Error('Set MUSIC_MEMORY_DB_URL or MEMORY_DB_URL before exporting.')
  }

  const now = new Date().toISOString().replace(/[.:]/g, '-')
  const extension = args.format === 'csv' ? 'csv' : 'jsonl'
  const defaultName = `memory-export-${now}.${extension}`
  const outPath = resolve(__dirname, args.out || defaultName)

  const limitClause = args.limit > 0 ? 'LIMIT $1' : ''
  const safeTable = toSafeSqlIdentifier(args.table, 'table name')
  const sql = `
    SELECT
      id,
      text,
      metadata::text AS metadata_json,
      stored_at,
      updated_at,
      embedding::text AS embedding_vector
    FROM ${safeTable}
    ORDER BY stored_at ASC
    ${limitClause}
  `

  const runExport = async (connectionString) => {
    const pool = new Pool({ connectionString })
    try {
      return args.limit > 0
        ? await pool.query(sql, [args.limit])
        : await pool.query(sql)
    } finally {
      await pool.end()
    }
  }

  try {
    let result
    try {
      result = await runExport(dbUrl)
    } catch (primaryErr) {
      const ipv4DbUrl = withIpv4Localhost(dbUrl)
      if (!ipv4DbUrl) throw primaryErr
      process.stderr.write('Primary DB connection failed; retrying with 127.0.0.1 for localhost.\n')
      result = await runExport(ipv4DbUrl)
    }

    mkdirSync(dirname(outPath), { recursive: true })

    if (args.format === 'csv') {
      writeFileSync(outPath, toCsv(result.rows), 'utf8')
    } else {
      const jsonl = `${result.rows.map((row) => JSON.stringify(row)).join('\n')}\n`
      writeFileSync(outPath, jsonl, 'utf8')
    }

    process.stdout.write(`Exported ${result.rowCount} rows to ${outPath}\n`)
  } catch (err) {
    throw new Error(formatError(err))
  }
}

main().catch((err) => {
  process.stderr.write(`Export failed:\n${formatError(err)}\n`)
  process.exitCode = 1
})
