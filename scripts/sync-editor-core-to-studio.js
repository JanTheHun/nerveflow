// scripts/sync-editor-core-to-studio.js
// Keeps Studio's static browser copy of editor-core in sync with package source.
// Usage: node scripts/sync-editor-core-to-studio.js

import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const sourceDir = resolve(root, 'packages/editor-core/src')
const targetDir = resolve(root, 'nerve-studio/public/editor-core')

if (!existsSync(sourceDir)) {
  console.error('editor-core source directory not found:', sourceDir)
  process.exit(1)
}

rmSync(targetDir, { recursive: true, force: true })
cpSync(sourceDir, targetDir, { recursive: true })

console.log('Synced editor-core package source to Studio public mirror.')
console.log('  from:', sourceDir)
console.log('  to:  ', targetDir)
