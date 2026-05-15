// scripts/verify-editor-core-sync.js
// Verifies that packages/editor-core/src and nerve-studio/public/editor-core are identical.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const sourceDir = resolve(root, 'packages/editor-core/src')
const mirrorDir = resolve(root, 'nerve-studio/public/editor-core')

function listFilesRecursive(dir, base = dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(absolutePath, base))
      continue
    }
    if (entry.isFile()) {
      files.push(relative(base, absolutePath).replaceAll('\\\\', '/'))
    }
  }
  return files.sort()
}

if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
  console.error('Source directory missing:', sourceDir)
  process.exit(1)
}

if (!existsSync(mirrorDir) || !statSync(mirrorDir).isDirectory()) {
  console.error('Mirror directory missing:', mirrorDir)
  console.error('Run: npm run sync:editor-core')
  process.exit(1)
}

const sourceFiles = listFilesRecursive(sourceDir)
const mirrorFiles = listFilesRecursive(mirrorDir)

const missingInMirror = sourceFiles.filter((file) => !mirrorFiles.includes(file))
const extraInMirror = mirrorFiles.filter((file) => !sourceFiles.includes(file))

if (missingInMirror.length > 0 || extraInMirror.length > 0) {
  if (missingInMirror.length > 0) {
    console.error('Missing in mirror:')
    for (const file of missingInMirror) {
      console.error('  -', file)
    }
  }
  if (extraInMirror.length > 0) {
    console.error('Extra in mirror:')
    for (const file of extraInMirror) {
      console.error('  -', file)
    }
  }
  console.error('Mirror drift detected. Run: npm run sync:editor-core')
  process.exit(1)
}

const changedFiles = []
for (const file of sourceFiles) {
  const sourceText = readFileSync(resolve(sourceDir, file), 'utf8')
  const mirrorText = readFileSync(resolve(mirrorDir, file), 'utf8')
  if (sourceText !== mirrorText) {
    changedFiles.push(file)
  }
}

if (changedFiles.length > 0) {
  console.error('Content drift detected in mirror:')
  for (const file of changedFiles) {
    console.error('  -', file)
  }
  console.error('Run: npm run sync:editor-core')
  process.exit(1)
}

console.log('editor-core mirror is in sync.')
console.log('  source:', sourceDir)
console.log('  mirror:', mirrorDir)
