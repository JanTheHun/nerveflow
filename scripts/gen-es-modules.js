// scripts/gen-es-modules.js
// Phase 2: Convert nerve-studio/src-app/ source files to ES modules.
//
// What this script does:
//   1. Generates nerve-studio/public/src-app/state.js from 01_state.js
//      - Adds `export` to all top-level let/const/function/async function
//      - Appends setter functions for all 30 primitive `let`s
//   2. For files 02_user_output.js … 14_init.js:
//      - Adds `export` prefix to all top-level function declarations
//      - Prepends import block based on static dependency analysis
//   3. Prints a checklist of setter-call conversions still needed manually
//
// Usage: node scripts/gen-es-modules.js
// Output writes to nerve-studio/src-app/ (same directory, overwrites in-place).
// Run AFTER split-app-js.js has produced the 14 source files.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const srcDir = resolve(root, 'nerve-studio/public/src-app')

// ---------------------------------------------------------------------------
// Dependency map (from analyze-dependencies.js output, with async functions)
// key: file that needs imports; value: { './from_file.js': [fn1, fn2, ...] }
// ---------------------------------------------------------------------------
const IMPORT_MAP = {
  '02_user_output.js': {
    './03_ui_controls.js': ['buildNextVApiPath'],
    './07_graph_render.js': ['appendNextVLogRow', 'appendNextVErrorLog'],
    './11_state_panels.js': ['renderNextVSnapshot'],
    './13_layout.js': ['setStatus', 'appendErrorRow'],
  },
  '03_ui_controls.js': {
    './05_graph_viewport.js': ['captureNextVGraphViewportState', 'getControlProvenanceClass'],
    './07_graph_render.js': ['refreshNextVGraph'],
    './08_path_utils.js': ['normalizeRelativePath'],
    './10_file_tree.js': ['pathBasename', 'applyNextVStateSearchFilter'],
    './12_stream.js': ['syncNextVRuntimeState', 'runNextVRuntime', 'killNextVRuntime', 'applyLeftPanelHeights', 'applyStoredLeftPanelHeights'],
    './13_layout.js': ['ensureNextVEntrypointVisible'],
  },
  '04_floating_panels.js': {
    './07_graph_render.js': ['refreshNextVGraph'],
    './08_path_utils.js': ['normalizeRelativePath', 'normalizeNextVWorkspaceDir', 'resolveNextVPath', 'canonicalizeFloatingPanelPath', 'normalizePathSegments', 'pathDirname', 'joinRelativePath', 'normalizeGraphSourcePathForEditor'],
    './09_editor.js': ['renderOpenFileTabs', 'loadEditorFileContent', 'saveEditorFileContent', 'getPaneState', 'getPaneTextarea', 'renderPaneTitles', 'renderScriptMirrorForPane'],
    './10_file_tree.js': ['pathBasename'],
    './13_layout.js': ['setStatus', 'appendScriptLogRow', 'syncScriptBadgeState', 'normalizeNewlines', 'bindTextareaFileRefCursor', 'findScriptReferenceAtOffset', 'syncScriptMirrorScrollForPane', 'toggleCommentInTextarea'],
  },
  '05_graph_viewport.js': {
    './03_ui_controls.js': ['clearNextVGraphOutput'],
  },
  '06_graph_runtime.js': {
    './03_ui_controls.js': ['normalizeNextVGraphDirection'],
    './05_graph_viewport.js': ['getNextVGraphViewport', 'getNextVGraphCanvas', 'getNextVGraphRenderScale', 'getNextVGraphScaledPadding', 'clampNextVGraphZoom', 'splitNextVGraphHandlerLabelLines'],
  },
  '07_graph_render.js': {
    './03_ui_controls.js': ['isNextVMode', 'normalizeNextVGraphDirection', 'setNextVGraphDirection', 'setNextVControlOverlayEnabled', 'isNextVControlOverlayEnabled', 'setNextVControlBranchesVisible', 'isNextVControlBranchesVisible', 'getControlOverlayClassName', 'appendPanelLogRow', 'clearNextVGraphOutput'],
    './04_floating_panels.js': ['openFloatingGraphCodePanel'],
    './05_graph_viewport.js': ['getNextVGraphViewport', 'getNextVGraphPadding', 'clampNextVGraphZoom', 'getNextVGraphWheelZoomStep', 'applyNextVGraphZoom', 'positionNextVGraphPopover', 'centerNextVGraphViewport', 'captureNextVGraphViewportState', 'scheduleNextVGraphViewportRestore', 'zoomNextVGraph', 'resetNextVGraphZoom', 'getNextVGraphFitZoom', 'renderNextVGraphMessage', 'getTransitionClassName', 'getControlProvenanceClass', 'buildNextVControlGraphArtifacts', 'formatTransitionClassification', 'getNextVGraphHandlerLabel', 'splitNextVGraphHandlerLabelLines', 'buildNextVGraphTransitionLookup', 'appendTransitionChip'],
    './06_graph_runtime.js': ['syncNextVGraphAgentTicker', 'getNextVGraphEdgeKey', 'flushNextVGraphPendingTimerPulses', 'collectNextVGraphExternalNodeCandidates', 'getEffectOutputClassification', 'collectNextVGraphEffects', 'getNextVGraphNodeVisual', 'applyNextVGraphRuntimeVisuals', 'buildSmoothPath', 'buildNextVGraphLayout'],
    './08_path_utils.js': ['normalizeRelativePath', 'normalizeNextVWorkspaceDir', 'normalizeGraphSourcePathForEditor'],
    './10_file_tree.js': ['pathBasename'],
    './13_layout.js': ['setStatus', 'appendScriptLogRow'],
  },
  '09_editor.js': {
    './03_ui_controls.js': ['isNextVMode', 'normalizeNextVGraphDirection', 'normalizeNextVRuntimeTarget', 'getNextVRuntimeTarget'],
    './04_floating_panels.js': ['areEditorPathsEquivalent', 'syncFloatingPanelsFromEditorBuffer'],
    './07_graph_render.js': ['appendNextVErrorLog'],
    './08_path_utils.js': ['normalizeRelativePath', 'normalizeNextVWorkspaceDir', 'resolveNextVPath', 'pathDirname', 'toNextVRelativePath'],
    './10_file_tree.js': ['pathBasename'],
    './13_layout.js': ['setStatus', 'appendScriptLogRow', 'syncScriptBadgeState', 'clearScriptView', 'normalizeNewlines', 'syncScriptMirrorScroll'],
  },
  '10_file_tree.js': {
    './03_ui_controls.js': ['isNextVMode'],
  },
  '11_state_panels.js': {
    './02_user_output.js': ['normalizeUserOutputChannel', 'appendUserOutputMessage', 'appendUserOutputVoice', 'openVisualOutputWindow', 'parseMaybeJson'],
    './03_ui_controls.js': ['isNextVMode', 'clampNextVUserIOWidth', 'persistNextVUserIOWidth', 'setUserIOPanelOpen', 'setNextVRunControls'],
    './07_graph_render.js': ['appendNextVLogRow'],
    './10_file_tree.js': ['toPrettyJson', 'isObjectRecord', 'summarizeToolCallArgs', 'summarizeToolResultPayload', 'buildStateDiff', 'formatStateDiff', 'normalizeNextVStateFilterQuery', 'formatStateSectionMeta', 'isNextVStateTreeContainer', 'createNextVStateTreeNode', 'applyNextVStateSearchFilter'],
    './13_layout.js': ['setStatus', 'appendErrorRow', 'escapeHtml'],
  },
  '12_stream.js': {
    './03_ui_controls.js': ['isScriptMode', 'isNextVMode', 'setNextVImagesOpen', 'buildNextVApiPath', 'getSelectedNextVInputChannel', 'setNextVMode', 'updateRemoteRuntimeIdentity', 'updateRemoteModeBadge', 'setNextVRunControls', 'clearNextVEventsOutput', 'clearNextVConsoleOutput'],
    './06_graph_runtime.js': ['extractExecutionAgentElapsedMs', 'finalizeNextVGraphActiveAgentTimers', 'resetNextVGraphRuntimeState', 'beginNextVGraphExecutionTrail', 'flashNextVGraphExternalEvent', 'flashNextVGraphSignalDispatch', 'flashNextVGraphEventValue', 'flashNextVGraphTimerPulse', 'fadeNextVGraphActiveHighlights', 'applyNextVGraphRuntimeVisuals', 'updateNextVGraphRuntimeStep', 'inferNextVGraphFallbackHandler', 'handleNextVGraphRuntimeEvent'],
    './07_graph_render.js': ['refreshNextVGraph', 'appendNextVLogRow', 'getErrorMessageAndSource', 'appendNextVErrorLog'],
    './08_path_utils.js': ['normalizeRelativePath', 'normalizeNextVWorkspaceDir'],
    './09_editor.js': ['persistNextVConfig'],
    './10_file_tree.js': ['pathBasename', 'formatNextVStartLine', 'formatWorkspaceConfigStatus', 'formatCapabilityStatus', 'formatHostModulesStatus', 'summarizeExecutionAgentCalls', 'summarizeExecutionAgentCallDetails', 'buildStateDiff', 'clearNextVStateDiff'],
    './11_state_panels.js': ['appendNextVStateDiffEntry', 'appendTraceRows', 'clearTracePanel', 'renderCanonicalNextVEvents', 'renderNextVSnapshot', 'closeNextVStream'],
    './13_layout.js': ['setStatus', 'appendErrorRow', 'ensureNextVEntrypointVisible'],
  },
  '13_layout.js': {
    './02_user_output.js': ['updateScriptRunControls', 'normalizeDeclaredEffectChannels', 'setDeclaredEffectChannels', 'maybeRenderToolVisual', 'sendNextVUserText'],
    './03_ui_controls.js': ['isScriptMode', 'isNextVMode', 'setActiveScriptRunId', 'normalizeDeclaredExternalChannels', 'setDeclaredExternalChannels', 'setScriptMode', 'setNextVRunControls', 'clearNextVEventsOutput', 'clearNextVConsoleOutput'],
    './04_floating_panels.js': ['updateFloatingGraphCodePanelMeta', 'bindFloatingGraphCodePanelEvents'],
    './07_graph_render.js': ['refreshNextVGraph', 'appendNextVLogRow'],
    './08_path_utils.js': ['normalizeRelativePath', 'normalizeNextVWorkspaceDir', 'resolveNextVPath', 'normalizePathSegments', 'pathDirname', 'joinRelativePath'],
    './09_editor.js': ['updateOpenFileLabel', 'renderOpenFileTabs', 'getStoredNextVOpenFile', 'clearNextVAutoSaveTimer', 'rememberExpandedPath', 'clearDeleteConfirmTimers', 'loadWorkspaceTree', 'saveCurrentEditorFile', 'saveAllNextVFiles', 'getPaneIds', 'getPaneState', 'getPaneElements', 'getPaneTextarea', 'getPaneMirror', 'getPaneGutter', 'getPanePath', 'clearEditorPane', 'focusEditorPane', 'setupEditorGridCenterHandle', 'setEditorLayout', 'renderPaneTitles', 'renderScriptMirrorForPane', 'onPaneDragOver', 'onPaneDragLeave', 'onPaneDrop', 'restorePaneAssignments', 'scheduleNextVAutoSave', 'openWorkspaceEditorFile', 'persistNextVConfig'],
    './10_file_tree.js': ['pathBasename'],
    './11_state_panels.js': ['clearTracePanel', 'closeNextVStream'],
    './12_stream.js': ['scrollToBottom', 'ensureStatusBar'],
  },
  '14_init.js': {
    './02_user_output.js': ['updateScriptRunControls', 'getAvailableUserOutputChannels', 'normalizeUserOutputChannels', 'setDeclaredEffectChannels', 'renderUserOutputChannelFilters', 'applyUserOutputChannelVisibility', 'clearUserOutputPanel'],
    './03_ui_controls.js': ['isNextVMode', 'setActiveScriptRunId', 'setNextVFileDrawerOpen', 'setNextVPrimaryView', 'setNextVDevTab', 'setNextVDevConsoleOpen', 'setNextVImagesOpen', 'setNextVIngressControlsVisible', 'setNextVRuntimeTarget', 'setDeclaredExternalChannels', 'setNextVInputTab', 'setAppMode', 'setNextVRunControls'],
    './07_graph_render.js': ['appendNextVErrorLog'],
    './08_path_utils.js': ['normalizeNextVWorkspaceDir'],
    './09_editor.js': ['updateOpenFileLabel', 'initFileTreeCtxMenu', 'setEditorLayout', 'restoreNextVConfig'],
    './10_file_tree.js': ['initNextVStatePanelTools', 'initNextVStateDiffPanel', 'setupNextVStateDiffSplitter'],
    './11_state_panels.js': ['initNextVUserIOPanel', 'setupNextVUserIOSplitter', 'clearTracePanel'],
    './12_stream.js': ['syncNextVRuntimeState', 'updateNextVEventImageUI', 'setupNextVImageDropzone', 'setLeftPanelWidth', 'setupSplitter', 'setupFileTreeSplitter', 'setupVerticalSplitters'],
    './13_layout.js': ['loadSession', 'clearScriptOutput', 'clearScriptView', 'renderScriptMirror', 'openNextVWorkspace', 'addScriptInputRow'],
  },
}

