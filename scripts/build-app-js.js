// scripts/build-app-js.js
// Concatenates nerve-studio/src-app/01_state.js … 14_init.js into
// nerve-studio/public/app.js in numbered order.
//
// Usage: node scripts/build-app-js.js

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const srcDir = resolve(root, 'nerve-studio/public/src-app')
const outPath = resolve(root, 'nerve-studio/public/app.js')

const partFiles = readdirSync(srcDir)
  .filter((f) => /^\d{2}_.*\.js$/.test(f))
  .sort()

if (partFiles.length === 0) {
  console.error('No part files found in nerve-studio/src-app/. Run split-app-js.js first.')
  process.exit(1)
}

const parts = partFiles.map((f) => readFileSync(resolve(srcDir, f), 'utf8'))
const output = parts.join('\n')

writeFileSync(outPath, output, 'utf8')
console.log(`Built nerve-studio/public/app.js from ${partFiles.length} parts (${output.length} chars)`)
