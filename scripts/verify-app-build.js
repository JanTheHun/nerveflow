// scripts/verify-app-build.js
// Reads the original app.js backup and the newly built app.js and confirms
// they are identical. Run after build-app-js.js to validate the split.
//
// Usage: node scripts/verify-app-build.js

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const builtPath = resolve(root, 'nerve-studio/public/app.js')
const backupPath = resolve(root, 'nerve-studio/public/app.js.bak')

if (!existsSync(backupPath)) {
  console.error('Backup not found: nerve-studio/public/app.js.bak')
  console.error('Create it first: Copy-Item nerve-studio/public/app.js nerve-studio/public/app.js.bak')
  process.exit(1)
}

const original = readFileSync(backupPath, 'utf8')
const built = readFileSync(builtPath, 'utf8')

if (original === built) {
  console.log('OK: built app.js is identical to original backup.')
  process.exit(0)
}

// Find first difference for diagnosis
const origLines = original.split('\n')
const builtLines = built.split('\n')
const maxLen = Math.max(origLines.length, builtLines.length)
let firstDiff = -1
for (let i = 0; i < maxLen; i++) {
  if (origLines[i] !== builtLines[i]) {
    firstDiff = i + 1
    break
  }
}

console.error(`MISMATCH: original ${origLines.length} lines, built ${builtLines.length} lines`)
if (firstDiff !== -1) {
  console.error(`First difference at line ${firstDiff}:`)
  console.error(`  original: ${JSON.stringify(origLines[firstDiff - 1]?.slice(0, 120))}`)
  console.error(`  built:    ${JSON.stringify(builtLines[firstDiff - 1]?.slice(0, 120))}`)
}
process.exit(1)
