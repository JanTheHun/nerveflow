#!/usr/bin/env node
/**
 * Patch to add timeout support to embedText in memory_provider.js
 * This fixes the "fetch failed" error by adding a 30-second timeout
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const filePath = resolve(
  new URL('.', import.meta.url).pathname,
  '../../../src/host_modules/public/memory_provider.js'
)

const content = readFileSync(filePath, 'utf8')

// Check if already patched
if (content.includes('AbortController')) {
  console.log('✓ memory_provider.js already has timeout support')
  process.exit(0)
}

// Add timeout support to the fetch call
const patched = content.replace(
  /const response = await fetch\(endpoint\.url, \{/,
  `const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    let response
    try {
      response = await fetch(endpoint.url, {`
).replace(
  /body: JSON\.stringify\(endpoint\.body\),\s*\}\)/,
  `body: JSON.stringify(endpoint.body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }`
)

if (patched === content) {
  console.error('❌ Could not apply patch - structure changed')
  process.exit(1)
}

writeFileSync(filePath, patched, 'utf8')
console.log('✓ Added 30-second timeout to embedText fetch calls')
