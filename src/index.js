export {
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  buildAgentRetryPrompt,
  extractCodeOutput,
  extractJsonOutput,
  extractTextOutput,
  NEXTV_AGENT_OUTPUT_FORMATS,
  normalizeAgentFormattedOutput,
  validateAgentReturnContract,
} from './nextv_agent_output.js'

export {
  NextVError,
  parseNextVScript,
  parseNextVScriptFromFile,
  runNextVScript,
  runNextVScriptFromFile,
  validateOutputContract,
} from './nextv_runtime.js'

export {
  checkStrictModeInstructions,
  compileAST,
} from './nextv_compiler.js'

export {
  detectCycles,
  extractEventGraph,
} from './nextv_event_graph.js'

export { NextVEventRunner } from './nextv_runner.js'

// Compatibility bridge: runtime authority APIs are canonically imported from
// `nerveflow/runtime`, while top-level exports remain available during
// the subpath-first migration window.
export {
  createRuntimeCommandRouter,
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from './runtime/index.js'
