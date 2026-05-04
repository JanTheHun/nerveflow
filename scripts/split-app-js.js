// scripts/split-app-js.js
// One-time script: slices nerve-studio/public/app.js into src-app/ source parts.
// Run once to create the initial src-app directory. After that, edit src-app files
// directly and rebuild with: node scripts/build-app-js.js
//
// Usage: node scripts/split-app-js.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const srcDir = resolve(root, 'nerve-studio/public/src-app')
const appJsPath = resolve(root, 'nerve-studio/public/app.js')

mkdirSync(srcDir, { recursive: true })

const lines = readFileSync(appJsPath, 'utf8').split('\n')
const totalLines = lines.length
console.log(`app.js: ${totalLines} lines`)

// Line ranges are 1-based, inclusive on both ends.
// Seams are chosen at function boundaries found by inspecting the file.
const parts = [
  { file: '01_state.js',          start: 1,    end: 408  },
  { file: '02_user_output.js',    start: 409,  end: 724  },
  { file: '03_ui_controls.js',    start: 725,  end: 1383 },
  { file: '04_floating_panels.js',start: 1384, end: 1930 },
  { file: '05_graph_viewport.js', start: 1931, end: 2534 },
  { file: '06_graph_runtime.js',  start: 2535, end: 3628 },
  { file: '07_graph_render.js',   start: 3629, end: 4917 },
  { file: '08_path_utils.js',     start: 4918, end: 5016 },
  { file: '09_editor.js',         start: 5017, end: 6550 },
  { file: '10_file_tree.js',      start: 6551, end: 7048 },
  { file: '11_state_panels.js',   start: 7049, end: 7460 },
  { file: '12_stream.js',         start: 7461, end: 8342 },
  { file: '13_layout.js',         start: 8343, end: 9926 },
  { file: '14_init.js',           start: 9927, end: totalLines },
]

// Verify no gaps or overlaps
let expected = 1
for (const part of parts) {
  if (part.start !== expected) {
    console.error(`Gap/overlap: expected start ${expected}, got ${part.start} for ${part.file}`)
    process.exit(1)
  }
  expected = part.end + 1
}
if (expected - 1 !== totalLines) {
  console.error(`Last part ends at ${expected - 1} but file has ${totalLines} lines`)
  process.exit(1)
}

for (const { file, start, end } of parts) {
  // 0-indexed slice
  const content = lines.slice(start - 1, end).join('\n')
  const outPath = resolve(srcDir, file)
  writeFileSync(outPath, content, 'utf8')
  console.log(`  wrote ${file} (lines ${start}–${end}, ${end - start + 1} lines)`)
}

console.log(`\nDone. ${parts.length} files written to nerve-studio/src-app/`)
console.log('Verify with: node scripts/build-app-js.js && node scripts/verify-app-build.js')
