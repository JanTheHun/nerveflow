#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const srcDir = path.join(rootDir, 'src')
const blockedPatterns = [
  /nerve-studio/i,
  /src\\\/nextv_/i,
  /src\/nextv_/i,
]

function walkFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath))
      continue
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath)
    }
  }
  return files
}

function main() {
  if (!fs.existsSync(srcDir)) {
    console.error('Boundary check failed: src directory is missing.')
    process.exit(1)
  }

  const files = walkFiles(srcDir)
  const violations = []

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8')
    for (const pattern of blockedPatterns) {
      if (pattern.test(source)) {
        violations.push({ filePath, pattern: String(pattern) })
      }
    }
  }

  if (violations.length > 0) {
    console.error('Boundary check failed. Disallowed references found:')
    for (const violation of violations) {
      console.error(`- ${violation.filePath} matched ${violation.pattern}`)
    }
    process.exit(1)
  }

  console.log('Boundary check passed. No disallowed imports or references found.')
}

main()