// ---------------------------------------------------------------------------
// Primitive let variables (need export + setter in state.js, setter calls elsewhere)
// ---------------------------------------------------------------------------
const PRIMITIVE_LETS = [
  'pendingConfirmId',
  'isBusy',
  'activeScriptLine',
  'isResizing',
  'isFileTreeResizing',
  'isStateDiffResizing',
  'isUserIOResizing',
  'activeVerticalResize',
  'activeEditorGridResize',
  'activeScriptAbortController',
  'activeScriptRunId',
  'nextVRuntimeRunning',
  'isRemoteMode',
  'isRemoteControlMode',
  'isRemoteRuntimeConnected',
  'remoteTransport',
  'remoteRuntimeWorkspaceDir',
  'remoteRuntimeEntrypointPath',
  'nextVEventSource',
  'nextVHasLiveRuntimeEvents',
  'visualOutputWindow',
  'traceRowCounter',
  'nextVLastKnownState',
  'nextVStateFilterQuery',
  'deleteConfirmTimeoutId',
  'deleteConfirmTickerId',
  'pendingDeleteConfirmResolver',
  'pendingFloatingPanelChoiceResolver',
  'activePaneId',
  'nextVManagedProcessRunning',
]

// Raw setter name: _setFoo (underscore prefix = private/raw, avoids conflict with
// existing wrapper functions like setActiveScriptRunId in 03_ui_controls.js)
function setterName(varName) {
  return '_set' + varName.charAt(0).toUpperCase() + varName.slice(1)
}

