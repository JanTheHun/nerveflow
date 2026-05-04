/* app.js — minimal event glue for local-agent web UI */

// --- State ---
let pendingConfirmId = null
let isBusy = false
let activeScriptLine = null
let isResizing = false
let isFileTreeResizing = false
let isStateDiffResizing = false
let isUserIOResizing = false
let activeVerticalResize = null
let activeEditorGridResize = false
let activeScriptAbortController = null
let activeScriptRunId = ''
let nextVRuntimeRunning = false
let isRemoteMode = false
let isRemoteControlMode = false
let isRemoteRuntimeConnected = true
let remoteTransport = 'local'
let remoteRuntimeWorkspaceDir = ''
let remoteRuntimeEntrypointPath = ''
let nextVEventSource = null
let nextVHasLiveRuntimeEvents = false
let visualOutputWindow = null
let traceRowCounter = 0
let nextVLastKnownState = null
let nextVStateFilterQuery = ''
let deleteConfirmTimeoutId = null
let deleteConfirmTickerId = null
let pendingDeleteConfirmResolver = null
let pendingFloatingPanelChoiceResolver = null
const nextVStateSectionOpenByKey = new Map()
const SCRIPT_FILE_REF_REGEX = /([!?])?file:([^\s"']+)/g
const SCRIPT_FILE_CALL_REGEX = /\bfile\(["']([^"'\n]+)["']\)/g
const FLOATING_PANEL_IDS = ['FLOAT1', 'FLOAT2']

const scriptCache = new Map()
const dirtyEditsCache = new Map() // stashed unsaved edits per file when autosave is off
const storageKeys = {
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
  nextVGraphDirection: 'local-agent.nextv.graphDirection',
  nextVControlOverlay: 'local-agent.nextv.controlOverlay',
  nextVShowControlBranches: 'local-agent.nextv.showControlBranches',
  nextVEditorGridSplit: 'local-agent.nextv.editorGridSplit',
  nextVEditorLayout: 'local-agent.nextv.editorLayout',
}

const MIN_LEFT_PANEL_SECTION_HEIGHT = 90
const DEFAULT_EDITOR_GRID_SPLIT_PERCENT = 50
const MIN_EDITOR_GRID_SPLIT_PERCENT = 20

function createEditorPaneState(id) {
  return {
    id,
    path: '',
    loadedText: '',
    dirty: false,
  }
}

function createFloatingGraphPanelState(id) {
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

const editorLayoutState = {
  layoutMode: 'split-2',
  activePaneId: 'A',
  paneOrder: ['A', 'B'],
  allPanes: ['A', 'B', 'C', 'D'],
}

const editorGridSplitState = {
  xPercent: DEFAULT_EDITOR_GRID_SPLIT_PERCENT,
  yPercent: DEFAULT_EDITOR_GRID_SPLIT_PERCENT,
}

const scriptEditorState = createEditorPaneState('A')
const editorPaneBState = createEditorPaneState('B')
const editorPaneCState = createEditorPaneState('C')
const editorPaneDState = createEditorPaneState('D')
let activePaneId = editorLayoutState.activePaneId
const editorPaneStateById = new Map([
  ['A', scriptEditorState],
  ['B', editorPaneBState],
  ['C', editorPaneCState],
  ['D', editorPaneDState],
])
const paneAssignments = new Map() // filePath → 'A' | 'B' | 'C' | 'D'

const nextVFileState = {
  tree: null,
  openFilePath: '',
  openTabs: [],
  workspaceDir: '',
  expandedDirs: new Set(),
  autoSaveTimer: null,
}

const tracePanelState = {
  rows: [],
  selectedId: '',
  currentTab: 'events',
}

const nextVViewState = {
  currentView: 'editor',
}

const nextVPanelState = {
  devConsoleOpen: true,
}

const userIOPanelState = {
  open: false,
}

const nextVGraphState = {
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

const inputPanelState = {
  currentTab: 'ui',
}

const nextVInputChannelState = {
  declaredExternals: [],
}

const nextVInputImageState = {
  entries: [],
  open: false,
}

const nextVIngressControlsState = {
  visible: true,
}

const nextVRuntimeTargetState = {
  target: 'embedded',
}

const nextVGraphMappingApi = globalThis?.nextVGraphMapping || null

let nextVManagedProcessRunning = false

const DEFAULT_USER_OUTPUT_CHANNELS = ['text', 'json', 'voice']

const userOutputChannelState = {
  declaredEffects: [],
}

const userOutputFilterState = {
  channels: new Set(DEFAULT_USER_OUTPUT_CHANNELS),
}

// --- DOM helpers ---
const transcript = document.getElementById('transcript')
const promptInput = document.getElementById('prompt-input')
const sendBtn = document.getElementById('send-btn')
const imageCount = document.getElementById('image-count')
const modelInput = document.getElementById('model-input')
const scriptPathInput = document.getElementById('script-path')
const scriptInputs = document.getElementById('script-inputs')
const scriptLineGutter = document.getElementById('script-line-gutter')
const scriptView = document.getElementById('script-view')
const scriptViewMirror = document.getElementById('script-view-mirror')
const scriptViewB = document.getElementById('script-view-b')
const scriptLineGutterB = document.getElementById('script-line-gutter-b')
const scriptViewMirrorB = document.getElementById('script-view-mirror-b')
const scriptViewC = document.getElementById('script-view-c')
const scriptLineGutterC = document.getElementById('script-line-gutter-c')
const scriptViewMirrorC = document.getElementById('script-view-mirror-c')
const scriptViewD = document.getElementById('script-view-d')
const scriptLineGutterD = document.getElementById('script-line-gutter-d')
const scriptViewMirrorD = document.getElementById('script-view-mirror-d')
const nextVFloatingCodePanel = document.getElementById('nextv-floating-code-panel')
const nextVFloatingCodePanel2 = document.getElementById('nextv-floating-code-panel-2')
const nextVFloatingCodeTitle = document.getElementById('nextv-floating-code-title')
const nextVFloatingCodeTitle2 = document.getElementById('nextv-floating-code-title-2')
const nextVFloatingCodePath = document.getElementById('nextv-floating-code-path')
const nextVFloatingCodePath2 = document.getElementById('nextv-floating-code-path-2')
const nextVFloatingCodeLine = document.getElementById('nextv-floating-code-line')
const nextVFloatingCodeLine2 = document.getElementById('nextv-floating-code-line-2')
const nextVFloatingCodeDirty = document.getElementById('nextv-floating-code-dirty')
const nextVFloatingCodeDirty2 = document.getElementById('nextv-floating-code-dirty-2')
const nextVFloatingCodeTextarea = document.getElementById('nextv-floating-code-textarea')
const nextVFloatingCodeTextarea2 = document.getElementById('nextv-floating-code-textarea-2')
const nextVFloatingCodeMirror = document.getElementById('nextv-floating-code-mirror')
const nextVFloatingCodeMirror2 = document.getElementById('nextv-floating-code-mirror-2')
const nextVFloatingCodeGutter = document.getElementById('nextv-floating-code-gutter')
const nextVFloatingCodeGutter2 = document.getElementById('nextv-floating-code-gutter-2')
const nextVFloatingPanelChooser = document.getElementById('nextv-floating-panel-chooser')
const nextVFloatingPanelChooserTitle = document.getElementById('nextv-floating-panel-chooser-title')
const nextVFloatingPanelChooserDetails = document.getElementById('nextv-floating-panel-chooser-details')
const nextVFloatingPanelChooserPanel1Btn = document.getElementById('nextv-floating-panel-chooser-panel1')
const nextVFloatingPanelChooserPanel2Btn = document.getElementById('nextv-floating-panel-chooser-panel2')
const nextVFloatingPanelChooserCancelBtn = document.getElementById('nextv-floating-panel-chooser-cancel')
const editorPanesGrid = document.getElementById('editor-panes-grid')
const editorPaneA = document.getElementById('editor-pane-a')
const editorPaneB = document.getElementById('editor-pane-b')
const editorPaneC = document.getElementById('editor-pane-c')
const editorPaneD = document.getElementById('editor-pane-d')
const paneTitleA = document.getElementById('pane-a-title')
const paneTitleB = document.getElementById('pane-b-title')
const paneTitleC = document.getElementById('pane-c-title')
const paneTitleD = document.getElementById('pane-d-title')
const editorLayoutSplitBtn = document.getElementById('editor-layout-split-btn')
const editorLayoutGridBtn = document.getElementById('editor-layout-grid-btn')
const editorGridCenterHandle = document.getElementById('editor-grid-center-handle')
const editorPaneDescriptors = new Map([
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
const scriptLogs = document.getElementById('script-logs')
const scriptOutput = document.getElementById('script-output')
const scriptHeaderTitle = document.getElementById('script-header-title')
const scriptHeaderBadge = document.getElementById('script-header-badge')
const logsHeaderTitle = document.getElementById('logs-header-title')
const logsHeaderBadge = document.getElementById('logs-header-badge')
const outputHeaderTitle = document.getElementById('output-header-title')
const outputHeaderBadge = document.getElementById('output-header-badge')
const nextVDevTabs = document.getElementById('nextv-dev-tabs')
const nextVTabEvents = document.getElementById('nextv-tab-events')
const nextVTabTrace = document.getElementById('nextv-tab-trace')
const nextVTabConsole = document.getElementById('nextv-tab-console')
const nextVPrimaryTabs = document.getElementById('nextv-primary-tabs')
const nextVViewEditor = document.getElementById('nextv-view-editor')
const nextVViewGraph = document.getElementById('nextv-view-graph')
const toggleNextVDevConsoleBtn = document.getElementById('toggle-nextv-dev-console-btn')
const toggleUserIOBtn = document.getElementById('toggle-user-io-btn')
const nextVInputTabs = document.getElementById('nextv-input-tabs')
const scriptDirtyBadge = document.getElementById('script-dirty-badge')
const scriptOpenFileLabel = document.getElementById('script-open-file-label')
const openFileTabs = document.getElementById('open-file-tabs')
const toggleNextVFilesBtn = document.getElementById('toggle-nextv-files-btn')
const nextVWorkspaceDirInput = document.getElementById('nextv-workspace-dir')
const nextVEntrypointInput = document.getElementById('nextv-entrypoint')
const nextVAutoSaveInput = document.getElementById('nextv-autosave')
const nextVEventValueInput = document.getElementById('nextv-event-value')
const nextVEventTypeInput = document.getElementById('nextv-event-type')
const nextVEventSourceInput = document.getElementById('nextv-event-source')
const nextVIngressNameInput = document.getElementById('nextv-ingress-name')
const nextVIngressValueInput = document.getElementById('nextv-ingress-value')
const nextVIngressControlsRow = document.getElementById('nextv-ingress-controls-row')
const nextVShowIngressToggle = document.getElementById('nextv-show-ingress-toggle')
const nextVImagesRow = document.getElementById('nextv-images-row')
const toggleNextVImagesBtn = document.getElementById('toggle-nextv-images-btn')
const nextVImageDropzone = document.getElementById('nextv-image-dropzone')
const nextVImageInput = document.getElementById('nextv-image-input')
const nextVImageCount = document.getElementById('nextv-image-count')
const nextVImageList = document.getElementById('nextv-image-list')
const nextVStartBtn = document.getElementById('nextv-start-btn')
const nextVRunBtn = document.getElementById('nextv-run-btn')
const nextVStopBtn = document.getElementById('nextv-stop-btn')
const nextVRuntimeTargetInput = document.getElementById('nextv-runtime-target')
const remoteModeBadge = document.getElementById('remote-mode-badge')
const userOutput = document.getElementById('user-output')
const userOutputChannelFilters = document.getElementById('user-output-channel-filters')
const userInputText = document.getElementById('user-input-text')
const cancelScriptBtn = document.getElementById('cancel-script-btn')
const scriptSection = document.getElementById('script-section')
const logsSection = document.getElementById('logs-section')
const outputSection = document.getElementById('output-section')
const scriptVSplit1 = document.getElementById('script-vsplit-1')
const scriptVSplit2 = document.getElementById('script-vsplit-2')
const nextVEventsOutput = document.getElementById('nextv-events-output')
const traceShell = document.getElementById('trace-shell')
const traceList = document.getElementById('trace-list')
const traceDetail = document.getElementById('trace-detail')
const fileManagerShell = document.getElementById('file-manager-shell')
const nextVGraphShell = document.getElementById('nextv-graph-shell')
const nextVGraphOutput = document.getElementById('nextv-graph-output')
const nextVStateDiffSplitter = document.getElementById('nextv-state-diff-splitter')
const nextVStateDiffPanel = document.getElementById('nextv-state-diff-panel')
const nextVUserIOSplitter = document.getElementById('nextv-user-io-splitter')
const nextVStateDiffFeed = document.getElementById('nextv-state-diff-feed')
const nextVStateSnapshotPane = document.getElementById('nextv-state-snapshot-pane')
const nextVStateFilterInput = document.getElementById('nextv-state-filter-input')
const nextVStateDiffTabDiff = document.getElementById('nextv-state-diff-tab-diff')
const nextVStateDiffTabState = document.getElementById('nextv-state-diff-tab-state')
const nextVConsoleOutput = document.getElementById('nextv-console-output')
const settingsMenu = document.getElementById('settings-menu')
const scriptEditorPanel = document.getElementById('script-editor-panel')
const nextVInputExternalPane = document.getElementById('nextv-input-external-pane')
const fileTree = document.getElementById('file-tree')
const fileTreePane = document.getElementById('file-tree-pane')
const fileTreeSplitter = document.getElementById('file-tree-splitter')
const filetreeDeleteConfirm = document.getElementById('filetree-delete-confirm')
const filetreeDeleteDesc = document.getElementById('filetree-delete-desc')
const filetreeDeleteTimer = document.getElementById('filetree-delete-timer')
const splitter = document.getElementById('panel-splitter')
const workspace = document.getElementById('workspace')
