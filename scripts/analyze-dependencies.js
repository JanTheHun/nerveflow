// scripts/analyze-dependencies.js
// Analyzes cross-file function call dependencies across nerve-studio/src-app/
// Output: which file needs to import which functions from which other files.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dir = resolve(root, 'nerve-studio/public/src-app')

const files = readdirSync(dir).filter((f) => /^\d{2}_.*\.js$/.test(f)).sort()

// Extract all top-level function declarations from each file
const fileFunctions = new Map()
for (const f of files) {
  const src = readFileSync(resolve(dir, f), 'utf8')
  const fns = []
  for (const m of src.matchAll(/^(?:async\s+)?function (\w+)/gm)) fns.push(m[1])
  fileFunctions.set(f, fns)
}

// Escape regex special chars in function name (none expected, but safe)
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// For each (defFile, callerFile) pair, count calls
// Returns: callerFile -> Set<functionName> that it calls from defFile
const importNeeds = new Map() // callerFile -> Map<defFile, Set<fnName>>
for (const [defFile, fns] of fileFunctions) {
  for (const [callerFile] of fileFunctions) {
    if (callerFile === defFile) continue
    const callerSrc = readFileSync(resolve(dir, callerFile), 'utf8')
    const needed = []
    for (const fn of fns) {
      const re = new RegExp('\\b' + escRe(fn) + '\\b', 'g')
      if (re.test(callerSrc)) needed.push(fn)
    }
    if (needed.length) {
      if (!importNeeds.has(callerFile)) importNeeds.set(callerFile, new Map())
      importNeeds.get(callerFile).set(defFile, needed)
    }
  }
}

// Print: for each file, what imports it needs
console.log('\n=== Required imports per file ===')
for (const f of files) {
  const needs = importNeeds.get(f)
  if (!needs || !needs.size) continue
  console.log(`\n${f}:`)
  for (const [defFile, fns] of [...needs.entries()].sort()) {
    console.log(`  from './${defFile}': ${fns.join(', ')}`)
  }
}

// Also print a summary: total cross-file import statements needed
let totalImportLines = 0
for (const needs of importNeeds.values()) totalImportLines += needs.size
console.log(`\n=== Summary ===`)
console.log(`Total import-from lines needed: ${totalImportLines}`)
console.log(`Files with no outbound imports: ${files.filter(f => !importNeeds.has(f)).join(', ')}`)
