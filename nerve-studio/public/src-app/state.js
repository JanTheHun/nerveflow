/* app.js — minimal event glue for local-agent web UI */

// --- State ---
export let pendingConfirmId = null
export let isBusy = false
export let activeScriptLine = null
export let isResizing = false
export let isFileTreeResizing = false
export let isStateDiffResizing = false
export let isUserIOResizing = false
export let activeVerticalResize = null
export let activeEditorGridResize = false
export let activeScriptAbortController = null
export let activeScriptRunId = ''
export let nextVRuntimeRunning = false
export let nextVCandidatePromotable = false
export let isRemoteMode = false
export let isRemoteControlMode = false
export let isRemoteRuntimeConnected = true
export let remoteTransport = 'local'
export let remoteRuntimeWorkspaceDir = ''
export let remoteRuntimeEntrypointPath = ''
export let nextVEventSource = null
export let nextVHasLiveRuntimeEvents = false
export let visualOutputWindow = null
export let traceRowCounter = 0
export let nextVLastKnownState = null
export let nextVStateFilterQuery = ''
export let nextVExecutionGroups = []
export let nextVExecutionCounter = 0
export let nextVEventsLiveMode = true
export let nextVEventsPausedBuffer = []
export let deleteConfirmTimeoutId = null
export let deleteConfirmTickerId = null
export let pendingDeleteConfirmResolver = null
export let pendingFloatingPanelChoiceResolver = null
export const nextVStateSectionOpenByKey = new Map()
export const SCRIPT_FILE_REF_REGEX = /([!?])?file:([^\s"']+)/g
export const SCRIPT_FILE_CALL_REGEX = /\bfile\(["']([^"'\n]+)["']\)/g
export const FLOATING_PANEL_IDS = ['FLOAT1', 'FLOAT2']

export const scriptCache = new Map()
export const dirtyEditsCache = new Map() // stashed unsaved edits per file when autosave is off
export const storageKeys = {
  mode: 'local-agent.mode',
  leftWidth: 'local-agent.leftPanelWidth',
  leftHeights: 'local-agent.leftPanelHeights',
  nextVWorkspaceDir: 'local-agent.nextv.workspaceDir',
  nextVEntrypoint: 'local-agent.nextv.entrypointPath',
  nextVAutoSave: 'local-agent.nextv.autoSave',
  nextVPrimaryView: 'local-agent.nextv.primaryView',
  nextVDevTab: 'local-agent.nextv.devTab',
  nextVDevConsoleOpen: 'local-agent.nextv.devConsoleOpen',
  nextVInputTab: 'local-agent.nextv.inputTab',
  nextVImagesOpen: 'local-agent.nextv.imagesOpen',
  nextVOpenFile: 'local-agent.nextv.openFilePath',
  nextVTreeWidth: 'local-agent.nextv.treeWidth',
  nextVTreeDrawerOpen: 'local-agent.nextv.treeDrawerOpen',
  nextVStateDiffOpen: 'local-agent.nextv.stateDiffOpen',
  nextVStateDiffWidth: 'local-agent.nextv.stateDiffWidth',
  nextVStateFilter: 'local-agent.nextv.stateFilter',
  nextVUserIOOpen: 'local-agent.nextv.userIOOpen',
  nextVUserIOWidth: 'local-agent.nextv.userIOWidth',
  nextVUserOutputChannels: 'local-agent.nextv.userOutputChannels',
  nextVIngressControlsVisible: 'local-agent.nextv.ingressControlsVisible',
  nextVRuntimeTarget: 'local-agent.nextv.runtimeTarget',
  nextVAttachWsUrl: 'local-agent.nextv.attachWsUrl',
  nextVAttachStartOverride: 'local-agent.nextv.attachStartOverride',
  nextVGraphDirection: 'local-agent.nextv.graphDirection',
  nextVControlOverlay: 'local-agent.nextv.controlOverlay',
  nextVShowControlBranches: 'local-agent.nextv.showControlBranches',
  nextVCallInspectorPanelLayout: 'local-agent.nextv.callInspectorPanelLayout',
  nextVCallInspectorResultTab: 'local-agent.nextv.callInspectorResultTab',
  nextVCallInspectorTargetKind: 'local-agent.nextv.callInspectorTargetKind',
  nextVCallInspectorMode: 'local-agent.nextv.callInspectorMode',
  nextVCallInspectorTargetAgent: 'local-agent.nextv.callInspectorTargetAgent',
  nextVCallInspectorTargetModel: 'local-agent.nextv.callInspectorTargetModel',
  nextVCallInspectorValidate: 'local-agent.nextv.callInspectorValidate',
  nextVCallInspectorRetry: 'local-agent.nextv.callInspectorRetry',
  nextVCallInspectorInstructions: 'local-agent.nextv.callInspectorInstructions',
  nextVCallInspectorPrompt: 'local-agent.nextv.callInspectorPrompt',
  nextVCallInspectorReturns: 'local-agent.nextv.callInspectorReturns',
  nextVCallInspectorDecide: 'local-agent.nextv.callInspectorDecide',
  nextVCallInspectorToolsMode: 'local-agent.nextv.callInspectorToolsMode',
  nextVCallInspectorToolsMaxRounds: 'local-agent.nextv.callInspectorToolsMaxRounds',
  nextVCallInspectorToolsTimeoutMs: 'local-agent.nextv.callInspectorToolsTimeoutMs',
  nextVCallInspectorToolsDenyUnknown: 'local-agent.nextv.callInspectorToolsDenyUnknown',
  nextVCallInspectorToolsExtra: 'local-agent.nextv.callInspectorToolsExtra',
  nextVCallInspectorToolsChecked: 'local-agent.nextv.callInspectorToolsChecked',
  nextVEditorGridSplit: 'local-agent.nextv.editorGridSplit',
  nextVEditorLayout: 'local-agent.nextv.editorLayout',
  nextVEditorTabSize: 'local-agent.nextv.editorTabSize',
  nextVEditorSurfaceBeta: 'local-agent.nextv.editorSurfaceBeta',
  nextVEditorSurfaceTelemetry: 'local-agent.nextv.editorSurfaceTelemetry',
}

export const MIN_LEFT_PANEL_SECTION_HEIGHT = 90
export const DEFAULT_EDITOR_GRID_SPLIT_PERCENT = 50
export const MIN_EDITOR_GRID_SPLIT_PERCENT = 20

export function createEditorPaneState(id) {
  return {
    id,
    path: '',
    loadedText: '',
    dirty: false,
  }
}

export function createFloatingGraphPanelState(id) {
  return {
    id,
    open: false,
    filePath: '',
    line: null,
    loadedText: '',
    dirty: false,
    anchorNodeId: '',
    lastFocusedAt: 0,
  }
}

export const editorLayoutState = {
  layoutMode: 'split-2',
  activePaneId: 'A',
  paneOrder: ['A', 'B'],
  allPanes: ['A', 'B', 'C', 'D'],
}

export const editorGridSplitState = {
  xPercent: DEFAULT_EDITOR_GRID_SPLIT_PERCENT,
  yPercent: DEFAULT_EDITOR_GRID_SPLIT_PERCENT,
}

export const scriptEditorState = createEditorPaneState('A')
export const editorPaneBState = createEditorPaneState('B')
export const editorPaneCState = createEditorPaneState('C')
export const editorPaneDState = createEditorPaneState('D')
export let activePaneId = editorLayoutState.activePaneId
export const editorPaneStateById = new Map([
  ['A', scriptEditorState],
  ['B', editorPaneBState],
  ['C', editorPaneCState],
  ['D', editorPaneDState],
])
export const paneAssignments = new Map() // filePath → 'A' | 'B' | 'C' | 'D'

export const nextVFileState = {
  tree: null,
  openFilePath: '',
  openTabs: [],
  workspaceDir: '',
  expandedDirs: new Set(),
  autoSaveTimer: null,
}

export const tracePanelState = {
  rows: [],
  selectedId: '',
  currentTab: 'events',
}

export const nextVViewState = {
  currentView: 'graph',
}

export const nextVPanelState = {
  devConsoleOpen: true,
}

export const userIOPanelState = {
  open: false,
}

export const nextVGraphState = {
  nodes: [],
  edges: [],
  controlEdges: [],
  cycles: [],
  entrypointPath: '',
  ignoredDynamicEmits: [],
  transitions: [],
  contractWarnings: [],
  declaredExternalNodes: new Set(),
  contractWarningNodes: new Map(),
  zoom: 1,
  nodeElements: new Map(),
  edgeElements: new Map(),
  stepLabelElements: new Map(),
  handlerLabelLineElements: new Map(),
  agentTimerLabelElements: new Map(),
  runtimeStepByNode: new Map(),
  runtimeAgentCallTimersByNode: new Map(),
  runtimeVisitedEdges: new Set(),
  runtimeActiveNodes: new Set(),
  runtimeActiveEdges: new Set(),
  runtimeExternalNodes: new Set(),
  runtimeTriggeredExternalNodes: new Set(),
  runtimeWarningNodes: new Set(),
  runtimeTimers: new Set(),
  visualPulseTimers: new Set(),
  visualPulseTimersByNode: new Map(),
  runtimeLastDispatchedNode: '',
  runtimeSequence: 0,
  runtimeAgentTickerId: null,
  selectedNodeId: '',
  autoFollowEnabled: false,
  layoutDirection: 'TB',
  controlOverlayEnabled: true,
  showControlBranches: false,
  setSelectedGraphNodeFn: null,
  layoutPositions: new Map(),
  savedViewportState: null,
  pendingTimerPulses: [],
  graphRefreshInProgress: false,
  detailPopoverEl: null,
  canvasEl: null,
  floatingPanels: new Map([
    ['FLOAT1', createFloatingGraphPanelState('FLOAT1')],
    ['FLOAT2', createFloatingGraphPanelState('FLOAT2')],
  ]),
  activeFloatingPanelId: 'FLOAT1',
}

export const inputPanelState = {
  currentTab: 'ui',
}

export const nextVInputChannelState = {
  declaredExternals: [],
}

export const nextVInputImageState = {
  entries: [],
  open: false,
}

export const nextVIngressControlsState = {
  visible: true,
}

export const nextVRuntimeTargetState = {
  target: 'attach',
  attachWsUrl: '',
}

export const nextVAttachSessionState = {
  attached: false,
  connecting: false,
  lastError: '',
}

export const nextVGraphMappingApi = globalThis?.nextVGraphMapping || null

export let nextVManagedProcessRunning = false

export const DEFAULT_USER_OUTPUT_CHANNELS = ['text', 'json', 'voice']

export const userOutputChannelState = {
  declaredEffects: [],
}

export const userOutputFilterState = {
  channels: new Set(DEFAULT_USER_OUTPUT_CHANNELS),
}

// --- DOM helpers ---
export const scriptPathInput = document.getElementById('script-path')
export const scriptInputs = document.getElementById('script-inputs')
export const scriptLineGutter = document.getElementById('script-line-gutter')
export const scriptView = document.getElementById('script-view')
export const scriptViewMirror = document.getElementById('script-view-mirror')
export const scriptViewB = document.getElementById('script-view-b')
export const scriptLineGutterB = document.getElementById('script-line-gutter-b')
export const scriptViewMirrorB = document.getElementById('script-view-mirror-b')
export const scriptViewC = document.getElementById('script-view-c')
export const scriptLineGutterC = document.getElementById('script-line-gutter-c')
export const scriptViewMirrorC = document.getElementById('script-view-mirror-c')
export const scriptViewD = document.getElementById('script-view-d')
export const scriptLineGutterD = document.getElementById('script-line-gutter-d')
export const scriptViewMirrorD = document.getElementById('script-view-mirror-d')
export const nextVFloatingCodePanel = document.getElementById('nextv-floating-code-panel')
export const nextVFloatingCodePanel2 = document.getElementById('nextv-floating-code-panel-2')
export const nextVFloatingCodeTitle = document.getElementById('nextv-floating-code-title')
export const nextVFloatingCodeTitle2 = document.getElementById('nextv-floating-code-title-2')
export const nextVFloatingCodePath = document.getElementById('nextv-floating-code-path')
export const nextVFloatingCodePath2 = document.getElementById('nextv-floating-code-path-2')
export const nextVFloatingCodeLine = document.getElementById('nextv-floating-code-line')
export const nextVFloatingCodeLine2 = document.getElementById('nextv-floating-code-line-2')
export const nextVFloatingCodeDirty = document.getElementById('nextv-floating-code-dirty')
export const nextVFloatingCodeDirty2 = document.getElementById('nextv-floating-code-dirty-2')
export const nextVFloatingCodeTextarea = document.getElementById('nextv-floating-code-textarea')
export const nextVFloatingCodeTextarea2 = document.getElementById('nextv-floating-code-textarea-2')
export const nextVFloatingCodeMirror = document.getElementById('nextv-floating-code-mirror')
export const nextVFloatingCodeMirror2 = document.getElementById('nextv-floating-code-mirror-2')
export const nextVFloatingCodeGutter = document.getElementById('nextv-floating-code-gutter')
export const nextVFloatingCodeGutter2 = document.getElementById('nextv-floating-code-gutter-2')
export const nextVFloatingPanelChooser = document.getElementById('nextv-floating-panel-chooser')
export const nextVFloatingPanelChooserTitle = document.getElementById('nextv-floating-panel-chooser-title')
export const nextVFloatingPanelChooserDetails = document.getElementById('nextv-floating-panel-chooser-details')
export const nextVFloatingPanelChooserPanel1Btn = document.getElementById('nextv-floating-panel-chooser-panel1')
export const nextVFloatingPanelChooserPanel2Btn = document.getElementById('nextv-floating-panel-chooser-panel2')
export const nextVFloatingPanelChooserCancelBtn = document.getElementById('nextv-floating-panel-chooser-cancel')
export const editorPanesGrid = document.getElementById('editor-panes-grid')
export const editorPaneA = document.getElementById('editor-pane-a')
export const editorPaneB = document.getElementById('editor-pane-b')
export const editorPaneC = document.getElementById('editor-pane-c')
export const editorPaneD = document.getElementById('editor-pane-d')
export const paneTitleA = document.getElementById('pane-a-title')
export const paneTitleB = document.getElementById('pane-b-title')
export const paneTitleC = document.getElementById('pane-c-title')
export const paneTitleD = document.getElementById('pane-d-title')
export const editorLayoutSplitBtn = document.getElementById('editor-layout-split-btn')
export const editorLayoutGridBtn = document.getElementById('editor-layout-grid-btn')
export const editorGridCenterHandle = document.getElementById('editor-grid-center-handle')
export const editorPaneDescriptors = new Map([
  ['A', {
    pane: editorPaneA,
    title: paneTitleA,
    textarea: scriptView,
    mirror: scriptViewMirror,
    gutter: scriptLineGutter,
  }],
  ['B', {
    pane: editorPaneB,
    title: paneTitleB,
    textarea: scriptViewB,
    mirror: scriptViewMirrorB,
    gutter: scriptLineGutterB,
  }],
  ['C', {
    pane: editorPaneC,
    title: paneTitleC,
    textarea: scriptViewC,
    mirror: scriptViewMirrorC,
    gutter: scriptLineGutterC,
  }],
  ['D', {
    pane: editorPaneD,
    title: paneTitleD,
    textarea: scriptViewD,
    mirror: scriptViewMirrorD,
    gutter: scriptLineGutterD,
  }],
  ['FLOAT1', {
    pane: nextVFloatingCodePanel,
    title: nextVFloatingCodeTitle,
    textarea: nextVFloatingCodeTextarea,
    mirror: nextVFloatingCodeMirror,
    gutter: nextVFloatingCodeGutter,
  }],
  ['FLOAT2', {
    pane: nextVFloatingCodePanel2,
    title: nextVFloatingCodeTitle2,
    textarea: nextVFloatingCodeTextarea2,
    mirror: nextVFloatingCodeMirror2,
    gutter: nextVFloatingCodeGutter2,
  }],
])
export const scriptLogs = document.getElementById('script-logs')
export const scriptOutput = document.getElementById('script-output')
export const scriptHeaderTitle = document.getElementById('script-header-title')
export const scriptHeaderBadge = document.getElementById('script-header-badge')
export const logsHeaderTitle = document.getElementById('logs-header-title')
export const logsHeaderBadge = document.getElementById('logs-header-badge')
export const outputHeaderTitle = document.getElementById('output-header-title')
export const outputHeaderBadge = document.getElementById('output-header-badge')
export const nextVDevTabs = document.getElementById('nextv-dev-tabs')
export const nextVTabEvents = document.getElementById('nextv-tab-events')
export const nextVTabTrace = document.getElementById('nextv-tab-trace')
export const nextVTabConsole = document.getElementById('nextv-tab-console')
export const nextVTabCallInspector = document.getElementById('nextv-view-call-inspector')
export const nextVPrimaryTabs = document.getElementById('nextv-primary-tabs')
export const nextVViewEditor = document.getElementById('nextv-view-editor')
export const nextVViewGraph = document.getElementById('nextv-view-graph')
export const nextVViewCallInspector = document.getElementById('nextv-view-call-inspector')
export const toggleNextVDevConsoleBtn = document.getElementById('toggle-nextv-dev-console-btn')
export const toggleUserIOBtn = document.getElementById('toggle-user-io-btn')
export const nextVInputTabs = document.getElementById('nextv-input-tabs')
export const scriptDirtyBadge = document.getElementById('script-dirty-badge')
export const scriptOpenFileLabel = document.getElementById('script-open-file-label')
export const openFileTabs = document.getElementById('open-file-tabs')
export const toggleNextVFilesBtn = document.getElementById('toggle-nextv-files-btn')
export const nextVWorkspaceDirInput = document.getElementById('nextv-workspace-dir')
export const nextVOpenWorkspaceBtn = document.getElementById('nextv-open-workspace-btn')
export const nextVEntrypointInput = document.getElementById('nextv-entrypoint')
export const nextVAttachStartOverrideLabel = document.getElementById('nextv-attach-start-override-label')
export const nextVAttachStartOverrideInput = document.getElementById('nextv-attach-start-override')
export const nextVAutoSaveInput = document.getElementById('nextv-autosave')
export const nextVEventValueInput = document.getElementById('nextv-event-value')
export const nextVEventTypeInput = document.getElementById('nextv-event-type')
export const nextVEventSourceInput = document.getElementById('nextv-event-source')
export const nextVCallTargetKindInput = document.getElementById('nextv-call-target-kind')
export const nextVCallTargetAgentInput = document.getElementById('nextv-call-target-agent')
export const nextVCallTargetInput = document.getElementById('nextv-call-target')
export const nextVCallValidateInput = document.getElementById('nextv-call-validate')
export const nextVCallRetryInput = document.getElementById('nextv-call-retry')
export const nextVCallInstructionsInput = document.getElementById('nextv-call-instructions')
export const nextVCallPromptInput = document.getElementById('nextv-call-prompt')
export const nextVCallReturnsInput = document.getElementById('nextv-call-returns')
export const nextVCallDecideInput = document.getElementById('nextv-call-decide')
export const nextVCallToolsModeInput = document.getElementById('nextv-call-tools-mode')
export const nextVCallToolsMaxRoundsInput = document.getElementById('nextv-call-tools-max-rounds')
export const nextVCallToolsTimeoutMsInput = document.getElementById('nextv-call-tools-timeout-ms')
export const nextVCallToolsDenyUnknownInput = document.getElementById('nextv-call-tools-deny-unknown')
export const nextVCallToolsExtraInput = document.getElementById('nextv-call-tools-extra')
export const nextVCallToolsList = document.getElementById('nextv-call-tools-list')
export const nextVCallToolsSection = document.getElementById('nextv-call-tools-section')
export const nextVCallTargetConfigLabel = document.getElementById('nextv-call-target-config-label')
export const nextVCallTargetConfigOutput = document.getElementById('nextv-call-target-config')
export const nextVCallResolvedLabel = document.getElementById('nextv-call-resolved-label')
export const nextVCallResolvedOutput = document.getElementById('nextv-call-resolved')
export const nextVIngressNameInput = document.getElementById('nextv-ingress-name')
export const nextVIngressValueInput = document.getElementById('nextv-ingress-value')
export const nextVIngressControlsRow = document.getElementById('nextv-ingress-controls-row')
export const nextVShowIngressToggle = document.getElementById('nextv-show-ingress-toggle')
export const nextVImagesRow = document.getElementById('nextv-images-row')
export const toggleNextVImagesBtn = document.getElementById('toggle-nextv-images-btn')
export const nextVImageDropzone = document.getElementById('nextv-image-dropzone')
export const nextVImageInput = document.getElementById('nextv-image-input')
export const nextVImageCount = document.getElementById('nextv-image-count')
export const nextVImageList = document.getElementById('nextv-image-list')
export const nextVStartBtn = document.getElementById('nextv-start-btn')
export const nextVRunBtn = document.getElementById('nextv-run-btn')
export const nextVStopBtn = document.getElementById('nextv-stop-btn')
export const nextVReloadConfigBtn = document.getElementById('nextv-reload-config-btn')
export const nextVValidateBtn = document.getElementById('nextv-validate-btn')
export const nextVPromoteBtn = document.getElementById('nextv-promote-btn')
export const nextVCandidateStatusRow = document.getElementById('nextv-candidate-status-row')
export const nextVCandidateStatusBadge = document.getElementById('nextv-candidate-status-badge')
export const nextVCandidateIssueCount = document.getElementById('nextv-candidate-issue-count')
export const nextVRuntimeTargetInput = document.getElementById('nextv-runtime-target')
export const nextVAttachWsUrlInput = document.getElementById('nextv-attach-ws-url')
export const nextVAttachWsUrlLabel = document.getElementById('nextv-attach-ws-url-label')
export const nextVAttachControls = document.getElementById('nextv-attach-controls')
export const nextVAttachBtn = document.getElementById('nextv-attach-btn')
export const nextVDetachBtn = document.getElementById('nextv-detach-btn')
export const nextVAttachStatus = document.getElementById('nextv-attach-status')
export const nextVEditorTabSizeInput = document.getElementById('nextv-editor-tab-size')
export const nextVEditorSurfaceBetaToggle = document.getElementById('nextv-editor-surface-beta-toggle')
export const nextVEditorSurfaceTelemetryToggle = document.getElementById('nextv-editor-surface-telemetry-toggle')
export const remoteModeBadge = document.getElementById('remote-mode-badge')
export const userOutput = document.getElementById('user-output')
export const userOutputChannelFilters = document.getElementById('user-output-channel-filters')
export const userInputText = document.getElementById('user-input-text')
export const cancelScriptBtn = document.getElementById('cancel-script-btn')
export const scriptSection = document.getElementById('script-section')
export const logsSection = document.getElementById('logs-section')
export const outputSection = document.getElementById('output-section')
export const scriptVSplit1 = document.getElementById('script-vsplit-1')
export const scriptVSplit2 = document.getElementById('script-vsplit-2')
export const nextVEventsOutput = document.getElementById('nextv-events-output')
export const traceShell = document.getElementById('trace-shell')
export const traceList = document.getElementById('trace-list')
export const traceDetail = document.getElementById('trace-detail')
export const fileManagerShell = document.getElementById('file-manager-shell')
export const nextVGraphShell = document.getElementById('nextv-graph-shell')
export const nextVGraphOutput = document.getElementById('nextv-graph-output')
export const nextVStateDiffSplitter = document.getElementById('nextv-state-diff-splitter')
export const nextVStateDiffPanel = document.getElementById('nextv-state-diff-panel')
export const nextVUserIOSplitter = document.getElementById('nextv-user-io-splitter')
export const nextVStateDiffFeed = document.getElementById('nextv-state-diff-feed')
export const nextVStateSnapshotPane = document.getElementById('nextv-state-snapshot-pane')
export const nextVStateFilterInput = document.getElementById('nextv-state-filter-input')
export const nextVStateDiffTabDiff = document.getElementById('nextv-state-diff-tab-diff')
export const nextVStateDiffTabState = document.getElementById('nextv-state-diff-tab-state')
export const nextVConsoleOutput = document.getElementById('nextv-console-output')
export const nextVCallInspectorPanel = document.getElementById('nextv-call-inspector-panel')
export const nextVCallGeneratedCode = document.getElementById('nextv-call-generated-code')
export const nextVCallModeInput = document.getElementById('nextv-call-mode')
export const nextVCallResultTabs = document.getElementById('nextv-call-result-tabs')
export const nextVCallResultTabRaw = document.getElementById('nextv-call-result-tab-raw')
export const nextVCallResultTabActual = document.getElementById('nextv-call-result-tab-actual')
export const nextVCallResultTabParsed = document.getElementById('nextv-call-result-tab-parsed')
export const nextVCallResultTabValidation = document.getElementById('nextv-call-result-tab-validation')
export const nextVCallResultTabTry = document.getElementById('nextv-call-result-tab-try')
export const nextVCallResultTabMetadata = document.getElementById('nextv-call-result-tab-metadata')
export const nextVCallResultRaw = document.getElementById('nextv-call-result-raw')
export const nextVCallResultActual = document.getElementById('nextv-call-result-actual')
export const nextVCallResultParsed = document.getElementById('nextv-call-result-parsed')
export const nextVCallResultValidation = document.getElementById('nextv-call-result-validation')
export const nextVCallResultTry = document.getElementById('nextv-call-result-try')
export const nextVCallResultMetadata = document.getElementById('nextv-call-result-metadata')
export const settingsMenu = document.getElementById('settings-menu')
export const scriptEditorPanel = document.getElementById('script-editor-panel')
export const nextVInputExternalPane = document.getElementById('nextv-input-external-pane')
export const fileTree = document.getElementById('file-tree')
export const fileTreePane = document.getElementById('file-tree-pane')
export const fileTreeSplitter = document.getElementById('file-tree-splitter')
export const filetreeDeleteConfirm = document.getElementById('filetree-delete-confirm')
export const filetreeDeleteDesc = document.getElementById('filetree-delete-desc')
export const filetreeDeleteTimer = document.getElementById('filetree-delete-timer')
export const splitter = document.getElementById('panel-splitter')
export const workspace = document.getElementById('workspace')

// --- Setters for primitive let state (used by other modules) ---
export function _setPendingConfirmId(v) { pendingConfirmId = v }
export function _setIsBusy(v) { isBusy = v }
export function _setActiveScriptLine(v) { activeScriptLine = v }
export function _setIsResizing(v) { isResizing = v }
export function _setIsFileTreeResizing(v) { isFileTreeResizing = v }
export function _setIsStateDiffResizing(v) { isStateDiffResizing = v }
export function _setIsUserIOResizing(v) { isUserIOResizing = v }
export function _setActiveVerticalResize(v) { activeVerticalResize = v }
export function _setActiveEditorGridResize(v) { activeEditorGridResize = v }
export function _setActiveScriptAbortController(v) { activeScriptAbortController = v }
export function _setActiveScriptRunId(v) { activeScriptRunId = v }
export function _setNextVRuntimeRunning(v) { nextVRuntimeRunning = v }
export function _setNextVCandidatePromotable(v) { nextVCandidatePromotable = v }
export function _setIsRemoteMode(v) { isRemoteMode = v }
export function _setIsRemoteControlMode(v) { isRemoteControlMode = v }
export function _setIsRemoteRuntimeConnected(v) { isRemoteRuntimeConnected = v }
export function _setRemoteTransport(v) { remoteTransport = v }
export function _setRemoteRuntimeWorkspaceDir(v) { remoteRuntimeWorkspaceDir = v }
export function _setRemoteRuntimeEntrypointPath(v) { remoteRuntimeEntrypointPath = v }
export function _setNextVEventSource(v) { nextVEventSource = v }
export function _setNextVHasLiveRuntimeEvents(v) { nextVHasLiveRuntimeEvents = v }
export function _setVisualOutputWindow(v) { visualOutputWindow = v }
export function _setTraceRowCounter(v) { traceRowCounter = v }
export function _setNextVLastKnownState(v) { nextVLastKnownState = v }
export function _setNextVStateFilterQuery(v) { nextVStateFilterQuery = v }
export function _setNextVExecutionGroups(v) { nextVExecutionGroups = v }
export function _setNextVExecutionCounter(v) { nextVExecutionCounter = v }
export function _setNextVEventsLiveMode(v) { nextVEventsLiveMode = v }
export function _setNextVEventsPausedBuffer(v) { nextVEventsPausedBuffer = v }
export function _setDeleteConfirmTimeoutId(v) { deleteConfirmTimeoutId = v }
export function _setDeleteConfirmTickerId(v) { deleteConfirmTickerId = v }
export function _setPendingDeleteConfirmResolver(v) { pendingDeleteConfirmResolver = v }
export function _setPendingFloatingPanelChoiceResolver(v) { pendingFloatingPanelChoiceResolver = v }
export function _setActivePaneId(v) { activePaneId = v }
export function _setNextVManagedProcessRunning(v) { nextVManagedProcessRunning = v }