// ---------------------------------------------------------------------------
// Step 1: Generate state.js
// ---------------------------------------------------------------------------
function generateStateJs() {
  let src = readFileSync(resolve(srcDir, '01_state.js'), 'utf8')

  // Add export to all top-level let / const / function / async function
  src = src.replace(/^let /gm, 'export let ')
  src = src.replace(/^const /gm, 'export const ')
  src = src.replace(/^function /gm, 'export function ')
  src = src.replace(/^async function /gm, 'export async function ')

  // Append setter functions for all primitive lets
  const setterLines = [
    '',
    '// --- Setters for primitive let state (used by other modules) ---',
  ]
  for (const v of PRIMITIVE_LETS) {
    const setter = setterName(v)
    setterLines.push(`export function ${setter}(v) { ${v} = v }`)
  }

  src += setterLines.join('\n') + '\n'
  writeFileSync(resolve(srcDir, 'state.js'), src, 'utf8')
  console.log('  wrote state.js')
}

// ---------------------------------------------------------------------------
// Parse all exported names from 01_state.js to build state import lists
// ---------------------------------------------------------------------------
function parseStateExports() {
  const stateSrc = readFileSync(resolve(srcDir, '01_state.js'), 'utf8')
  const names = []
  // Primitive lets
  for (const m of stateSrc.matchAll(/^let (\w+)/gm)) names.push(m[1])
  // Const declarations
  for (const m of stateSrc.matchAll(/^const (\w+)/gm)) names.push(m[1])
  // Functions
  for (const m of stateSrc.matchAll(/^(?:async\s+)?function (\w+)/gm)) names.push(m[1])
  // Setter names (generated, not in source yet)
  const primLets = []
  for (const m of stateSrc.matchAll(/^let (\w+)/gm)) primLets.push(m[1])
  for (const v of primLets) names.push(setterName(v))
  return names
}

