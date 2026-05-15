// scripts/convert-setters.js
// Phase 2: Replaces direct primitive-let assignments with _setXxx() calls,
// and updates the state.js import block in each src-app file to include the
// needed setter imports.
//
// Handles all SINGLE-LINE assignment cases automatically.
// Multi-line assignments (marked in output) require manual handling.
//
// Usage: node scripts/convert-setters.js

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const srcDir = resolve(root, 'nerve-studio/public/src-app')

function read(f) { return readFileSync(resolve(srcDir, f), 'utf8') }
function write(f, src) { writeFileSync(resolve(srcDir, f), src, 'utf8') }

// Setter name convention (must match gen-es-modules.js)
function setter(varName) {
  return '_set' + varName.charAt(0).toUpperCase() + varName.slice(1)
}

// Replace a single-line assignment of a primitive let with a setter call.
// Handles:  [whitespace]varName = EXPR;  →  [whitespace]_setVarName(EXPR);
// DOES NOT handle multi-line assignments — those are printed as TODOs.
function replaceAssignment(src, varName, options = {}) {
  const s = setter(varName)
  // Regex: optional leading whitespace + varName + ' = ' + everything to end of line
  // Uses negative lookahead to avoid matching e.g. `someOtherVar = varName = ...` incorrectly
  const re = new RegExp(
    `^([ \\t]*(?:if\\s*\\([^)]+\\)\\s*)?)${varName}(\\s*=(?!=)\\s*)(.+)$`,
    'gm'
  )
  return src.replace(re, (match, prefix, _eq, rhs) => {
    rhs = rhs.trimEnd()
    // Detect multi-line assignment starts (opening { or ( without a closing balance)
    const opens = (rhs.match(/[({]/g) || []).length
    const closes = (rhs.match(/[)}]/g) || []).length
    if (opens > closes) {
      // Can't auto-convert — mark for manual handling
      return `${prefix}/* TODO(setter): ${varName} = ${rhs} */\n${prefix}/* TODO: _set${varName.charAt(0).toUpperCase() + varName.slice(1)}(...) */`
    }
    // Strip trailing semicolon if present (will re-add after closing paren)
    const hasSemi = rhs.endsWith(';')
    const rhsClean = hasSemi ? rhs.slice(0, -1) : rhs
    return `${prefix}${s}(${rhsClean})${hasSemi ? ';' : ''}`
  })
}

// Add a setter import to the state.js import block at the top of a file.
// The block looks like: import { ... } from './state.js'
function addSetterImports(src, setterNames) {
  // Find the state.js import block
  const stateImportRe = /import \{([^}]+)\} from '\.\/state\.js'/
  const m = src.match(stateImportRe)
  if (!m) {
    // No state import block yet — prepend one after the header comment line
    const headerEnd = src.indexOf('\n') + 1
    const imports = setterNames.map(n => `  ${n}`).join(',\n')
    return src.slice(0, headerEnd) + `import {\n${imports}\n} from './state.js'\n` + src.slice(headerEnd)
  }
  // Add setterNames to the existing block (deduplicate)
  const existing = m[1].split(',').map(s => s.trim()).filter(Boolean)
  const merged = [...new Set([...existing, ...setterNames])].sort()
  const replacement = `import {\n${merged.map(n => `  ${n}`).join(',\n')}\n} from './state.js'`
  return src.replace(stateImportRe, replacement)
}

// ---------------------------------------------------------------------------
// Per-file transformation plan
// ---------------------------------------------------------------------------

// Format: [ [varName, file, replacements?], ... ]
// Replacements are applied in order by replaceAssignment()
// Files with only multi-line assignments get TODO markers.

const plan = [
  // 02_user_output.js
  { file: '02_user_output.js', vars: ['visualOutputWindow'] },

  // 03_ui_controls.js
  { file: '03_ui_controls.js', vars: ['activeScriptRunId', 'remoteRuntimeWorkspaceDir', 'remoteRuntimeEntrypointPath'] },

  // 04_floating_panels.js
  { file: '04_floating_panels.js', vars: ['pendingFloatingPanelChoiceResolver'] },

  // 09_editor.js
  { file: '09_editor.js', vars: [
    'deleteConfirmTimeoutId',
    'deleteConfirmTickerId',
    'pendingDeleteConfirmResolver',
    'activePaneId',
    'activeEditorGridResize',
    'activeScriptLine',
  ]},

  // 10_file_tree.js
  { file: '10_file_tree.js', vars: ['nextVStateFilterQuery', 'isStateDiffResizing'] },

  // 11_state_panels.js
  { file: '11_state_panels.js', vars: [
    'isUserIOResizing',
    'nextVRuntimeRunning',
    'nextVLastKnownState',
    'nextVEventSource',
    'nextVHasLiveRuntimeEvents',
  ]},

  // 12_stream.js
  { file: '12_stream.js', vars: [
    'nextVEventSource',
    'nextVHasLiveRuntimeEvents',
    'nextVLastKnownState',
    'nextVRuntimeRunning',
    'nextVManagedProcessRunning',
    'isRemoteMode',
    'isRemoteControlMode',
    'remoteTransport',
    'isRemoteRuntimeConnected',
    'isResizing',
    'isFileTreeResizing',
    'activeVerticalResize',
  ]},

  // 13_layout.js
  { file: '13_layout.js', vars: [
    'activeScriptLine',
    'isBusy',
    'activeScriptAbortController',
  ]},
]

// Special: traceRowCounter (pre-increment pattern in 11_state_panels.js)
// const rowId = `trace-${++traceRowCounter}` → needs manual split into two lines

let totalConverted = 0
let totalTodo = 0

for (const { file, vars } of plan) {
  let src = read(file)
  const settersUsed = []

  for (const v of vars) {
    const before = src
    src = replaceAssignment(src, v)
    if (src !== before) {
      settersUsed.push(setter(v))
      const count = (src.match(new RegExp(`${setter(v)}\\(`, 'g')) || []).length
      totalConverted += count
      const todoCount = (src.match(/\/\* TODO\(setter\):/g) || []).length
      totalTodo += todoCount
    }
  }

  if (settersUsed.length > 0) {
    src = addSetterImports(src, [...new Set(settersUsed)])
  }

  write(file, src)
  console.log(`  ${file}: converted ${settersUsed.length} variable(s)`)
}

// Handle traceRowCounter special case in 11_state_panels.js
{
  let src = read('11_state_panels.js')
  src = src.replace(
    /const rowId = `trace-\$\{\+\+traceRowCounter\}`/g,
    '_setTraceRowCounter(traceRowCounter + 1)\n  const rowId = `trace-${traceRowCounter}`'
  )
  src = addSetterImports(src, ['_setTraceRowCounter'])
  write('11_state_panels.js', src)
  console.log('  11_state_panels.js: converted traceRowCounter++ (special case)')
}

console.log(`\nDone. ~${totalConverted} setter calls inserted, ${totalTodo} TODO markers left for manual handling.`)
console.log('\nManual steps still needed:')
console.log('  1. Search for /* TODO(setter): */ in src-app files and fix multi-line assignments')
console.log('  2. In 09_editor.js: deleteConfirmTickerId = window.setInterval(...) and deleteConfirmTimeoutId = window.setTimeout(...)')
console.log('  3. In 12_stream.js: activeVerticalResize = { ... } (multi-line object)')
console.log('  4. Verify state.js import blocks are correct in all files')