const STATE_EXPORTS = parseStateExports()

// ---------------------------------------------------------------------------
// Step 2: Generate import block for a file
// ---------------------------------------------------------------------------
function buildImportBlock(file) {
  const deps = IMPORT_MAP[file]
  const fileSrc = readFileSync(resolve(srcDir, file), 'utf8')

  // Names already imported from cross-file src-app deps — don't duplicate in state imports
  const alreadyImported = new Set()
  if (deps) {
    for (const fns of Object.values(deps)) {
      for (const fn of fns) alreadyImported.add(fn)
    }
  }

  // State imports: scan file content for usage of each state export, excluding cross-file names
  const usedStateNames = STATE_EXPORTS.filter((name) => {
    if (alreadyImported.has(name)) return false
    return new RegExp(`\\b${name}\\b`).test(fileSrc)
  })

  const lines = ['// --- Imports (auto-generated by gen-es-modules.js) ---']

  // State import block
  if (usedStateNames.length > 0) {
    lines.push('import {')
    for (let i = 0; i < usedStateNames.length; i++) {
      const comma = i < usedStateNames.length - 1 ? ',' : ''
      lines.push(`  ${usedStateNames[i]}${comma}`)
    }
    lines.push("} from './state.js'")
  }

  // Cross-file function imports
  if (deps) {
    for (const [fromFile, fns] of Object.entries(deps)) {
      lines.push(`import {`)
      for (let i = 0; i < fns.length; i++) {
        const comma = i < fns.length - 1 ? ',' : ''
        lines.push(`  ${fns[i]}${comma}`)
      }
      lines.push(`} from '${fromFile}'`)
    }
  }

  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Step 3: Add export to top-level function declarations in a file
// ---------------------------------------------------------------------------
function addExports(src) {
  // Only replace at column 0 (true top-level)
  src = src.replace(/^function /gm, 'export function ')
  src = src.replace(/^async function /gm, 'export async function ')
  return src
}

// ---------------------------------------------------------------------------
// Step 4: Process files 02–14
// ---------------------------------------------------------------------------
function processFile(file) {
  let src = readFileSync(resolve(srcDir, file), 'utf8')
  const importBlock = buildImportBlock(file)
  src = addExports(src)
  if (importBlock) {
    src = importBlock + '\n' + src
  }
  writeFileSync(resolve(srcDir, file), src, 'utf8')
  console.log(`  updated ${file}`)
}

// ---------------------------------------------------------------------------
// Step 5: Print setter conversion checklist
// ---------------------------------------------------------------------------
function printSetterChecklist() {
  console.log('\n=== MANUAL STEP: Setter call conversions needed ===')
  console.log('For each assignment to a primitive let, change:')
  console.log('  varName = value  →  setVarName(value)')
  console.log('  ++varName        →  setVarName(varName + 1) (and update any use of the old expression)')
  console.log('\nAlso add specific state imports to each file that uses primitive lets.')
  console.log('\nPrimitive let setters generated in state.js:')
  for (const v of PRIMITIVE_LETS) {
    console.log(`  ${v} → ${setterName(v)}()`)
  }
  console.log('\nSee scripts/analyze-dependencies.js output for which files use which state vars.')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('Generating ES module scaffolding in nerve-studio/src-app/ ...')
generateStateJs()

const filesToProcess = [
  '02_user_output.js', '03_ui_controls.js', '04_floating_panels.js',
  '05_graph_viewport.js', '06_graph_runtime.js', '07_graph_render.js',
  '08_path_utils.js', '09_editor.js', '10_file_tree.js',
  '11_state_panels.js', '12_stream.js', '13_layout.js', '14_init.js',
]
for (const f of filesToProcess) {
  processFile(f)
}

printSetterChecklist()
console.log('\nDone. Next steps:')
console.log('  1. Add specific `import { ... } from ./state.js` to each file that reads/writes state')
console.log('  2. Replace primitive let assignments with setter calls (see checklist above)')
console.log('  3. Move nerve-studio/src-app/ to nerve-studio/public/src-app/')
console.log('  4. Update index.html: <script type="module" src="src-app/14_init.js">')
console.log('  5. Smoke-test the browser UI')
