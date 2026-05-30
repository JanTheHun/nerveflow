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
  nextVAttachWsUrl: 'local-agent.nextv.attachWsUrl',
  nextVAttachStartOverride: 'local-agent.nextv.attachStartOverride',
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
  attachWsUrl: '',
}

const nextVAttachSessionState = {
  attached: false,
  connecting: false,
  lastError: '',
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
const nextVOpenWorkspaceBtn = document.getElementById('nextv-open-workspace-btn')
const nextVEntrypointInput = document.getElementById('nextv-entrypoint')
const nextVAttachStartOverrideLabel = document.getElementById('nextv-attach-start-override-label')
const nextVAttachStartOverrideInput = document.getElementById('nextv-attach-start-override')
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
const nextVAttachWsUrlInput = document.getElementById('nextv-attach-ws-url')
const nextVAttachWsUrlLabel = document.getElementById('nextv-attach-ws-url-label')
const nextVAttachControls = document.getElementById('nextv-attach-controls')
const nextVAttachBtn = document.getElementById('nextv-attach-btn')
const nextVDetachBtn = document.getElementById('nextv-detach-btn')
const nextVAttachStatus = document.getElementById('nextv-attach-status')
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


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  DEFAULT_USER_OUTPUT_CHANNELS,
  _setVisualOutputWindow,
  _setNextVExecutionGroups,
  _setNextVEventsLiveMode,
  _setNextVEventsPausedBuffer,
  activeScriptAbortController,
  cancelScriptBtn,
  nextVEventSource,
  nextVRuntimeRunning,
  nextVExecutionGroups,
  nextVEventsLiveMode,
  nextVEventsPausedBuffer,
  nextVEventsOutput,
  storageKeys,
  userInputText,
  userOutput,
  userOutputChannelFilters,
  userOutputChannelState,
  userOutputFilterState,
  visualOutputWindow
} from './state.js'
import {
  buildNextVApiPath
} from './03_ui_controls.js'
import {
  appendNextVLogRow,
  appendNextVErrorLog
} from './07_graph_render.js'
import {
  renderNextVSnapshot
} from './11_state_panels.js'
import {
  toPrettyJson,
  summarizeToolCallArgs
} from './10_file_tree.js'
import {
  setStatus,
  appendErrorRow
} from './13_layout.js'

export function updateScriptRunControls() {
  if (cancelScriptBtn) {
    cancelScriptBtn.disabled = activeScriptAbortController === null
  }
}

export function normalizeDeclaredEffectChannels(rawChannels) {
  if (Array.isArray(rawChannels)) {
    return [...new Set(rawChannels.map((channel) => String(channel ?? '').trim().toLowerCase()).filter(Boolean))]
  }
  if (!rawChannels || typeof rawChannels !== 'object' || Array.isArray(rawChannels)) {
    return []
  }
  return [...new Set(Object.keys(rawChannels).map((channel) => String(channel ?? '').trim().toLowerCase()).filter(Boolean))]
}

export function getAvailableUserOutputChannels() {
  return [...new Set([...DEFAULT_USER_OUTPUT_CHANNELS, ...userOutputChannelState.declaredEffects])]
}

export function normalizeUserOutputChannels(raw, allowedChannels = getAvailableUserOutputChannels()) {
  if (!Array.isArray(raw)) return []
  const allowed = new Set(allowedChannels.map((channel) => String(channel ?? '').trim().toLowerCase()).filter(Boolean))
  return [...new Set(raw.map((channel) => String(channel ?? '').trim().toLowerCase()).filter((channel) => allowed.has(channel)))]
}

export function normalizeUserOutputChannel(channel, fallback = 'text') {
  const normalized = String(channel ?? '').trim().toLowerCase()
  return normalized || fallback
}

export function isBuiltinUserOutputChannel(channel) {
  return DEFAULT_USER_OUTPUT_CHANNELS.includes(normalizeUserOutputChannel(channel, ''))
}

export function getUserOutputChannelClassName(channel) {
  const normalized = normalizeUserOutputChannel(channel)
  if (isBuiltinUserOutputChannel(normalized)) {
    return ` user-output-channel-${normalized}`
  }
  return ' user-output-channel-declared'
}

export function setDeclaredEffectChannels(channels, options = {}) {
  const { preserveSelection = true, persist = true } = options
  const nextDeclared = normalizeDeclaredEffectChannels(channels)
  const previousAvailable = new Set(getAvailableUserOutputChannels())
  userOutputChannelState.declaredEffects = nextDeclared
  const available = getAvailableUserOutputChannels()
  const availableSet = new Set(available)

  if (preserveSelection) {
    const nextSelected = new Set(
      [...userOutputFilterState.channels].filter((channel) => availableSet.has(channel))
    )
    for (const channel of available) {
      if (!previousAvailable.has(channel)) {
        nextSelected.add(channel)
      }
    }
    if (nextSelected.size === 0) {
      for (const channel of available) nextSelected.add(channel)
    }
    userOutputFilterState.channels = nextSelected
  } else {
    userOutputFilterState.channels = new Set(available)
  }

  renderUserOutputChannelFilters()
  if (persist) {
    persistUserOutputChannels()
  }
  applyUserOutputChannelVisibility()
}

export function persistUserOutputChannels() {
  localStorage.setItem(storageKeys.nextVUserOutputChannels, [...userOutputFilterState.channels].join(','))
}

export function renderUserOutputChannelFilters() {
  if (!userOutputChannelFilters) return
  const channels = getAvailableUserOutputChannels()
  userOutputChannelFilters.innerHTML = ''
  let separatorInserted = false

  for (const channel of channels) {
    if (!separatorInserted && !isBuiltinUserOutputChannel(channel)) {
      const separator = document.createElement('span')
      separator.className = 'channel-group-separator'
      separator.setAttribute('aria-hidden', 'true')
      userOutputChannelFilters.appendChild(separator)
      separatorInserted = true
    }

    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'panel-badge badge-output user-output-channel-chip'
    chip.setAttribute('data-channel', channel)
    if (!isBuiltinUserOutputChannel(channel)) {
      chip.classList.add('is-declared')
    }
    chip.textContent = channel
    chip.addEventListener('click', () => {
      toggleUserOutputChannel(channel)
    })
    userOutputChannelFilters.appendChild(chip)
  }

  const chips = userOutputChannelFilters.querySelectorAll('[data-channel]')
  for (const chip of chips) {
    const channel = normalizeUserOutputChannel(chip.getAttribute('data-channel'))
    const selected = userOutputFilterState.channels.has(channel)
    chip.classList.toggle('is-off', !selected)
    chip.setAttribute('aria-pressed', selected ? 'true' : 'false')
  }
}

export function toggleUserOutputChannel(channel) {
  const normalized = normalizeUserOutputChannel(channel, '')
  if (!normalized) return
  if (userOutputFilterState.channels.has(normalized)) {
    userOutputFilterState.channels.delete(normalized)
  } else {
    userOutputFilterState.channels.add(normalized)
  }
  renderUserOutputChannelFilters()
  persistUserOutputChannels()
  applyUserOutputChannelVisibility()
}

export function isUserOutputChannelEnabled(format) {
  const channel = normalizeUserOutputChannel(format)
  return userOutputFilterState.channels.has(channel)
}

export function applyUserOutputChannelVisibility() {
  if (!userOutput) return
  const rows = userOutput.querySelectorAll('.user-output-message')
  for (const row of rows) {
    const rowChannel = normalizeUserOutputChannel(row.getAttribute('data-channel'))
    const show = isUserOutputChannelEnabled(rowChannel)
    row.hidden = !show
    row.style.display = show ? '' : 'none'
  }
}

export function appendUserOutputMessage(text, channel = 'text') {
  if (!userOutput) return
  let content = ''
  if (typeof text === 'string') {
    content = text.trim()
  } else if (text && typeof text === 'object') {
    try {
      content = JSON.stringify(text, null, 2).trim()
    } catch {
      content = String(text).trim()
    }
  } else {
    content = String(text ?? '').trim()
  }
  if (!content) return

  const empty = userOutput.querySelector('.user-output-empty')
  if (empty) empty.remove()

  const row = document.createElement('div')
  const normalizedChannel = normalizeUserOutputChannel(channel)
  row.className = `user-output-message${getUserOutputChannelClassName(normalizedChannel)}`
  row.setAttribute('data-channel', normalizedChannel)
  row.textContent = content
  userOutput.appendChild(row)
  applyUserOutputChannelVisibility()
  userOutput.scrollTop = userOutput.scrollHeight
}

export function appendUserOutputVoice(event, channel = 'voice') {
  if (!userOutput) return

  const empty = userOutput.querySelector('.user-output-empty')
  if (empty) empty.remove()

  const normalizedChannel = normalizeUserOutputChannel(channel, 'voice')
  const row = document.createElement('div')
  row.className = `user-output-message${getUserOutputChannelClassName(normalizedChannel)}`
  row.setAttribute('data-channel', normalizedChannel)

  const content = String(event?.content ?? '').trim()
  if (content) {
    const textNode = document.createElement('div')
    textNode.textContent = content
    row.appendChild(textNode)
  }

  const voiceError = String(event?.voiceError ?? '').trim()
  if (voiceError) {
    const errorNode = document.createElement('div')
    errorNode.textContent = `[voice error] ${voiceError}`
    row.appendChild(errorNode)
    userOutput.appendChild(row)
    applyUserOutputChannelVisibility()
    userOutput.scrollTop = userOutput.scrollHeight
    return
  }

  const url = String(event?.voice?.url ?? '').trim()
  if (url) {
    const audio = document.createElement('audio')
    audio.controls = true
    audio.autoplay = true
    audio.preload = 'none'
    audio.src = url
    row.appendChild(audio)
  }

  userOutput.appendChild(row)
  applyUserOutputChannelVisibility()
  userOutput.scrollTop = userOutput.scrollHeight
}

export function openVisualOutputWindow(visual, source = 'visual output') {
  const url = String(visual?.url ?? '').trim()
  if (!url) return

  const title = String(visual?.title ?? 'local-agent visual output')

  if (visualOutputWindow && !visualOutputWindow.closed) {
    try {
      visualOutputWindow.location.href = url
      visualOutputWindow.document.title = title
      visualOutputWindow.focus()
      setStatus(`${source} updated`)
      return
    } catch {
      _setVisualOutputWindow(null)
    }
  }

  const opened = window.open(url, 'local-agent-visual-output', 'popup=yes,width=980,height=720')
  if (!opened) {
    appendErrorRow('Could not open visual output window (popup blocked).')
    return
  }

  _setVisualOutputWindow(opened)
  setStatus(`${source} opened`)
}

export function parseMaybeJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value

  const raw = String(value).trim()
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function maybeRenderToolVisual(name, result) {
  if (String(name ?? '') !== 'render_view') return

  const parsed = parseMaybeJson(result)
  if (!parsed || typeof parsed !== 'object') return

  const outputPath = String(parsed.output_path ?? '').trim()
  if (!outputPath) return

  openVisualOutputWindow({
    url: `/api/visual/file?path=${encodeURIComponent(outputPath)}`,
    title: String(parsed.title ?? 'tool visual output'),
  }, 'tool visual')
}

export function clearUserOutputPanel() {
  if (!userOutput) return
  userOutput.innerHTML = ''
  const empty = document.createElement('div')
  empty.className = 'user-output-empty'
  empty.textContent = 'No user output yet.'
  userOutput.appendChild(empty)
  applyUserOutputChannelVisibility()
  setStatus('user output cleared')
}

export async function sendNextVUserText() {
  const value = String(userInputText?.value ?? '')
  if (!value.trim()) {
    setStatus('user text required', 'responding')
    return
  }

  if (!nextVRuntimeRunning) {
    setStatus('nextv runtime not running', 'responding')
    return
  }

  try {
    const eventType = 'user_text'
    const source = 'UI'
    const res = await fetch(buildNextVApiPath('/api/nextv/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, eventType, source }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to enqueue nextv event')
    }

    if (!nextVEventSource) {
      const valueSnippet = value ? (value.length > 80 ? value.slice(0, 80) + '\u2026' : value) : ''
      const valueSuffix = valueSnippet ? ` value=${valueSnippet}` : ''
      appendNextVLogRow(`[nextv:event] queued type=${eventType} source=UI${valueSuffix}`, 'step')
      renderNextVSnapshot(data.snapshot)
    }

    if (userInputText) {
      userInputText.value = ''
      userInputText.focus()
    }
    setStatus('ui text sent')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('failed to send ui text', 'responding')
  }
}

// --- Execution Groups (newest-first log view) ---

export function buildExecutionGroup(payload, groupId) {
  const event = payload?.event ?? {}
  const result = payload?.result ?? {}
  const events = Array.isArray(payload?.events) ? payload.events : []

  // Determine outcome
  let outcome = 'completed'
  if (result.stopped) {
    outcome = 'stopped'
  } else {
    // Check for contract violations or warnings in events
    for (const evt of events) {
      if (evt.type === 'warning' && evt.code?.startsWith('contract')) {
        outcome = 'contract-violated'
        break
      }
      if (evt.type === 'warning') {
        outcome = 'warning'
      }
    }
  }

  // Extract timestamps from events
  let startTs = null
  let endTs = null
  if (events.length > 0) {
    startTs = events[0].timestamp || null
    endTs = events[events.length - 1].timestamp || startTs
  }

  return {
    id: groupId,
    ingressType: String(event.type ?? ''),
    source: String(event.source ?? ''),
    result,
    events,
    startTs,
    endTs,
    outcome,
    expanded: false,
  }
}

export function renderExecutionGroups() {
  if (!nextVEventsOutput) return

  nextVEventsOutput.innerHTML = ''

  if (nextVExecutionGroups.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'nextv-events-empty'
    empty.textContent = 'No executions yet.'
    nextVEventsOutput.appendChild(empty)
    return
  }

  for (const group of nextVExecutionGroups) {
    const groupEl = document.createElement('div')
    groupEl.className = 'exec-group'
    groupEl.setAttribute('data-group-id', group.id)

    // Calculate duration
    const duration = group.startTs && group.endTs
      ? ((new Date(group.endTs) - new Date(group.startTs)) / 1000).toFixed(3)
      : '0.000'

    // Build summary line
    const summaryEl = document.createElement('div')
    summaryEl.className = 'exec-group-summary'
    summaryEl.innerHTML = `
      <span class="exec-toggle">${group.expanded ? '▼' : '▶'}</span>
      <span class="exec-id">#${group.id}</span>
      <span class="exec-type">type=${group.ingressType}</span>
      <span class="exec-outcome exec-outcome-${group.outcome}">${group.outcome}</span>
      <span class="exec-duration">${duration}s</span>
      <span class="exec-count">${group.events.length} events</span>
    `
    summaryEl.onclick = () => {
      group.expanded = !group.expanded
      renderExecutionGroups()
    }
    groupEl.appendChild(summaryEl)

    // Build body (collapsed by default)
    if (group.expanded) {
      const bodyEl = document.createElement('div')
      bodyEl.className = 'exec-group-body'

      for (const event of group.events) {
        const eventEl = document.createElement('div')
        eventEl.className = `exec-event exec-event-${event.type}`

        const debugPayload = getExecutionEventDebugPayload(event)
        const timestampEl = document.createElement('span')
        timestampEl.className = 'exec-event-ts'
        timestampEl.textContent = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—'
        eventEl.appendChild(timestampEl)

        const typeEl = document.createElement('span')
        typeEl.className = 'exec-event-type'
        typeEl.textContent = String(event.type ?? '')
        eventEl.appendChild(typeEl)

        const contentEl = document.createElement('span')
        contentEl.className = 'exec-event-content'
        contentEl.appendChild(buildExecutionEventContentFragment(event))
        eventEl.appendChild(contentEl)

        if (debugPayload !== null) {
          const toggleBtn = document.createElement('button')
          toggleBtn.type = 'button'
          toggleBtn.className = 'exec-event-debug-toggle'
          toggleBtn.setAttribute('aria-label', 'show payload')
          toggleBtn.title = 'show payload'
          toggleBtn.textContent = '\u25B6'
          eventEl.appendChild(toggleBtn)
        }

        if (debugPayload !== null) {
          const toggleBtn = eventEl.querySelector('.exec-event-debug-toggle')
          const debugEl = document.createElement('pre')
          debugEl.className = 'exec-event-debug'
          debugEl.hidden = true
          debugEl.textContent = toPrettyJson(debugPayload)
          eventEl.appendChild(debugEl)

          if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
              e.stopPropagation()
              const expanded = !debugEl.hidden
              debugEl.hidden = expanded
              toggleBtn.textContent = expanded ? '\u25B6' : '\u25BC'
              toggleBtn.title = expanded ? 'show payload' : 'hide payload'
              toggleBtn.setAttribute('aria-label', expanded ? 'show payload' : 'hide payload')
            })
          }
        }

        bodyEl.appendChild(eventEl)
      }

      groupEl.appendChild(bodyEl)
    }

    nextVEventsOutput.appendChild(groupEl)
  }
}

function parseExecutionToolArgs(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getExecutionEventTokenTarget(event) {
  const type = String(event?.type ?? '').trim().toLowerCase()
  if (type === 'agent_call') {
    const agent = String(event?.agent ?? '').trim()
    if (agent) return { kind: 'agent', value: agent }
    return null
  }

  if (type !== 'tool_call') return null
  const tool = String(event?.tool ?? '').trim().toLowerCase()
  if (tool !== 'agent' && tool !== 'model') return null

  const args = parseExecutionToolArgs(event?.args)
  const candidateKeys = tool === 'agent'
    ? ['agent', 'name', 'target', 'id']
    : ['model', 'name', 'target', 'id']

  for (const key of candidateKeys) {
    const value = String(args?.[key] ?? '').trim()
    if (value) {
      return { kind: tool, value }
    }
  }

  return null
}

function removeFirstCaseInsensitive(haystack, needle) {
  const source = String(haystack ?? '')
  const target = String(needle ?? '')
  if (!source || !target) return source

  const index = source.toLowerCase().indexOf(target.toLowerCase())
  if (index < 0) return source
  return `${source.slice(0, index)}${source.slice(index + target.length)}`
}

function buildExecutionEventContentFragment(event) {
  const fragment = document.createDocumentFragment()
  const tokenTarget = getExecutionEventTokenTarget(event)
  if (!tokenTarget) {
    fragment.appendChild(document.createTextNode(formatExecutionEventContent(event)))
    return fragment
  }

  if (String(event?.type ?? '').trim() === 'agent_call') {
    fragment.appendChild(document.createTextNode('agent call: '))
  } else {
    const tool = String(event?.tool ?? tokenTarget.kind).trim().toLowerCase() || tokenTarget.kind
    fragment.appendChild(document.createTextNode(`call: ${tool} `))
  }

  const tokenEl = document.createElement('span')
  tokenEl.className = 'exec-event-token'
  tokenEl.dataset.nerveTokenKind = tokenTarget.kind
  tokenEl.dataset.nerveTokenValue = tokenTarget.value
  tokenEl.textContent = tokenTarget.value
  tokenEl.title = `open call inspector for ${tokenTarget.kind} ${tokenTarget.value}`
  fragment.appendChild(tokenEl)

  if (String(event?.type ?? '').trim() === 'tool_call') {
    const argsSummary = String(summarizeToolCallArgs(event?.args) ?? '').trim()
    if (argsSummary) {
      const suffix = removeFirstCaseInsensitive(argsSummary, tokenTarget.value).trim()
      if (suffix) {
        fragment.appendChild(document.createTextNode(` ${suffix}`))
      }
    }
  }

  return fragment
}

function escapeExecutionEventText(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function getExecutionEventDebugPayload(event) {
  if (!event || typeof event !== 'object') return null

  if (event.type === 'tool_call') {
    return {
      tool: String(event.tool ?? ''),
      args: event.args ?? null,
      toolMetadata: event.toolMetadata ?? null,
    }
  }

  if (event.type === 'agent_call') {
    return {
      agent: String(event.agent ?? ''),
      args: event.args ?? null,
      line: Number.isFinite(Number(event.line)) ? Number(event.line) : null,
      sourcePath: String(event.sourcePath ?? ''),
      sourceLine: Number.isFinite(Number(event.sourceLine)) ? Number(event.sourceLine) : null,
    }
  }

  if (event.type === 'agent_result') {
    const metadata = (event.metadata && typeof event.metadata === 'object') ? event.metadata : null
    if (!metadata) return null
    return {
      agent: String(event.agent ?? ''),
      metadata,
    }
  }

  return null
}

function formatExecutionEventContent(event) {
  const type = event.type
  if (type === 'output') {
    const format = event.format || 'text'
    let content = event.content || ''

    if (format === 'json') {
      const hasValue = Object.prototype.hasOwnProperty.call(event, 'value')
      const hasPayload = Object.prototype.hasOwnProperty.call(event, 'payload')
      const candidate = hasValue
        ? event.value
        : (hasPayload ? event.payload : parseMaybeJson(event.content))

      if (candidate != null) {
        if (typeof candidate === 'string') {
          const parsed = parseMaybeJson(candidate)
          if (parsed != null) {
            try {
              content = JSON.stringify(parsed, null, 2)
            } catch {
              content = candidate
            }
          } else {
            content = candidate
          }
        } else {
          try {
            content = JSON.stringify(candidate, null, 2)
          } catch {
            content = String(candidate)
          }
        }
      }
    }

    const text = String(content ?? '')
    const snippet = text.length > 60 ? text.slice(0, 60) + '…' : text
    return `${format}: ${snippet}`
  }
  if (type === 'tool_call') {
    const tool = event.tool || 'unknown'
    if (tool === 'agent' || tool === 'model') {
      return `call: ${tool} ${summarizeToolCallArgs(event.args)}`
    }
    return `call: ${tool}`
  }
  if (type === 'agent_call') {
    const agent = String(event.agent ?? 'unknown')
    return `agent call: ${agent}`
  }
  if (type === 'agent_result') {
    const agent = String(event.agent ?? 'unknown')
    const elapsedMs = Number(event?.metadata?.elapsedMs)
    if (Number.isFinite(elapsedMs)) {
      return `agent result: ${agent} (${Math.max(0, Math.round(elapsedMs))}ms)`
    }
    return `agent result: ${agent}`
  }
  if (type === 'tool_result') {
    const tool = event.tool || 'unknown'
    return `result: ${tool}`
  }
  if (type === 'state_update') {
    return 'state updated'
  }
  if (type === 'warning') {
    return event.message || event.code || 'warning'
  }
  return ''
}

export function setNextVEventsLiveMode(live) {
  _setNextVEventsLiveMode(live)

  const btn = document.getElementById('nextv-events-live-btn')
  const badge = document.getElementById('nextv-events-buffer-count')

  if (!btn) return

  if (live) {
    // Resume: flush buffer and snap back to top
    const buffered = nextVEventsPausedBuffer.slice()
    _setNextVEventsPausedBuffer([])

    if (buffered.length > 0) {
      const newGroups = [...buffered.reverse(), ...nextVExecutionGroups]
      const capped = newGroups.slice(0, 50)
      _setNextVExecutionGroups(capped)
    }

    btn.textContent = 'Live'
    btn.classList.remove('paused')
    if (badge) {
      badge.textContent = ''
      badge.hidden = true
    }
    renderExecutionGroups()
    // Snap to top
    if (nextVEventsOutput) {
      nextVEventsOutput.scrollTop = 0
    }
  } else {
    // Pause: no action needed, state will be updated by handler
    btn.textContent = 'Paused'
    btn.classList.add('paused')
  }
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  _setActiveScriptRunId,
  _setRemoteRuntimeEntrypointPath,
  _setRemoteRuntimeWorkspaceDir,
  activeScriptRunId,
  fileManagerShell,
  workspace,
  inputPanelState,
  isBusy,
  isRemoteControlMode,
  isRemoteMode,
  isRemoteRuntimeConnected,
  logsHeaderBadge,
  logsHeaderTitle,
  nextVConsoleOutput,
  nextVEntrypointInput,
  nextVEventSourceInput,
  nextVEventTypeInput,
  nextVEventsOutput,
  nextVGraphMappingApi,
  nextVGraphOutput,
  nextVGraphShell,
  nextVGraphState,
  nextVImagesRow,
  nextVIngressControlsRow,
  nextVIngressControlsState,
  nextVInputChannelState,
  nextVInputExternalPane,
  nextVInputImageState,
  nextVInputTabs,
  nextVManagedProcessRunning,
  nextVPanelState,
  nextVReloadConfigBtn,
  nextVValidateBtn,
  nextVPromoteBtn,
  nextVRefreshSnapshotBtn,
  nextVRunBtn,
  nextVRuntimeRunning,
  nextVCandidatePromotable,
  nextVAttachSessionState,
  nextVAttachControls,
  nextVAttachBtn,
  nextVDetachBtn,
  nextVAttachStatus,
  nextVAttachWsUrlInput,
  nextVAttachWsUrlLabel,
  nextVAttachStartOverrideInput,
  nextVAttachStartOverrideLabel,
  nextVEntrypointLabel,
  nextVOpenWorkspaceBtn,
  nextVConfigRow,
  nextVWorkspaceDirInput,
  nextVRuntimeTargetInput,
  nextVRuntimeTargetState,
  nextVShowIngressToggle,
  nextVStartBtn,
  nextVStateDiffFeed,
  nextVStateDiffTabDiff,
  nextVStateDiffTabState,
  nextVStateSnapshotPane,
  nextVStopBtn,
  nextVTabConsole,
  nextVViewCallInspector,
  nextVCallInspectorPanel,
  nextVTabEvents,
  nextVTabTrace,
  nextVUserIOSplitter,
  nextVViewEditor,
  nextVViewGraph,
  nextVViewState,
  nextVThemeModeInput,
  nextVThemeChipDayBtn,
  nextVThemeChipNightBtn,
  outputHeaderBadge,
  outputHeaderTitle,
  remoteModeBadge,
  remoteRuntimeEntrypointPath,
  remoteRuntimeWorkspaceDir,
  remoteTransport,
  scriptEditorPanel,
  scriptHeaderBadge,
  scriptHeaderTitle,
  scriptOutput,
  scriptSection,
  settingsMenu,
  storageKeys,
  toggleNextVDevConsoleBtn,
  toggleNextVFilesBtn,
  toggleNextVImagesBtn,
  toggleUserIOBtn,
  tracePanelState,
  traceShell,
  userIOPanelState
} from './state.js'
import {
  captureNextVGraphViewportState,
  getControlProvenanceClass
} from './05_graph_viewport.js'
import {
  refreshNextVGraph
} from './07_graph_render.js'
import {
  normalizeRelativePath
} from './08_path_utils.js'
import {
  pathBasename,
  applyNextVStateSearchFilter
} from './10_file_tree.js'
import {
  syncNextVRuntimeState,
  runNextVRuntime,
  killNextVRuntime,
  applyLeftPanelHeights,
  applyStoredLeftPanelHeights
} from './12_stream.js'
import {
  ensureNextVEntrypointVisible
} from './13_layout.js'

export function isNextVMode() {
  return document.body.classList.contains('mode-nextv')
}

export function setActiveScriptRunId(runId) {
  _setActiveScriptRunId(String(runId ?? '').trim())
}

export function setNextVFileDrawerOpen(isOpen, options = {}) {
  const { persist = true } = options
  const open = isOpen !== false
  document.body.classList.toggle('nextv-tree-collapsed', !open)

  if (toggleNextVFilesBtn) {
    toggleNextVFilesBtn.textContent = open ? '◂' : '▸'
    toggleNextVFilesBtn.title = open ? 'collapse file drawer' : 'expand file drawer'
    toggleNextVFilesBtn.setAttribute('aria-label', open ? 'collapse file drawer' : 'expand file drawer')
    toggleNextVFilesBtn.setAttribute('aria-pressed', open ? 'true' : 'false')
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVTreeDrawerOpen, open ? '1' : '0')
  }
}

export function toggleNextVFileDrawer() {
  const collapsed = document.body.classList.contains('nextv-tree-collapsed')
  setNextVFileDrawerOpen(collapsed)
}

export function setModePanelLabels(mode) {
  const labelsByMode = {
    script: {
      scriptTitle: 'script',
      scriptBadge: 'source',
      logsTitle: 'execution log',
      logsBadge: 'events',
      outputTitle: 'script output',
      outputBadge: 'text',
    },
    nextv: {
      scriptTitle: 'files',
      scriptBadge: 'active',
      logsTitle: 'event stream',
      logsBadge: 'events',
      outputTitle: '',
      outputBadge: '',
    },
    chat: {
      scriptTitle: 'script',
      scriptBadge: 'source',
      logsTitle: 'script logs',
      logsBadge: 'events',
      outputTitle: 'script output',
      outputBadge: 'text',
    },
  }

  const labels = labelsByMode[mode] ?? labelsByMode.chat
  if (scriptHeaderTitle) scriptHeaderTitle.textContent = labels.scriptTitle
  if (scriptHeaderBadge) scriptHeaderBadge.textContent = labels.scriptBadge
  if (logsHeaderTitle) logsHeaderTitle.textContent = labels.logsTitle
  if (logsHeaderBadge) logsHeaderBadge.textContent = labels.logsBadge
  if (outputHeaderTitle) {
    outputHeaderTitle.textContent = labels.outputTitle
    outputHeaderTitle.style.display = labels.outputTitle ? 'inline' : 'none'
  }
  if (outputHeaderBadge) {
    outputHeaderBadge.textContent = labels.outputBadge
    outputHeaderBadge.style.display = labels.outputBadge ? 'inline-block' : 'none'
  }
}

export function setNextVPrimaryView(view, options = {}) {
  const { persist = true } = options
  const nextView = view === 'graph' ? 'graph' : 'graph'
  const previousView = nextVViewState.currentView

  if (previousView === 'graph' && nextView !== 'graph') {
    const captured = captureNextVGraphViewportState()
    if (captured) {
      nextVGraphState.savedViewportState = captured
    }
  }

  nextVViewState.currentView = nextView
  document.body.classList.toggle('nextv-primary-editor', nextView === 'editor')
  document.body.classList.toggle('nextv-primary-graph', nextView === 'graph')

  if (nextVViewEditor) {
    nextVViewEditor.classList.toggle('active', nextView === 'editor')
    nextVViewEditor.setAttribute('aria-selected', nextView === 'editor' ? 'true' : 'false')
  }

  if (nextVViewGraph) {
    nextVViewGraph.classList.toggle('active', nextView === 'graph')
    nextVViewGraph.setAttribute('aria-selected', nextView === 'graph' ? 'true' : 'false')
  }

  if (fileManagerShell) {
    fileManagerShell.classList.toggle('active-primary-view', nextView === 'editor')
  }

  if (nextVGraphShell) {
    nextVGraphShell.classList.toggle('active-primary-view', nextView === 'graph')
  }

  if (nextView === 'graph') {
    refreshNextVGraph({
      silent: true,
      preserveViewport: true,
      viewportStateOverride: nextVGraphState.savedViewportState,
    })
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVPrimaryView, nextView)
  }
}

export function normalizeNextVThemeMode(value) {
  return String(value ?? '').trim().toLowerCase() === 'day' ? 'day' : 'night'
}

export function setNextVThemeMode(mode, options = {}) {
  const { persist = true } = options
  const nextMode = normalizeNextVThemeMode(mode)
  document.body.dataset.theme = nextMode
  if (nextVThemeModeInput) {
    nextVThemeModeInput.value = nextMode
  }
  if (nextVThemeChipDayBtn) {
    const active = nextMode === 'day'
    nextVThemeChipDayBtn.classList.toggle('active', active)
    nextVThemeChipDayBtn.setAttribute('aria-pressed', active ? 'true' : 'false')
  }
  if (nextVThemeChipNightBtn) {
    const active = nextMode === 'night'
    nextVThemeChipNightBtn.classList.toggle('active', active)
    nextVThemeChipNightBtn.setAttribute('aria-pressed', active ? 'true' : 'false')
  }
  if (persist) {
    localStorage.setItem(storageKeys.nextVThemeMode, nextMode)
  }
}

export function normalizeNextVGraphDirection(value) {
  return String(value ?? '').trim().toUpperCase() === 'LR' ? 'LR' : 'TB'
}

export function setNextVGraphDirection(direction, options = {}) {
  const { persist = true, refresh = true } = options
  const nextDirection = normalizeNextVGraphDirection(direction)
  nextVGraphState.layoutDirection = nextDirection

  if (persist) {
    localStorage.setItem(storageKeys.nextVGraphDirection, nextDirection)
  }

  if (refresh && isNextVMode() && nextVViewState.currentView === 'graph') {
    refreshNextVGraph({ silent: true })
  }
}

export function setNextVControlOverlayEnabled(enabled, options = {}) {
  const { persist = true, refresh = true } = options
  const nextEnabled = enabled !== false
  nextVGraphState.controlOverlayEnabled = nextEnabled

  if (persist) {
    localStorage.setItem(storageKeys.nextVControlOverlay, nextEnabled ? '1' : '0')
  }

  if (refresh && isNextVMode() && nextVViewState.currentView === 'graph') {
    refreshNextVGraph({
      silent: true,
      preserveViewport: true,
      viewportStateOverride: nextVGraphState.savedViewportState,
    })
  }
}

export function isNextVControlOverlayEnabled() {
  return nextVGraphState.controlOverlayEnabled !== false
}

export function setNextVControlBranchesVisible(enabled, options = {}) {
  const { persist = true, refresh = true } = options
  const nextEnabled = enabled === true
  nextVGraphState.showControlBranches = nextEnabled

  if (persist) {
    localStorage.setItem(storageKeys.nextVShowControlBranches, nextEnabled ? '1' : '0')
  }

  if (refresh && isNextVMode() && nextVViewState.currentView === 'graph') {
    refreshNextVGraph({
      silent: true,
      preserveViewport: true,
      viewportStateOverride: nextVGraphState.savedViewportState,
    })
  }
}

export function isNextVControlBranchesVisible() {
  return nextVGraphState.showControlBranches === true
}

export function getControlOverlayClassName(provenance) {
  if (typeof nextVGraphMappingApi?.getControlOverlayClassName === 'function') {
    return nextVGraphMappingApi.getControlOverlayClassName(provenance, isNextVControlOverlayEnabled())
  }
  if (!isNextVControlOverlayEnabled()) return 'control-overlay-off'
  return `control-${getControlProvenanceClass(provenance)}`
}

export function setNextVStateDiffTab(tab) {
  const nextTab = tab === 'state' ? 'state' : 'diff'
  if (nextVStateDiffTabDiff) {
    nextVStateDiffTabDiff.classList.toggle('active', nextTab === 'diff')
    nextVStateDiffTabDiff.setAttribute('aria-selected', nextTab === 'diff' ? 'true' : 'false')
  }
  if (nextVStateDiffTabState) {
    nextVStateDiffTabState.classList.toggle('active', nextTab === 'state')
    nextVStateDiffTabState.setAttribute('aria-selected', nextTab === 'state' ? 'true' : 'false')
  }
  if (nextVStateDiffFeed) nextVStateDiffFeed.classList.toggle('active-state-pane', nextTab === 'diff')
  if (nextVStateSnapshotPane) nextVStateSnapshotPane.classList.toggle('active-state-pane', nextTab === 'state')
  const clearBtn = document.getElementById('nextv-state-diff-clear-btn')
  if (clearBtn) clearBtn.style.visibility = nextTab === 'diff' ? '' : 'hidden'
  applyNextVStateSearchFilter()
}

export function setNextVDevTab(tab, options = {}) {
  const { persist = true } = options
  const requestedTab = ['events', 'trace', 'console'].includes(tab) ? tab : 'events'

  let nextTab = requestedTab
  tracePanelState.currentTab = nextTab

  if (nextVTabEvents) {
    nextVTabEvents.classList.toggle('active', nextTab === 'events')
    nextVTabEvents.setAttribute('aria-selected', nextTab === 'events' ? 'true' : 'false')
  }
  if (nextVTabTrace) {
    nextVTabTrace.classList.toggle('active', nextTab === 'trace')
    nextVTabTrace.setAttribute('aria-selected', nextTab === 'trace' ? 'true' : 'false')
  }
  if (nextVTabConsole) {
    nextVTabConsole.classList.toggle('active', nextTab === 'console')
    nextVTabConsole.setAttribute('aria-selected', nextTab === 'console' ? 'true' : 'false')
  }

  if (nextVEventsOutput) {
    const showEvents = isNextVMode() && nextTab === 'events'
    nextVEventsOutput.classList.toggle('active-tab-pane', showEvents)
  }

  if (traceShell) {
    const showTrace = isNextVMode() && nextTab === 'trace'
    traceShell.classList.toggle('active-tab-pane', showTrace)
  }

  if (scriptOutput) {
    const showScript = !isNextVMode()
    scriptOutput.classList.toggle('active-tab-pane', showScript)
  }

  if (nextVConsoleOutput) {
    const showConsole = isNextVMode() && nextTab === 'console'
    nextVConsoleOutput.classList.toggle('active-tab-pane', showConsole)
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVDevTab, nextTab)
  }
}

export function setNextVDevConsoleOpen(open, options = {}) {
  const { persist = true } = options
  const nextOpen = open !== false
  nextVPanelState.devConsoleOpen = nextOpen
  document.body.classList.toggle('nextv-dev-console-collapsed', !nextOpen)

  if (toggleNextVDevConsoleBtn) {
    toggleNextVDevConsoleBtn.textContent = nextOpen ? 'hide console' : 'show console'
    toggleNextVDevConsoleBtn.title = nextOpen ? 'hide dev console' : 'show dev console'
    toggleNextVDevConsoleBtn.setAttribute('aria-pressed', nextOpen ? 'true' : 'false')
  }

  if (isNextVMode()) {
    if (nextOpen) {
      window.requestAnimationFrame(() => {
        if (!applyStoredLeftPanelHeights()) {
          applyLeftPanelHeights([0.62, 0.38])
        }
      })
    } else if (scriptSection) {
      scriptSection.style.flex = '1 1 auto'
    }
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVDevConsoleOpen, nextOpen ? '1' : '0')
  }
}

export function toggleNextVDevConsole() {
  setNextVDevConsoleOpen(!nextVPanelState.devConsoleOpen)
}

function getNextVCallInspectorPanelShell() {
  if (workspace) return workspace
  if (fileManagerShell) return fileManagerShell
  return null
}

function getNextVCallInspectorPanelDefaultLayout() {
  return { left: 12, top: 12, width: 760, height: 860 }
}

let nextVCallInspectorPanelLayoutState = null

function readStoredNextVCallInspectorPanelLayout() {
  const raw = String(localStorage.getItem(storageKeys.nextVCallInspectorPanelLayout) ?? '').trim()
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clampNextVCallInspectorPanelLayout(rect) {
  const shell = getNextVCallInspectorPanelShell()
  if (!shell) return null
  const shellWidth = Math.max(320, shell.clientWidth || 0)
  const shellHeight = Math.max(280, shell.clientHeight || 0)

  const width = Math.max(520, Math.min(Number(rect?.width ?? 760), shellWidth - 8))
  const height = Math.max(560, Math.min(Number(rect?.height ?? 860), shellHeight - 8))

  // Keep part of the panel visible while allowing larger panels to move freely.
  const minVisibleX = 120
  const minVisibleY = 52
  const minLeft = Math.min(0, shellWidth - width)
  const maxLeft = Math.max(0, shellWidth - minVisibleX)
  const minTop = Math.min(0, shellHeight - height)
  const maxTop = Math.max(0, shellHeight - minVisibleY)
  const left = Math.max(minLeft, Math.min(Number(rect?.left ?? 12), maxLeft))
  const top = Math.max(minTop, Math.min(Number(rect?.top ?? 12), maxTop))

  return { left, top, width, height }
}

function applyNextVCallInspectorPanelLayout(rect) {
  if (!nextVCallInspectorPanel) return
  const clamped = clampNextVCallInspectorPanelLayout(rect)
  if (!clamped) return
  nextVCallInspectorPanelLayoutState = { ...clamped }

  nextVCallInspectorPanel.style.left = `${clamped.left}px`
  nextVCallInspectorPanel.style.top = `${clamped.top}px`
  nextVCallInspectorPanel.style.width = `${clamped.width}px`
  nextVCallInspectorPanel.style.height = `${clamped.height}px`
  nextVCallInspectorPanel.style.right = 'auto'
}

function persistNextVCallInspectorPanelLayout() {
  const fallbackLayout = nextVCallInspectorPanelLayoutState || getNextVCallInspectorPanelDefaultLayout()
  let layout = fallbackLayout

  if (nextVCallInspectorPanel && !nextVCallInspectorPanel.hidden) {
    const shell = getNextVCallInspectorPanelShell()
    if (shell) {
      const shellRect = shell.getBoundingClientRect()
      const panelRect = nextVCallInspectorPanel.getBoundingClientRect()
      layout = clampNextVCallInspectorPanelLayout({
        left: panelRect.left - shellRect.left,
        top: panelRect.top - shellRect.top,
        width: panelRect.width,
        height: panelRect.height,
      }) || fallbackLayout
    }
  }

  if (!layout) return
  nextVCallInspectorPanelLayoutState = { ...layout }
  localStorage.setItem(storageKeys.nextVCallInspectorPanelLayout, JSON.stringify(layout))
}

function restoreNextVCallInspectorPanelLayout() {
  const storedLayout = readStoredNextVCallInspectorPanelLayout()
  if (!storedLayout) {
    applyNextVCallInspectorPanelLayout(getNextVCallInspectorPanelDefaultLayout())
    return
  }

  applyNextVCallInspectorPanelLayout(storedLayout)
}

export function initNextVCallInspectorPanelChrome() {
  if (!nextVCallInspectorPanel || nextVCallInspectorPanel.dataset.panelChromeBound === '1') return
  nextVCallInspectorPanel.dataset.panelChromeBound = '1'

  restoreNextVCallInspectorPanelLayout()

  const header = nextVCallInspectorPanel.querySelector('.nextv-call-inspector-header')
  if (header) {
    header.style.cursor = 'grab'
    header.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) return
      const shell = getNextVCallInspectorPanelShell()
      if (!shell) return

      const panelRect = nextVCallInspectorPanel.getBoundingClientRect()
      const startOffsetX = event.clientX - panelRect.left
      const startOffsetY = event.clientY - panelRect.top
      nextVCallInspectorPanel.classList.add('is-dragging')
      event.preventDefault()

      const onMove = (moveEvent) => {
        const shellRect = shell.getBoundingClientRect()
        const nextLeft = moveEvent.clientX - shellRect.left - startOffsetX
        const nextTop = moveEvent.clientY - shellRect.top - startOffsetY
        applyNextVCallInspectorPanelLayout({
          left: nextLeft,
          top: nextTop,
          width: nextVCallInspectorPanel.offsetWidth,
          height: nextVCallInspectorPanel.offsetHeight,
        })
      }

      const onUp = () => {
        nextVCallInspectorPanel.classList.remove('is-dragging')
        persistNextVCallInspectorPanelLayout()
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (nextVCallInspectorPanel.hidden) return
      persistNextVCallInspectorPanelLayout()
    })
    observer.observe(nextVCallInspectorPanel)
  }

  window.addEventListener('resize', () => {
    const storedLayout = readStoredNextVCallInspectorPanelLayout()
    if (!storedLayout) return
    applyNextVCallInspectorPanelLayout(storedLayout)
  })

  window.addEventListener('beforeunload', () => {
    persistNextVCallInspectorPanelLayout()
  })

  window.requestAnimationFrame(() => {
    restoreNextVCallInspectorPanelLayout()
  })
}

export function toggleNextVCallInspectorPanel() {
  if (!nextVCallInspectorPanel) return
  initNextVCallInspectorPanelChrome()
  const isOpen = !nextVCallInspectorPanel.hidden
  if (isOpen) {
    persistNextVCallInspectorPanelLayout()
  }
  nextVCallInspectorPanel.hidden = isOpen
  nextVCallInspectorPanel.classList.toggle('is-active', !isOpen)
  if (!isOpen) {
    window.requestAnimationFrame(() => {
      restoreNextVCallInspectorPanelLayout()
    })
  }
  
  if (nextVViewCallInspector) {
    nextVViewCallInspector.classList.toggle('active', !isOpen)
    nextVViewCallInspector.setAttribute('aria-selected', !isOpen ? 'true' : 'false')
  }
  
  if (!isOpen) {
    // Panel is now open, set focus
    nextVCallInspectorPanel.focus()
  }
}

export function clampNextVUserIOWidth(value) {
  const numeric = Number(value)
  const maxWidth = Math.max(340, Math.min(860, Math.round(window.innerWidth * 0.72)))
  if (!Number.isFinite(numeric)) return 320
  return Math.max(240, Math.min(maxWidth, Math.round(numeric)))
}

export function persistNextVUserIOWidth(width) {
  localStorage.setItem(storageKeys.nextVUserIOWidth, String(clampNextVUserIOWidth(width)))
}

export function getStoredNextVUserIOWidth() {
  const stored = Number(localStorage.getItem(storageKeys.nextVUserIOWidth))
  if (!Number.isFinite(stored)) return 320
  return clampNextVUserIOWidth(stored)
}

export function setUserIOPanelOpen(open, options = {}) {
  const { persist = true } = options
  userIOPanelState.open = open !== false
  document.body.classList.toggle('user-io-open', userIOPanelState.open)

  if (scriptEditorPanel) {
    scriptEditorPanel.style.width = userIOPanelState.open ? `${getStoredNextVUserIOWidth()}px` : '0px'
  }

  if (nextVUserIOSplitter) {
    nextVUserIOSplitter.classList.toggle('collapsed', !userIOPanelState.open)
  }

  if (toggleUserIOBtn) {
    toggleUserIOBtn.textContent = userIOPanelState.open ? 'hide input' : 'show input'
    toggleUserIOBtn.setAttribute('aria-pressed', userIOPanelState.open ? 'true' : 'false')
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVUserIOOpen, userIOPanelState.open ? '1' : '0')
  }
}

export function toggleUserIOPanel() {
  setUserIOPanelOpen(!userIOPanelState.open)
}

export function setNextVImagesOpen(open, options = {}) {
  const { persist = true } = options
  nextVInputImageState.open = open === true

  if (nextVImagesRow) {
    nextVImagesRow.hidden = !nextVInputImageState.open
    nextVImagesRow.style.display = nextVInputImageState.open ? '' : 'none'
  }

  const count = nextVInputImageState.entries.length
  if (toggleNextVImagesBtn) {
    toggleNextVImagesBtn.textContent = nextVInputImageState.open
      ? 'hide images'
      : (count > 0 ? `show images (${count})` : 'show images')
    toggleNextVImagesBtn.setAttribute('aria-pressed', nextVInputImageState.open ? 'true' : 'false')
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVImagesOpen, nextVInputImageState.open ? '1' : '0')
  }
}

export function toggleNextVImagesOpen() {
  setNextVImagesOpen(!nextVInputImageState.open)
}

export function setNextVIngressControlsVisible(visible, options = {}) {
  const { persist = true } = options
  nextVIngressControlsState.visible = visible === true

  if (nextVIngressControlsRow) {
    nextVIngressControlsRow.hidden = !nextVIngressControlsState.visible
    nextVIngressControlsRow.style.display = nextVIngressControlsState.visible ? '' : 'none'
  }

  if (nextVShowIngressToggle) {
    nextVShowIngressToggle.checked = nextVIngressControlsState.visible
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVIngressControlsVisible, nextVIngressControlsState.visible ? '1' : '0')
  }
}

export function toggleNextVIngressControlsSetting() {
  const visible = nextVShowIngressToggle?.checked !== false
  setNextVIngressControlsVisible(visible)
}

export function normalizeNextVRuntimeTarget(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'external') return 'external'
  if (normalized === 'attach') return 'attach'
  return 'embedded'
}

export function normalizeNextVAttachWsUrl(value) {
  return String(value ?? '').trim()
}

export function getNextVAttachWsUrl() {
  return normalizeNextVAttachWsUrl(nextVRuntimeTargetState.attachWsUrl)
}

export function isNextVAttachStartOverrideEnabled() {
  return nextVAttachStartOverrideInput?.checked === true
}

function syncNextVAttachStartOverrideUi(showAttachControls) {
  if (nextVAttachStartOverrideLabel) {
    nextVAttachStartOverrideLabel.hidden = !showAttachControls
  }
}

function syncNextVAttachConfigUi() {
  const isAttachMode = getNextVRuntimeTarget() === 'attach'
  const hideInAttachMode = isAttachMode

  if (nextVConfigRow) {
    nextVConfigRow.hidden = hideInAttachMode
    nextVConfigRow.style.display = hideInAttachMode ? 'none' : ''
  }

  if (nextVWorkspaceDirInput) {
    nextVWorkspaceDirInput.hidden = hideInAttachMode
    nextVWorkspaceDirInput.style.display = hideInAttachMode ? 'none' : ''
  }

  if (nextVOpenWorkspaceBtn) {
    nextVOpenWorkspaceBtn.hidden = hideInAttachMode
    nextVOpenWorkspaceBtn.style.display = hideInAttachMode ? 'none' : ''
  }

  if (nextVEntrypointLabel) {
    nextVEntrypointLabel.hidden = hideInAttachMode
    nextVEntrypointLabel.style.display = hideInAttachMode ? 'none' : ''
  }

  if (nextVEntrypointInput) {
    nextVEntrypointInput.hidden = hideInAttachMode
    nextVEntrypointInput.style.display = hideInAttachMode ? 'none' : ''
  }

  if (nextVAttachStartOverrideLabel) {
    nextVAttachStartOverrideLabel.hidden = true
    nextVAttachStartOverrideLabel.style.display = 'none'
  }
}

function syncNextVAttachRuntimeOwnershipUi() {
  const isAttachMode = getNextVRuntimeTarget() === 'attach'
  const lockToAttachedRuntime = isAttachMode && !isNextVAttachStartOverrideEnabled()
  const lockHint = lockToAttachedRuntime
    ? 'Controlled by attached runtime. Enable override to edit locally.'
    : ''

  if (nextVWorkspaceDirInput) {
    nextVWorkspaceDirInput.readOnly = lockToAttachedRuntime
    nextVWorkspaceDirInput.classList.toggle('attach-runtime-owned', lockToAttachedRuntime)
    nextVWorkspaceDirInput.title = lockHint
  }

  if (nextVEntrypointInput) {
    nextVEntrypointInput.readOnly = lockToAttachedRuntime
    nextVEntrypointInput.classList.toggle('attach-runtime-owned', lockToAttachedRuntime)
    nextVEntrypointInput.title = lockHint
  }

  if (nextVOpenWorkspaceBtn) {
    nextVOpenWorkspaceBtn.disabled = lockToAttachedRuntime
    nextVOpenWorkspaceBtn.title = lockHint
  }
}

export function setNextVAttachStartOverrideEnabled(value, options = {}) {
  const { persist = true } = options
  const enabled = value === true
  if (nextVAttachStartOverrideInput) {
    nextVAttachStartOverrideInput.checked = enabled
  }
  if (persist) {
    localStorage.setItem(storageKeys.nextVAttachStartOverride, enabled ? '1' : '0')
  }
  syncNextVAttachRuntimeOwnershipUi()
  setNextVRunControls()
}

export function syncNextVAttachWsUrlControls() {
  const showAttachControls = getNextVRuntimeTarget() === 'attach'
  if (nextVAttachWsUrlLabel) {
    nextVAttachWsUrlLabel.hidden = !showAttachControls
  }
  if (nextVAttachWsUrlInput) {
    nextVAttachWsUrlInput.hidden = !showAttachControls
    nextVAttachWsUrlInput.disabled = !showAttachControls
    nextVAttachWsUrlInput.value = getNextVAttachWsUrl()
  }
  if (nextVAttachControls) {
    nextVAttachControls.hidden = !showAttachControls
  }
  if (nextVAttachStatus) {
    nextVAttachStatus.hidden = !showAttachControls
  }
  syncNextVAttachStartOverrideUi(showAttachControls)
  syncNextVAttachConfigUi()
  syncNextVAttachRuntimeOwnershipUi()
  syncNextVAttachSessionUi()
}

export function syncNextVAttachSessionUi() {
  const isAttachMode = getNextVRuntimeTarget() === 'attach'
  const isConnecting = nextVAttachSessionState.connecting === true
  const isAttached = nextVAttachSessionState.attached === true
  const hasAttachUrl = Boolean(getNextVAttachWsUrl())

  if (nextVAttachBtn) {
    nextVAttachBtn.disabled = !isAttachMode || isConnecting || isAttached || !hasAttachUrl
  }
  if (nextVDetachBtn) {
    nextVDetachBtn.disabled = !isAttachMode || isConnecting || !isAttached
  }
  if (nextVAttachStatus) {
    if (!isAttachMode) {
      nextVAttachStatus.dataset.state = 'detached'
      nextVAttachStatus.textContent = 'detached'
    } else if (isConnecting) {
      nextVAttachStatus.dataset.state = 'attaching'
      nextVAttachStatus.textContent = 'attaching'
    } else if (isAttached) {
      nextVAttachStatus.dataset.state = 'attached'
      nextVAttachStatus.textContent = 'attached'
    } else if (nextVAttachSessionState.lastError) {
      nextVAttachStatus.dataset.state = 'error'
      nextVAttachStatus.textContent = 'attach failed'
    } else {
      nextVAttachStatus.dataset.state = 'detached'
      nextVAttachStatus.textContent = 'detached'
    }
    if (nextVAttachSessionState.lastError) {
      nextVAttachStatus.title = String(nextVAttachSessionState.lastError)
    } else {
      nextVAttachStatus.title = nextVAttachStatus.textContent
    }
  }
}

export function setNextVAttachWsUrl(value, options = {}) {
  const { persist = true, sync = true } = options
  const previousUrl = String(nextVRuntimeTargetState.attachWsUrl ?? '').trim()
  const normalized = normalizeNextVAttachWsUrl(value)
  nextVRuntimeTargetState.attachWsUrl = normalized
  if (previousUrl !== normalized) {
    nextVAttachSessionState.attached = false
    nextVAttachSessionState.connecting = false
  }
  nextVAttachSessionState.lastError = ''
  if (nextVAttachWsUrlInput) {
    nextVAttachWsUrlInput.value = normalized
  }
  if (persist) {
    localStorage.setItem(storageKeys.nextVAttachWsUrl, normalized)
  }
  syncNextVAttachSessionUi()
  if (sync && getNextVRuntimeTarget() === 'attach' && nextVAttachSessionState.attached === true) {
    syncNextVRuntimeState()
  }
}

export function getNextVRuntimeTarget() {
  return normalizeNextVRuntimeTarget(nextVRuntimeTargetState.target)
}

export function setNextVRuntimeTarget(value, options = {}) {
  const { persist = true, sync = true } = options
  const normalized = normalizeNextVRuntimeTarget(value)
  nextVRuntimeTargetState.target = normalized
  if (normalized !== 'attach') {
    nextVAttachSessionState.attached = false
    nextVAttachSessionState.connecting = false
    nextVAttachSessionState.lastError = ''
  }
  if (nextVRuntimeTargetInput) {
    nextVRuntimeTargetInput.value = normalized
  }
  syncNextVAttachWsUrlControls()
  if (persist) {
    localStorage.setItem(storageKeys.nextVRuntimeTarget, normalized)
  }
  if (sync) {
    syncNextVRuntimeState()
  }
}

export function buildNextVApiPath(pathname) {
  const url = new URL(String(pathname ?? ''), window.location.origin)
  const params = url.searchParams
  const runtimeTarget = getNextVRuntimeTarget()
  params.set('runtimeTarget', runtimeTarget)
  if (runtimeTarget === 'attach') {
    const attachWsUrl = getNextVAttachWsUrl()
    if (attachWsUrl) {
      params.set('attachWsUrl', attachWsUrl)
    } else {
      params.delete('attachWsUrl')
    }
  } else {
    params.delete('attachWsUrl')
  }
  const query = params.toString()
  return query ? `${url.pathname}?${query}` : url.pathname
}

export function normalizeDeclaredExternalChannels(rawChannels) {
  if (!Array.isArray(rawChannels)) return []
  return [...new Set(rawChannels.map((channel) => String(channel ?? '').trim()).filter(Boolean))]
}

export function getSelectedNextVInputChannel(tab = inputPanelState.currentTab) {
  const rawTab = String(tab ?? '').trim()
  if (!rawTab.startsWith('channel:')) return ''
  const channel = rawTab.slice('channel:'.length).trim()
  if (!channel) return ''
  return nextVInputChannelState.declaredExternals.includes(channel) ? channel : ''
}

export function renderNextVInputTabs() {
  if (!nextVInputTabs) return

  const selectedChannel = getSelectedNextVInputChannel()
  const selectedTab = selectedChannel ? `channel:${selectedChannel}` : 'manual'
  const entries = [
    { id: 'manual', label: 'manual' },
    ...nextVInputChannelState.declaredExternals.map((channel) => ({
      id: `channel:${channel}`,
      label: channel,
    })),
  ]

  nextVInputTabs.innerHTML = ''
  for (const entry of entries) {
    if (entry.id !== 'manual' && nextVInputTabs.childElementCount === 1) {
      const separator = document.createElement('span')
      separator.className = 'channel-group-separator'
      separator.setAttribute('aria-hidden', 'true')
      nextVInputTabs.appendChild(separator)
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = `panel-tab${entry.id === selectedTab ? ' active' : ''}`
    if (entry.id !== 'manual') {
      button.classList.add('is-declared')
    }
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', entry.id === selectedTab ? 'true' : 'false')
    button.textContent = entry.label
    button.addEventListener('click', () => {
      setNextVInputTab(entry.id)
    })
    nextVInputTabs.appendChild(button)
  }
}

export function syncSelectedInputChannelFields() {
  const channel = getSelectedNextVInputChannel()
  if (nextVEventTypeInput) {
    nextVEventTypeInput.disabled = Boolean(channel)
    nextVEventTypeInput.value = channel || String(nextVEventTypeInput.value ?? '')
  }
  if (nextVEventSourceInput) {
    nextVEventSourceInput.disabled = false
    nextVEventSourceInput.value = channel ? '' : String(nextVEventSourceInput.value ?? '')
  }
}

export function setDeclaredExternalChannels(channels, options = {}) {
  const { preserveSelection = true } = options
  nextVInputChannelState.declaredExternals = normalizeDeclaredExternalChannels(channels)

  if (!preserveSelection) {
    inputPanelState.currentTab = 'manual'
  }

  const selectedChannel = getSelectedNextVInputChannel(inputPanelState.currentTab)
  if (!selectedChannel && String(inputPanelState.currentTab ?? '').trim().startsWith('channel:')) {
    inputPanelState.currentTab = 'manual'
  }

  renderNextVInputTabs()
  syncSelectedInputChannelFields()
}

export function setNextVInputTab(tab, options = {}) {
  const { persist = true } = options
  const requestedTab = String(tab ?? '').trim()
  const selectedChannel = getSelectedNextVInputChannel(requestedTab)
  const nextTab = selectedChannel ? `channel:${selectedChannel}` : 'manual'
  inputPanelState.currentTab = nextTab

  renderNextVInputTabs()
  syncSelectedInputChannelFields()

  if (nextVInputExternalPane) {
    const showExternal = isNextVMode()
    nextVInputExternalPane.classList.toggle('active-input-pane', showExternal)
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVInputTab, nextTab)
  }
}

export function setAppMode(mode) {
  const nextMode = 'nextv'
  document.body.classList.remove('mode-chat', 'mode-script', 'mode-nextv')
  document.body.classList.add(`mode-${nextMode}`)
  if (settingsMenu) settingsMenu.removeAttribute('open')
  setModePanelLabels(nextMode)
  setNextVDevTab(tracePanelState.currentTab, { persist: false })
  setNextVInputTab(inputPanelState.currentTab, { persist: false })
  localStorage.setItem(storageKeys.mode, nextMode)
  window.requestAnimationFrame(() => {
    applyStoredLeftPanelHeights()
    setNextVDevConsoleOpen(nextVPanelState.devConsoleOpen, { persist: false })
  })
}

export function setNextVMode(options = {}) {
  const { ensureEntrypoint = true, refreshGraph = true, preserveViewport = false } = options
  setAppMode('nextv')
  if (ensureEntrypoint) {
    ensureNextVEntrypointVisible({ logLoaded: false, warnOnDirty: true })
  }
  if (refreshGraph) {
    refreshNextVGraph({ silent: true, preserveViewport })
  }
}

export function updateRemoteRuntimeIdentity(data, options = {}) {
  const { clear = false } = options
  if (clear) {
    _setRemoteRuntimeWorkspaceDir('')
    _setRemoteRuntimeEntrypointPath('')
    if (workspace) {
      workspace.dispatchEvent(new CustomEvent('nextv:remote-workspace-identity', {
        detail: { workspaceDir: '', entrypointPath: '' },
      }))
    }
    return
  }

  const nextWorkspaceDir = String(
    data?.remoteRuntimeWorkspaceDir ?? data?.workspaceDir ?? data?.snapshot?.workspaceDir ?? ''
  ).trim()
  const nextEntrypointPath = String(
    data?.remoteRuntimeEntrypointPath ?? data?.entrypointPath ?? data?.snapshot?.entrypointPath ?? ''
  ).trim()

  if (nextWorkspaceDir) {
    _setRemoteRuntimeWorkspaceDir(nextWorkspaceDir)
    if (nextVRuntimeTargetState.target === 'attach' && nextVWorkspaceDirInput) {
      const normalizedValue = nextWorkspaceDir === '.' ? '' : nextWorkspaceDir
      if (String(nextVWorkspaceDirInput.value ?? '').trim() !== normalizedValue) {
        nextVWorkspaceDirInput.value = normalizedValue
      }
    }
  }
  if (nextEntrypointPath) _setRemoteRuntimeEntrypointPath(nextEntrypointPath)

  if (workspace && (nextWorkspaceDir || nextEntrypointPath)) {
    workspace.dispatchEvent(new CustomEvent('nextv:remote-workspace-identity', {
      detail: {
        workspaceDir: nextWorkspaceDir,
        entrypointPath: nextEntrypointPath,
      },
    }))
  }
}

export function updateRemoteModeBadge() {
  if (!remoteModeBadge) return
  remoteModeBadge.hidden = isRemoteMode !== true
  if (!isRemoteMode) {
    remoteModeBadge.textContent = ''
    remoteModeBadge.title = ''
    return
  }

  const workspaceLabel = remoteRuntimeWorkspaceDir && remoteRuntimeWorkspaceDir !== '.'
    ? (pathBasename(remoteRuntimeWorkspaceDir) || remoteRuntimeWorkspaceDir)
    : ''
  const entryLabel = pathBasename(remoteRuntimeEntrypointPath) || remoteRuntimeEntrypointPath

  remoteModeBadge.hidden = !workspaceLabel && !entryLabel
  if (remoteModeBadge.hidden) {
    remoteModeBadge.textContent = ''
    remoteModeBadge.title = ''
    return
  }

  remoteModeBadge.textContent = ''

  if (workspaceLabel) {
    const workspaceChip = document.createElement('span')
    workspaceChip.className = 'remote-mode-badge-chip'
    workspaceChip.textContent = workspaceLabel
    remoteModeBadge.appendChild(workspaceChip)
  }

  if (entryLabel) {
    const entryChip = document.createElement('span')
    entryChip.className = 'remote-mode-badge-chip remote-mode-badge-chip-entry'
    entryChip.textContent = entryLabel
    remoteModeBadge.appendChild(entryChip)
  }

  const titleParts = []
  if (workspaceLabel) titleParts.push(workspaceLabel)
  if (entryLabel) titleParts.push(entryLabel)
  remoteModeBadge.title = titleParts.join(' / ')
}

export function setNextVRunControls() {
  const isExternalMode = nextVRuntimeTargetState.target === 'external'
  const isAttachMode = nextVRuntimeTargetState.target === 'attach'
  const isWsRemoteMode = isRemoteMode && remoteTransport === 'ws'
  const attachOverrideEnabled = isNextVAttachStartOverrideEnabled()
  const hasEntrypoint = isAttachMode && !attachOverrideEnabled
    ? Boolean(normalizeRelativePath(remoteRuntimeEntrypointPath ?? ''))
    : Boolean(normalizeRelativePath(nextVEntrypointInput?.value ?? ''))
  const attachBlocksControl = isAttachMode && nextVAttachSessionState.attached !== true
  const remoteBlocksControl = attachBlocksControl || (isRemoteMode && !isExternalMode && (!isRemoteControlMode || !isRemoteRuntimeConnected))
  
  // In external mode: show run/start buttons separately
  // In embedded mode: show only start button
  if (nextVRunBtn) {
    nextVRunBtn.hidden = !isExternalMode
    if (nextVManagedProcessRunning) {
      nextVRunBtn.textContent = 'kill runtime'
      nextVRunBtn.onclick = killNextVRuntime
      nextVRunBtn.disabled = isBusy
    } else {
      nextVRunBtn.textContent = 'run'
      nextVRunBtn.onclick = runNextVRuntime
      nextVRunBtn.disabled = remoteBlocksControl || isBusy || !hasEntrypoint
    }
  }
  
  // Start button behavior:
  // - In embedded/attach mode: normal behavior (attach starts remote workflow)
  // - In external mode: only enabled after process is running
  if (nextVStartBtn) {
    const startDisabled = isExternalMode
      ? (remoteBlocksControl || !nextVManagedProcessRunning || nextVRuntimeRunning || isBusy)
      : (remoteBlocksControl || nextVRuntimeRunning || isBusy || !hasEntrypoint)
    nextVStartBtn.disabled = startDisabled
  }

  if (isAttachMode && nextVRunBtn) {
    nextVRunBtn.hidden = true
  }
  
  if (nextVStopBtn) nextVStopBtn.disabled = remoteBlocksControl || !nextVRuntimeRunning || isBusy
  const isEmbeddedMode = !isRemoteMode && !isExternalMode && !isAttachMode
  if (nextVReloadConfigBtn) nextVReloadConfigBtn.hidden = isWsRemoteMode
  if (nextVValidateBtn) nextVValidateBtn.hidden = isWsRemoteMode
  if (nextVPromoteBtn) nextVPromoteBtn.hidden = isWsRemoteMode
  if (nextVRefreshSnapshotBtn) nextVRefreshSnapshotBtn.hidden = isWsRemoteMode
  if (nextVReloadConfigBtn) nextVReloadConfigBtn.disabled = !isEmbeddedMode || !nextVRuntimeRunning || isBusy
  if (nextVValidateBtn) nextVValidateBtn.disabled = !isEmbeddedMode || !nextVRuntimeRunning || isBusy
  if (nextVPromoteBtn) nextVPromoteBtn.disabled = !isEmbeddedMode || !nextVCandidatePromotable || isBusy
}

export function appendPanelLogRow(panel, line, cls = '') {
  if (!panel) return
  const row = document.createElement('div')
  row.className = `script-log-row${cls ? ` ${cls}` : ''}`
  row.textContent = line
  panel.appendChild(row)
  panel.scrollTop = panel.scrollHeight
}

export function clearNextVEventsOutput() {
  if (nextVEventsOutput) nextVEventsOutput.innerHTML = ''
}

export function clearNextVConsoleOutput() {
  if (nextVConsoleOutput) nextVConsoleOutput.innerHTML = ''
}

export function clearNextVGraphOutput() {
  if (nextVGraphOutput) nextVGraphOutput.innerHTML = ''
  for (const timerId of nextVGraphState.visualPulseTimers) {
    window.clearTimeout(timerId)
  }
  nextVGraphState.visualPulseTimers.clear()
  nextVGraphState.visualPulseTimersByNode.clear()
  if (nextVGraphState.runtimeAgentTickerId) {
    window.clearInterval(nextVGraphState.runtimeAgentTickerId)
    nextVGraphState.runtimeAgentTickerId = null
  }
  nextVGraphState.handlerLabelLineElements.clear()
  nextVGraphState.agentTimerLabelElements.clear()
  nextVGraphState.detailPopoverEl = null
  nextVGraphState.canvasEl = null
  nextVGraphState.layoutPositions = new Map()
  nextVGraphState.setSelectedGraphNodeFn = null
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  FLOATING_PANEL_IDS,
  _setPendingFloatingPanelChoiceResolver,
  dirtyEditsCache,
  editorLayoutState,
  editorPaneDescriptors,
  nextVFloatingCodeDirty,
  nextVFloatingCodeDirty2,
  nextVFloatingCodeLine,
  nextVFloatingCodeLine2,
  nextVFloatingCodePath,
  nextVFloatingCodePath2,
  nextVFloatingPanelChooser,
  nextVFloatingPanelChooserCancelBtn,
  nextVFloatingPanelChooserDetails,
  nextVFloatingPanelChooserPanel1Btn,
  nextVFloatingPanelChooserPanel2Btn,
  nextVFloatingPanelChooserTitle,
  nextVGraphState,
  nextVViewState,
  nextVWorkspaceDirInput,
  pendingFloatingPanelChoiceResolver
} from './state.js'
import {
  refreshNextVGraph
} from './07_graph_render.js'
import {
  normalizeRelativePath,
  normalizeNextVWorkspaceDir,
  resolveNextVPath,
  canonicalizeFloatingPanelPath,
  normalizePathSegments,
  pathDirname,
  joinRelativePath,
  normalizeGraphSourcePathForEditor
} from './08_path_utils.js'
import {
  renderOpenFileTabs,
  loadEditorFileContent,
  saveEditorFileContent,
  getPaneState,
  getPaneTextarea,
  renderPaneTitles,
  renderScriptMirrorForPane,
  getCurrentNextVEditorTabSize
} from './09_editor.js'
import {
  pathBasename
} from './10_file_tree.js'
import {
  setStatus,
  appendScriptLogRow,
  syncScriptBadgeState,
  normalizeNewlines,
  bindTextareaFileRefCursor,
  findScriptReferenceAtOffset,
  syncScriptMirrorScrollForPane,
  toggleCommentInTextarea
} from './13_layout.js'

export function normalizeFloatingPanelId(panelId) {
  const candidate = String(panelId ?? '').trim().toUpperCase()
  if (FLOATING_PANEL_IDS.includes(candidate)) return candidate
  return nextVGraphState.activeFloatingPanelId || 'FLOAT1'
}

export function getFloatingPanelState(panelId) {
  const id = normalizeFloatingPanelId(panelId)
  return nextVGraphState.floatingPanels.get(id)
}

export function getFloatingPanelDescriptor(panelId) {
  const id = normalizeFloatingPanelId(panelId)
  return {
    id,
    panel: editorPaneDescriptors.get(id)?.pane,
    title: editorPaneDescriptors.get(id)?.title,
    path: id === 'FLOAT1' ? nextVFloatingCodePath : nextVFloatingCodePath2,
    line: id === 'FLOAT1' ? nextVFloatingCodeLine : nextVFloatingCodeLine2,
    dirty: id === 'FLOAT1' ? nextVFloatingCodeDirty : nextVFloatingCodeDirty2,
    textarea: editorPaneDescriptors.get(id)?.textarea,
  }
}

export function setFloatingPanelActive(panelId) {
  const id = normalizeFloatingPanelId(panelId)
  nextVGraphState.activeFloatingPanelId = id
  const now = Date.now()

  for (const panelKey of FLOATING_PANEL_IDS) {
    const descriptor = getFloatingPanelDescriptor(panelKey)
    const state = getFloatingPanelState(panelKey)
    if (!descriptor.panel || !state) continue

    if (panelKey === id && state.open) {
      state.lastFocusedAt = now
      descriptor.panel.style.zIndex = '8'
      descriptor.panel.classList.add('is-active')
    } else {
      descriptor.panel.style.zIndex = '6'
      descriptor.panel.classList.remove('is-active')
    }
  }
}

export function updateFloatingGraphCodePanelMeta(panelId) {
  if (!panelId) {
    for (const currentId of FLOATING_PANEL_IDS) updateFloatingGraphCodePanelMeta(currentId)
    return
  }

  const id = normalizeFloatingPanelId(panelId)
  const state = getFloatingPanelState(id)
  const descriptor = getFloatingPanelDescriptor(id)
  if (!state || !descriptor.panel) return

  if (descriptor.path) {
    descriptor.path.textContent = state.filePath || '—'
    descriptor.path.title = state.filePath || ''
  }
  if (descriptor.title) {
    descriptor.title.textContent = state.filePath ? `graph code • ${pathBasename(state.filePath)}` : 'graph code'
  }
  if (descriptor.line) {
    descriptor.line.textContent = Number.isFinite(Number(state.line)) ? `line ${Number(state.line)}` : 'line —'
  }
  if (descriptor.dirty) {
    descriptor.dirty.hidden = !state.dirty
  }
}

export function isFloatingGraphCodePanelDirty(panelId) {
  const state = getFloatingPanelState(panelId)
  if (!state || !state.open || !state.filePath) return false
  return state.dirty
}

export function getFloatingPanelByFilePath(filePath) {
  const normalized = canonicalizeFloatingPanelPath(filePath)
  if (!normalized) return ''
  for (const panelId of FLOATING_PANEL_IDS) {
    const state = getFloatingPanelState(panelId)
    if (state?.open && canonicalizeFloatingPanelPath(state.filePath) === normalized) return panelId
  }
  return ''
}

export function areEditorPathsEquivalent(leftPath, rightPath) {
  const left = normalizeRelativePath(leftPath)
  const right = normalizeRelativePath(rightPath)
  if (!left || !right) return false
  if (left === right) return true

  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (workspaceDir) {
    const stripWorkspace = (value) => (
      value === workspaceDir
        ? ''
        : (value.startsWith(`${workspaceDir}/`) ? value.slice(workspaceDir.length + 1) : value)
    )
    if (stripWorkspace(left) === stripWorkspace(right)) return true
  }

  const resolvedLeft = canonicalizeFloatingPanelPath(left)
  const resolvedRight = canonicalizeFloatingPanelPath(right)
  return Boolean(resolvedLeft && resolvedRight && resolvedLeft === resolvedRight)
}

export function syncEditorBuffersAfterFloatingSave(savedPath, content) {
  const normalizedSavedPath = normalizeRelativePath(savedPath)
  if (!normalizedSavedPath) return

  const normalizedContent = normalizeNewlines(String(content ?? ''))
  let updatedAnyPane = false

  for (const paneId of editorLayoutState.allPanes) {
    const paneState = getPaneState(paneId)
    const panePath = normalizeRelativePath(paneState?.path)
    if (!panePath || !areEditorPathsEquivalent(panePath, normalizedSavedPath)) continue

    const textarea = getPaneTextarea(paneId)
    if (textarea) textarea.value = normalizedContent
    paneState.loadedText = normalizedContent
    paneState.dirty = false
    renderScriptMirrorForPane(paneId, normalizedContent)
    syncScriptMirrorScrollForPane(paneId)
    updatedAnyPane = true
  }

  if (updatedAnyPane) {
    syncScriptBadgeState()
    renderPaneTitles()
    renderOpenFileTabs()
  }

  for (const [cachedPath] of dirtyEditsCache) {
    if (areEditorPathsEquivalent(cachedPath, normalizedSavedPath)) {
      dirtyEditsCache.delete(cachedPath)
    }
  }
}

export function syncFloatingPanelsFromEditorBuffer(filePath, content, options = {}) {
  const normalizedPath = normalizeRelativePath(filePath)
  if (!normalizedPath) return

  const markSaved = options.markSaved === true
  const skipIfDirty = options.skipIfDirty === true
  const normalizedContent = normalizeNewlines(String(content ?? ''))

  for (const panelId of FLOATING_PANEL_IDS) {
    const panelState = getFloatingPanelState(panelId)
    const descriptor = getFloatingPanelDescriptor(panelId)
    if (!panelState?.open || !panelState.filePath || !descriptor?.textarea) continue
    if (!areEditorPathsEquivalent(panelState.filePath, normalizedPath)) continue
    if (skipIfDirty && panelState.dirty) continue

    descriptor.textarea.value = normalizedContent
    if (markSaved) {
      panelState.loadedText = normalizedContent
      panelState.dirty = false
    } else {
      panelState.dirty = normalizedContent !== panelState.loadedText
    }

    renderScriptMirrorForPane(panelId, normalizedContent)
    syncScriptMirrorScrollForPane(panelId)
    updateFloatingGraphCodePanelMeta(panelId)
  }
}

export function getFirstAvailableFloatingPanelId() {
  for (const panelId of FLOATING_PANEL_IDS) {
    const state = getFloatingPanelState(panelId)
    if (!state?.open) return panelId
  }
  return ''
}

export function closeFloatingPanelChooser(selection = null) {
  if (nextVFloatingPanelChooser) nextVFloatingPanelChooser.hidden = true
  if (pendingFloatingPanelChoiceResolver) {
    pendingFloatingPanelChoiceResolver(selection)
    _setPendingFloatingPanelChoiceResolver(null)
  }
}

export function showFloatingPanelChooser(options = {}) {
  if (!nextVFloatingPanelChooser) return Promise.resolve(null)

  const targetPath = normalizeRelativePath(options.filePath)
  if (nextVFloatingPanelChooserTitle) {
    const basename = targetPath ? pathBasename(targetPath) : 'requested file'
    nextVFloatingPanelChooserTitle.textContent = `Open ${basename} in which panel?`
  }

  if (nextVFloatingPanelChooserDetails) {
    const details = FLOATING_PANEL_IDS.map((panelId) => {
      const state = getFloatingPanelState(panelId)
      const label = state?.filePath ? pathBasename(state.filePath) : 'empty'
      const dirty = state?.dirty ? ' • unsaved' : ''
      return `${panelId === 'FLOAT1' ? 'Panel 1' : 'Panel 2'}: ${label}${dirty}`
    })
    nextVFloatingPanelChooserDetails.textContent = details.join(' | ')
  }

  nextVFloatingPanelChooser.hidden = false
  return new Promise((resolve) => {
    _setPendingFloatingPanelChoiceResolver(resolve)
  })
}

export async function chooseFloatingPanelForOpen(options = {}) {
  const requestedPath = canonicalizeFloatingPanelPath(options.filePath)
  const existingPanelId = getFloatingPanelByFilePath(requestedPath)
  if (existingPanelId) {
    setFloatingPanelActive(existingPanelId)
    return existingPanelId
  }

  const availablePanelId = getFirstAvailableFloatingPanelId()
  if (availablePanelId) return availablePanelId

  const selectedPanelId = await showFloatingPanelChooser({ filePath: requestedPath })
  if (!selectedPanelId) return ''

  const selectedState = getFloatingPanelState(selectedPanelId)
  if (selectedState?.dirty) {
    const discard = window.confirm(`Discard unsaved edits in ${selectedPanelId === 'FLOAT1' ? 'Panel 1' : 'Panel 2'}?`)
    if (!discard) return ''
  }

  return selectedPanelId
}

export async function saveFloatingGraphCodePanel(arg = {}) {
  const panelId = typeof arg === 'string' ? arg : arg.panelId
  const options = (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : {}
  const id = normalizeFloatingPanelId(panelId)
  const state = getFloatingPanelState(id)
  const descriptor = getFloatingPanelDescriptor(id)
  if (!state || !state.open || !state.filePath || !descriptor.textarea) return false

  const silent = options.silent === true
  const content = normalizeNewlines(descriptor.textarea.value ?? '')

  try {
    const { savedPath, bytes } = await saveEditorFileContent(state.filePath, content)
    state.filePath = canonicalizeFloatingPanelPath(savedPath)
    state.loadedText = content
    state.dirty = false
    updateFloatingGraphCodePanelMeta(id)
    syncEditorBuffersAfterFloatingSave(state.filePath, content)

    if (!silent) {
      appendScriptLogRow(`[file:save] path=${savedPath} bytes=${bytes}`, 'result')
      setStatus('floating panel saved')
    }

    if (nextVViewState.currentView === 'graph') {
      refreshNextVGraph({ silent: true, preserveViewport: true })
    }

    return true
  } catch (err) {
    if (!silent) {
      appendScriptLogRow(`[file:error] ${err.message}`, 'error')
      setStatus('floating panel save failed', 'responding')
    }
    return false
  }
}

export function closeFloatingGraphCodePanel(arg = {}) {
  const panelId = typeof arg === 'string' ? arg : arg.panelId
  const options = (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : {}
  const id = normalizeFloatingPanelId(panelId)
  const state = getFloatingPanelState(id)
  const descriptor = getFloatingPanelDescriptor(id)
  if (!state || !descriptor.panel) return false

  const force = options.force === true
  if (!force && isFloatingGraphCodePanelDirty(id)) {
    const discard = window.confirm('Discard unsaved floating panel edits?')
    if (!discard) return false
  }

  state.open = false
  state.filePath = ''
  state.line = null
  state.loadedText = ''
  state.dirty = false
  state.anchorNodeId = ''

  descriptor.panel.hidden = true
  descriptor.panel.style.left = ''
  descriptor.panel.style.top = ''
  descriptor.panel.style.right = ''
  if (descriptor.textarea) descriptor.textarea.value = ''
  renderScriptMirrorForPane(id, '')
  updateFloatingGraphCodePanelMeta(id)

  const fallbackPanelId = FLOATING_PANEL_IDS.find((currentId) => getFloatingPanelState(currentId)?.open)
  if (fallbackPanelId) setFloatingPanelActive(fallbackPanelId)
  return true
}

export async function openFloatingGraphCodePanel(options = {}) {
  const requestedPath = resolveNextVPath(normalizeGraphSourcePathForEditor(options.filePath))
  if (!requestedPath) return
  const canonicalRequestedPath = canonicalizeFloatingPanelPath(requestedPath)

  const requestedPanelId = options.panelId ? normalizeFloatingPanelId(options.panelId) : ''
  const panelId = requestedPanelId || await chooseFloatingPanelForOpen({ filePath: requestedPath })
  if (!panelId) return

  const state = getFloatingPanelState(panelId)
  const descriptor = getFloatingPanelDescriptor(panelId)
  if (!state || !descriptor.panel || !descriptor.textarea) return

  if (state.open && state.filePath && canonicalizeFloatingPanelPath(state.filePath) === canonicalRequestedPath) {
    state.line = Number.isFinite(Number(options.line)) ? Number(options.line) : state.line
    setFloatingPanelActive(panelId)
    if (state.line && state.line > 1) {
      const text = normalizeNewlines(descriptor.textarea.value)
      const lines = text.split('\n')
      const target = Math.max(1, Math.min(lines.length, state.line))
      let offset = 0
      for (let i = 0; i < target - 1; i++) offset += lines[i].length + 1
      descriptor.textarea.setSelectionRange(offset, offset)
    }
    descriptor.textarea.focus()
    updateFloatingGraphCodePanelMeta(panelId)
    return
  }

  if (state.open && state.filePath && canonicalizeFloatingPanelPath(state.filePath) !== canonicalRequestedPath && isFloatingGraphCodePanelDirty(panelId)) {
    const discard = window.confirm('Discard unsaved floating panel edits?')
    if (!discard) return
  }

  const data = await loadEditorFileContent(requestedPath, { kind: 'editor' })
  const normalizedPath = canonicalizeFloatingPanelPath(data.filePath ?? requestedPath)
  const text = normalizeNewlines(String(data.content ?? ''))

  state.open = true
  state.filePath = normalizedPath
  state.line = Number.isFinite(Number(options.line)) ? Number(options.line) : null
  state.loadedText = text
  state.dirty = false
  state.anchorNodeId = String(options.nodeId ?? '')

  descriptor.panel.hidden = false
  descriptor.textarea.value = text

  renderScriptMirrorForPane(panelId, text)
  syncScriptMirrorScrollForPane(panelId)
  updateFloatingGraphCodePanelMeta(panelId)
  setFloatingPanelActive(panelId)

  if (state.line && state.line > 1) {
    const lines = text.split('\n')
    const target = Math.max(1, Math.min(lines.length, state.line))
    let offset = 0
    for (let i = 0; i < target - 1; i++) offset += lines[i].length + 1
    descriptor.textarea.setSelectionRange(offset, offset)
  }
  descriptor.textarea.focus()
}

export function bindFloatingGraphCodePanelEvents() {
  const bindDragForPanel = (panelId) => {
    const descriptor = getFloatingPanelDescriptor(panelId)
    if (!descriptor.panel) return

    const header = descriptor.panel.querySelector('.nextv-floating-code-header')
    if (!header || header.dataset.dragBound === '1') return
    header.dataset.dragBound = '1'

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return
      const shell = descriptor.panel.parentElement
      setFloatingPanelActive(panelId)
      const startX = e.clientX - descriptor.panel.offsetLeft
      const startY = e.clientY - descriptor.panel.offsetTop
      descriptor.panel.classList.add('is-dragging')

      const onMove = (ev) => {
        const maxL = shell.offsetWidth - descriptor.panel.offsetWidth
        const maxT = shell.offsetHeight - descriptor.panel.offsetHeight
        descriptor.panel.style.left = Math.max(0, Math.min(ev.clientX - startX, maxL)) + 'px'
        descriptor.panel.style.top = Math.max(0, Math.min(ev.clientY - startY, maxT)) + 'px'
        descriptor.panel.style.right = 'auto'
      }
      const onUp = () => {
        descriptor.panel.classList.remove('is-dragging')
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  for (const panelId of FLOATING_PANEL_IDS) {
    const descriptor = getFloatingPanelDescriptor(panelId)
    const textarea = descriptor.textarea
    if (!textarea || textarea.dataset.paneBound === '1') continue
    textarea.dataset.paneBound = '1'

    bindDragForPanel(panelId)

    descriptor.panel?.addEventListener('mousedown', () => {
      setFloatingPanelActive(panelId)
    })

    bindTextareaFileRefCursor(textarea, () => textarea.value)

    textarea.addEventListener('input', () => {
      const state = getFloatingPanelState(panelId)
      const text = normalizeNewlines(textarea.value)
      state.dirty = state.open && text !== state.loadedText
      renderScriptMirrorForPane(panelId, text)
      updateFloatingGraphCodePanelMeta(panelId)
    })

    textarea.addEventListener('scroll', () => {
      syncScriptMirrorScrollForPane(panelId)
    })

    textarea.addEventListener('keydown', async (event) => {
      const isSave = (event.ctrlKey || event.metaKey) && !event.altKey && String(event.key ?? '').toLowerCase() === 's'
      if (isSave) {
        event.preventDefault()
        try {
          await saveFloatingGraphCodePanel({ panelId })
        } catch (err) {
          appendScriptLogRow(`[file:error] ${err.message}`, 'error')
          setStatus('floating panel save failed', 'responding')
        }
        return
      }

      const isCommentToggle = (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === '/' || event.code === 'Slash')
      if (isCommentToggle) {
        event.preventDefault()
        toggleCommentInTextarea(textarea)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        const indentWidth = getCurrentNextVEditorTabSize()
        const indentSpaces = ' '.repeat(indentWidth)
        const value = textarea.value
        const start = Number(textarea.selectionStart)
        const end = Number(textarea.selectionEnd)
        const hasSelection = start !== end

        if (!hasSelection && !event.shiftKey) {
          textarea.value = `${value.slice(0, start)}\t${value.slice(end)}`
          textarea.setSelectionRange(start + 1, start + 1)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }

        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
        const lineEndMatch = value.indexOf('\n', hasSelection ? end : start)
        const lineEnd = lineEndMatch === -1 ? value.length : lineEndMatch
        const block = value.slice(lineStart, lineEnd)
        const lines = block.split('\n')
        let removedBeforeCaret = 0
        const transformedLines = event.shiftKey
          ? lines.map((line, index) => {
              if (line.startsWith('\t')) {
                if (index === 0 && start > lineStart) removedBeforeCaret = 1
                return line.slice(1)
              }
              if (line.startsWith(indentSpaces)) {
                if (index === 0 && start > lineStart) removedBeforeCaret = Math.min(indentWidth, start - lineStart)
                return line.slice(indentWidth)
              }
              return line
            })
          : lines.map((line) => `\t${line}`)
        const transformedBlock = transformedLines.join('\n')
        textarea.value = `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`
        if (hasSelection) {
          textarea.setSelectionRange(lineStart, lineStart + transformedBlock.length)
        } else if (event.shiftKey) {
          textarea.setSelectionRange(Math.max(lineStart, start - removedBeforeCaret), Math.max(lineStart, start - removedBeforeCaret))
        } else {
          textarea.setSelectionRange(start + 1, start + 1)
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closeFloatingGraphCodePanel({ panelId })
      }
    })

    textarea.addEventListener('click', async () => {
      if (textarea.selectionStart !== textarea.selectionEnd) return

      const text = normalizeNewlines(textarea.value)
      const primaryOffset = Number(textarea.selectionStart)
      const candidateOffsets = [primaryOffset, Math.max(0, primaryOffset - 1)]

      for (const offset of candidateOffsets) {
        const ref = findScriptReferenceAtOffset(text, offset)
        if (!ref) continue

        const state = getFloatingPanelState(panelId)
        const currentDir = pathDirname(state.filePath)
        const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
        const targetPath = String(ref.filePath ?? '').trim()
        const resolvedPath = (
          targetPath.startsWith('workspaces/')
          || (workspaceDir && (targetPath === workspaceDir || targetPath.startsWith(`${workspaceDir}/`)))
        )
          ? normalizePathSegments(targetPath)
          : joinRelativePath(currentDir || workspaceDir, targetPath)

        try {
          await openFloatingGraphCodePanel({ filePath: resolvedPath })
        } catch (err) {
          appendScriptLogRow(`[file:error] ${err.message}`, 'error')
          setStatus('file open error', 'responding')
        }
        return
      }
    })
  }

  if (nextVFloatingPanelChooser && nextVFloatingPanelChooser.dataset.bound !== '1') {
    nextVFloatingPanelChooser.dataset.bound = '1'

    nextVFloatingPanelChooserPanel1Btn?.addEventListener('click', () => closeFloatingPanelChooser('FLOAT1'))
    nextVFloatingPanelChooserPanel2Btn?.addEventListener('click', () => closeFloatingPanelChooser('FLOAT2'))
    nextVFloatingPanelChooserCancelBtn?.addEventListener('click', () => closeFloatingPanelChooser(null))
    nextVFloatingPanelChooser.addEventListener('click', (event) => {
      if (event.target === nextVFloatingPanelChooser) closeFloatingPanelChooser(null)
    })
  }
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  nextVGraphState,
  nextVGraphMappingApi,
  nextVGraphOutput
} from './state.js'
import {
  clearNextVGraphOutput
} from './03_ui_controls.js'

export function getNextVGraphViewport() {
  return document.getElementById('nextv-graph-viewport')
}

export function getNextVGraphSvg() {
  return document.querySelector('#nextv-graph-viewport .nextv-graph-svg')
}

export function getNextVGraphCanvas() {
  return document.querySelector('#nextv-graph-viewport .nextv-graph-canvas')
}

export function getNextVGraphPadding(width, height) {
  return Math.max(220, Math.round(Math.max(width, height) * 0.7))
}

export function getNextVGraphBaseMetrics() {
  const svg = getNextVGraphSvg()
  if (!svg) {
    return { width: 0, height: 0, padding: 0 }
  }

  return {
    width: Number(svg.dataset.baseWidth ?? 0),
    height: Number(svg.dataset.baseHeight ?? 0),
    padding: Number(svg.dataset.padding ?? 0),
  }
}

export function getNextVGraphZoomProfile(zoom) {
  const normalizedZoom = clampNextVGraphZoom(zoom)
  const zoomOutProgress = Math.max(0, Math.min(1, (1 - normalizedZoom) / 0.75))
  return {
    density: 1 - (0.18 * zoomOutProgress),
    nodeScale: 1 + (0.22 * zoomOutProgress),
    paddingScale: 1 - (0.32 * zoomOutProgress),
  }
}

export function getNextVGraphRenderScale(zoom) {
  const normalizedZoom = clampNextVGraphZoom(zoom)
  const profile = getNextVGraphZoomProfile(normalizedZoom)
  return normalizedZoom * profile.density
}

export function getNextVGraphScaledPadding(zoom, viewport = getNextVGraphViewport()) {
  const { padding } = getNextVGraphBaseMetrics()
  const normalizedZoom = clampNextVGraphZoom(zoom)
  const profile = getNextVGraphZoomProfile(normalizedZoom)
  const renderScale = normalizedZoom * profile.density
  const scaledPadding = padding * renderScale
  if (!viewport) {
    return { x: scaledPadding, y: scaledPadding }
  }

  const minHorizontalPadding = Math.max(
    170,
    viewport.clientWidth * (0.8 * profile.paddingScale),
  )
  const minVerticalPadding = Math.max(
    120,
    viewport.clientHeight * (0.5 * profile.paddingScale),
  )
  return {
    x: Math.max(scaledPadding, minHorizontalPadding),
    y: Math.max(scaledPadding, minVerticalPadding),
  }
}

export function clampNextVGraphZoom(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(0.25, Math.min(4, numeric))
}

export function getNextVGraphWheelZoomStep() {
  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  if (zoom < 0.75) return 0.05
  if (zoom > 2) return 0.2

  const progress = (zoom - 0.75) / (2 - 0.75)
  return 0.05 + (0.15 * progress)
}

export function applyNextVGraphZoom() {
  const canvas = getNextVGraphCanvas()
  const svg = getNextVGraphSvg()
  const viewport = getNextVGraphViewport()
  const zoomLabel = document.getElementById('nextv-graph-zoom-label')
  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const profile = getNextVGraphZoomProfile(zoom)
  const renderScale = zoom * profile.density
  nextVGraphState.zoom = zoom

  if (canvas && svg) {
    const { width: baseWidth, height: baseHeight } = getNextVGraphBaseMetrics()
    const scaledWidth = baseWidth * renderScale
    const scaledHeight = baseHeight * renderScale
    const scaledPadding = getNextVGraphScaledPadding(zoom, viewport)
    const zoomOutProgress = Math.max(0, Math.min(1, (1 - zoom) / 0.75))
    canvas.style.width = `${scaledWidth + (scaledPadding.x * 2)}px`
    canvas.style.height = `${scaledHeight + (scaledPadding.y * 2)}px`
    canvas.style.padding = `${scaledPadding.y}px ${scaledPadding.x}px`
    canvas.style.setProperty('--nextv-graph-node-scale', String(profile.nodeScale))
    canvas.style.setProperty('--nextv-graph-edge-attenuation', String(1 - (0.45 * zoomOutProgress)))
    svg.style.width = `${scaledWidth}px`
    svg.style.height = `${scaledHeight}px`
  }
  positionNextVGraphPopover()
  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`
  }
}

export function positionNextVGraphPopover() {
  const popover = nextVGraphState.detailPopoverEl
  const canvas = nextVGraphState.canvasEl ?? getNextVGraphCanvas()
  const selectedNodeId = String(nextVGraphState.selectedNodeId ?? '').trim()
  if (!popover || !canvas || !selectedNodeId) return

  const pos = nextVGraphState.layoutPositions.get(selectedNodeId)
  if (!pos) return

  const viewport = getNextVGraphViewport()
  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const renderScale = getNextVGraphRenderScale(zoom)
  const scaledPadding = getNextVGraphScaledPadding(zoom, viewport)
  const nodeX = scaledPadding.x + (pos.x * renderScale)
  const nodeY = scaledPadding.y + (pos.y * renderScale)
  const margin = 14
  const gap = 28

  popover.style.visibility = 'hidden'
  popover.style.left = '0px'
  popover.style.top = '0px'

  const popoverWidth = popover.offsetWidth || 280
  const popoverHeight = popover.offsetHeight || 160
  const canvasWidth = canvas.clientWidth || 0
  const canvasHeight = canvas.clientHeight || 0
  const leftSpace = nodeX - margin
  const rightSpace = canvasWidth - nodeX - margin
  const topSpace = nodeY - margin
  const bottomSpace = canvasHeight - nodeY - margin
  const clampLeft = (value) => Math.max(margin, Math.min(value, Math.max(margin, canvasWidth - popoverWidth - margin)))
  const clampTop = (value) => Math.max(margin, Math.min(value, Math.max(margin, canvasHeight - popoverHeight - margin)))

  const sideAnchorOffset = Math.min(56, Math.max(34, Math.round(popoverHeight * 0.33)))
  const verticalCenterOffset = Math.round(popoverWidth * 0.5)

  const candidates = [
    {
      side: 'right',
      space: rightSpace,
      left: nodeX + gap,
      top: clampTop(nodeY - sideAnchorOffset),
      preference: 0,
    },
    {
      side: 'left',
      space: leftSpace,
      left: nodeX - popoverWidth - gap,
      top: clampTop(nodeY - sideAnchorOffset),
      preference: 1,
    },
    {
      side: 'bottom',
      space: bottomSpace,
      left: clampLeft(nodeX - verticalCenterOffset),
      top: nodeY + gap,
      preference: 2,
    },
    {
      side: 'top',
      space: topSpace,
      left: clampLeft(nodeX - verticalCenterOffset),
      top: nodeY - popoverHeight - gap,
      preference: 3,
    },
  ].map((candidate, index) => {
    const overflowLeft = Math.max(0, margin - candidate.left)
    const overflowRight = Math.max(0, (candidate.left + popoverWidth + margin) - canvasWidth)
    const overflowTop = Math.max(0, margin - candidate.top)
    const overflowBottom = Math.max(0, (candidate.top + popoverHeight + margin) - canvasHeight)
    return {
      ...candidate,
      index,
      overflow: overflowLeft + overflowRight + overflowTop + overflowBottom,
    }
  })

  candidates.sort((leftCandidate, rightCandidate) => {
    if (leftCandidate.overflow !== rightCandidate.overflow) {
      return leftCandidate.overflow - rightCandidate.overflow
    }
    if (leftCandidate.preference !== rightCandidate.preference) {
      return leftCandidate.preference - rightCandidate.preference
    }
    if (leftCandidate.space !== rightCandidate.space) {
      return rightCandidate.space - leftCandidate.space
    }
    return leftCandidate.index - rightCandidate.index
  })

  const bestCandidate = candidates[0]
  const left = clampLeft(bestCandidate.left)
  const top = clampTop(bestCandidate.top)
  const pointerSide = bestCandidate.side
  const pointerOffsetTop = Math.max(20, Math.min(Math.round(nodeY - top), Math.max(20, popoverHeight - 20)))
  const pointerOffsetLeft = Math.max(20, Math.min(Math.round(nodeX - left), Math.max(20, popoverWidth - 20)))

  popover.style.left = `${Math.round(left)}px`
  popover.style.top = `${Math.round(top)}px`
  popover.dataset.pointerSide = pointerSide
  popover.style.setProperty('--nextv-popover-pointer-top', `${pointerOffsetTop}px`)
  popover.style.setProperty('--nextv-popover-pointer-left', `${pointerOffsetLeft}px`)
  popover.style.visibility = 'visible'
}

export function centerNextVGraphViewport() {
  const viewport = getNextVGraphViewport()
  const canvas = getNextVGraphCanvas()
  if (!viewport || !canvas) return

  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const scaledPadding = getNextVGraphScaledPadding(zoom, viewport)
  viewport.scrollLeft = Math.max(0, (canvas.scrollWidth - viewport.clientWidth) / 2)
  const graphIsTallerThanViewport = canvas.scrollHeight > viewport.clientHeight
  viewport.scrollTop = graphIsTallerThanViewport
    ? Math.max(0, scaledPadding.y)
    : Math.max(0, (canvas.scrollHeight - viewport.clientHeight) / 2)
}

export function captureNextVGraphViewportState(viewport = getNextVGraphViewport()) {
  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const renderScale = getNextVGraphRenderScale(zoom)
  if (!Number.isFinite(renderScale) || renderScale <= 0) return null
  if (!viewport || viewport.clientWidth < 2 || viewport.clientHeight < 2) {
    return { zoom }
  }
  const { width: baseWidth, height: baseHeight } = getNextVGraphBaseMetrics()

  const scaledPadding = getNextVGraphScaledPadding(zoom, viewport)
  const centerX = viewport.clientWidth / 2
  const centerY = viewport.clientHeight / 2
  const graphCenterX = (viewport.scrollLeft + centerX - scaledPadding.x) / renderScale
  const graphCenterY = (viewport.scrollTop + centerY - scaledPadding.y) / renderScale
  const graphCenterRatioX = baseWidth > 0 ? (graphCenterX / baseWidth) : 0.5
  const graphCenterRatioY = baseHeight > 0 ? (graphCenterY / baseHeight) : 0.5

  return {
    zoom,
    graphCenterX,
    graphCenterY,
    graphCenterRatioX,
    graphCenterRatioY,
  }
}

export function restoreNextVGraphViewportState(viewportState, viewport = getNextVGraphViewport()) {
  if (!viewport || !viewportState) return false
  if (viewport.clientWidth < 2 || viewport.clientHeight < 2) return false

  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const renderScale = getNextVGraphRenderScale(zoom)
  if (!Number.isFinite(renderScale) || renderScale <= 0) return false

  const { width: baseWidth, height: baseHeight } = getNextVGraphBaseMetrics()
  const ratioX = Number(viewportState.graphCenterRatioX)
  const ratioY = Number(viewportState.graphCenterRatioY)
  const absoluteX = Number(viewportState.graphCenterX)
  const absoluteY = Number(viewportState.graphCenterY)

  const preferredCenterX = Number.isFinite(ratioX) && baseWidth > 0
    ? (ratioX * baseWidth)
    : absoluteX
  const preferredCenterY = Number.isFinite(ratioY) && baseHeight > 0
    ? (ratioY * baseHeight)
    : absoluteY

  if (!Number.isFinite(preferredCenterX) || !Number.isFinite(preferredCenterY)) {
    return false
  }

  const graphCenterX = baseWidth > 0
    ? Math.max(0, Math.min(baseWidth, preferredCenterX))
    : Math.max(0, preferredCenterX)
  const graphCenterY = baseHeight > 0
    ? Math.max(0, Math.min(baseHeight, preferredCenterY))
    : Math.max(0, preferredCenterY)

  const scaledPadding = getNextVGraphScaledPadding(zoom, viewport)
  const centerX = viewport.clientWidth / 2
  const centerY = viewport.clientHeight / 2
  const nextScrollLeft = (graphCenterX * renderScale) + scaledPadding.x - centerX
  const nextScrollTop = (graphCenterY * renderScale) + scaledPadding.y - centerY

  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  viewport.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft))
  viewport.scrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop))
  return true
}

export function scheduleNextVGraphViewportRestore(viewportState, attemptsRemaining = 10) {
  if (restoreNextVGraphViewportState(viewportState)) {
    positionNextVGraphPopover()
    return
  }

  if (attemptsRemaining <= 0) {
    positionNextVGraphPopover()
    return
  }

  window.requestAnimationFrame(() => {
    scheduleNextVGraphViewportRestore(viewportState, attemptsRemaining - 1)
  })
}

export function setNextVGraphZoom(value, options = {}) {
  const { anchorClientX = null, anchorClientY = null } = options
  const viewport = getNextVGraphViewport()
  const previousZoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const nextZoom = clampNextVGraphZoom(value)
  const previousRenderScale = getNextVGraphRenderScale(previousZoom)
  const nextRenderScale = getNextVGraphRenderScale(nextZoom)
  const previousPadding = getNextVGraphScaledPadding(previousZoom, viewport)
  const nextPadding = getNextVGraphScaledPadding(nextZoom, viewport)

  let nextScrollLeft = null
  let nextScrollTop = null
  if (
    viewport
    && Number.isFinite(anchorClientX)
    && Number.isFinite(anchorClientY)
    && previousRenderScale > 0
  ) {
    const rect = viewport.getBoundingClientRect()
    const pointerX = anchorClientX - rect.left
    const pointerY = anchorClientY - rect.top
    const graphX = (viewport.scrollLeft + pointerX - previousPadding.x) / previousRenderScale
    const graphY = (viewport.scrollTop + pointerY - previousPadding.y) / previousRenderScale
    nextScrollLeft = (graphX * nextRenderScale) + nextPadding.x - pointerX
    nextScrollTop = (graphY * nextRenderScale) + nextPadding.y - pointerY
  }

  nextVGraphState.zoom = nextZoom
  applyNextVGraphZoom()

  if (viewport && nextScrollLeft !== null && nextScrollTop !== null) {
    viewport.scrollLeft = Math.max(0, nextScrollLeft)
    viewport.scrollTop = Math.max(0, nextScrollTop)
  }
}

export function zoomNextVGraph(delta, options = {}) {
  setNextVGraphZoom(nextVGraphState.zoom + delta, options)
}

export function resetNextVGraphZoom() {
  setNextVGraphZoom(1)
}

export function getNextVGraphFitZoom() {
  const viewport = getNextVGraphViewport()
  const { width: baseWidth, height: baseHeight } = getNextVGraphBaseMetrics()
  if (!viewport || baseWidth <= 0 || baseHeight <= 0) return 1

  const usableWidth = Math.max(120, viewport.clientWidth - 28)
  const usableHeight = Math.max(120, viewport.clientHeight - 28)
  const fitByWidth = usableWidth / baseWidth
  const fitByHeight = usableHeight / baseHeight
  const fitZoom = Math.min(fitByWidth, fitByHeight)

  // Avoid zooming in on load; only zoom out enough to fit.
  return clampNextVGraphZoom(Math.min(1, fitZoom))
}

export function renderNextVGraphMessage(message, cls = '') {
  if (!nextVGraphOutput) return
  clearNextVGraphOutput()
  const row = document.createElement('div')
  row.className = `graph-empty${cls ? ` ${cls}` : ''}`
  row.textContent = String(message ?? '')
  nextVGraphOutput.appendChild(row)
}

export function getTransitionClassName(classification) {
  const value = String(classification ?? '').trim().toLowerCase()
  if (value === 'pure' || value === 'llm' || value === 'side_effect' || value === 'declared_output' || value === 'mixed') {
    return value
  }
  return 'unknown'
}

function formatInlineAgentElapsedMs(value) {
  const elapsedMs = Math.max(0, Number(value) || 0)
  if (elapsedMs >= 10000) return `${(elapsedMs / 1000).toFixed(1)}s`
  if (elapsedMs >= 1000) return `${(elapsedMs / 1000).toFixed(2)}s`
  return `${Math.round(elapsedMs)}ms`
}

export function getControlProvenanceClass(value) {
  if (typeof nextVGraphMappingApi?.getControlProvenanceClass === 'function') {
    return nextVGraphMappingApi.getControlProvenanceClass(value)
  }

  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'bounded') return 'bounded'
  if (normalized === 'unbounded') return 'unbounded'
  if (normalized === 'operational') return 'operational'
  if (normalized === 'mixed') return 'mixed'
  return 'unknown'
}

export function buildNextVControlGraphArtifacts(controlEdges) {
  if (typeof nextVGraphMappingApi?.buildControlGraphArtifacts === 'function') {
    return nextVGraphMappingApi.buildControlGraphArtifacts(controlEdges)
  }

  const controlNodeById = new Map()
  const controlGraphEdges = []
  for (const rawEdge of controlEdges) {
    const from = String(rawEdge?.from ?? '').trim()
    const to = String(rawEdge?.to ?? '').trim()
    if (!from || !to) continue

    if (!controlNodeById.has(to)) {
      controlNodeById.set(to, {
        id: to,
        kind: 'control_branch',
        eventType: String(rawEdge?.eventType ?? '').trim(),
        branch: String(rawEdge?.branch ?? '').trim(),
        provenance: getControlProvenanceClass(rawEdge?.provenance),
        sourcePath: String(rawEdge?.sourcePath ?? '').trim(),
        sourceLine: Number.isFinite(Number(rawEdge?.sourceLine)) ? Number(rawEdge.sourceLine) : null,
        statement: String(rawEdge?.statement ?? '').trim(),
      })
    }

    controlGraphEdges.push({
      from,
      to,
      type: 'control',
      branch: String(rawEdge?.branch ?? '').trim(),
      eventType: String(rawEdge?.eventType ?? '').trim(),
      provenance: getControlProvenanceClass(rawEdge?.provenance),
      boundedControl: rawEdge?.boundedControl === true,
      operationalControl: rawEdge?.operationalControl === true,
      line: Number.isFinite(Number(rawEdge?.line)) ? Number(rawEdge.line) : null,
      statement: String(rawEdge?.statement ?? '').trim(),
    })
  }

  return {
    controlNodes: Array.from(controlNodeById.values()),
    controlGraphEdges,
  }
}

export function formatTransitionClassification(classification) {
  const value = getTransitionClassName(classification)
  if (value === 'side_effect') return 'tool effect'
  if (value === 'declared_output') return 'output'
  if (value === 'llm') return 'llm'
  if (value === 'mixed') return 'mixed'
  if (value === 'pure') return 'pure'
  return 'unknown'
}

export function getNextVGraphHandlerLabel(nodeObj, transition) {
  return getNextVGraphHandlerLabelLines(nodeObj, transition).join('\n')
}

export function getNextVGraphHandlerLabelLines(nodeObj, transition, options = {}) {
  const eventLabel = String(nodeObj?.eventType ?? nodeObj?.id ?? '').trim()
  const agents = Array.isArray(transition?.agents)
    ? transition.agents.map((name) => String(name ?? '').trim()).filter(Boolean)
    : []
  const tools = Array.isArray(transition?.tools)
    ? transition.tools.map((tool) => String(tool?.name ?? '').trim()).filter(Boolean)
    : []
  const outputs = Array.isArray(transition?.outputs)
    ? transition.outputs.map((out) => String(out ?? '').trim()).filter(Boolean)
    : []
  const timerSlots = Array.isArray(options?.timerSlots) ? options.timerSlots : []

  const isParallel = transition?.hasParallelAgents === true
  const parallelPrefix = isParallel ? '‖ ' : ''

  const callOrder = Array.isArray(transition?.callOrder) ? transition.callOrder : null
  const toolFirstInSource = callOrder !== null && callOrder.length > 0 &&
    callOrder.findIndex((entry) => entry.kind === 'tool') < callOrder.findIndex((entry) => entry.kind === 'agent')

  const agentLines = agents.map((name, index) => {
    const slot = timerSlots[index]
    const elapsedMs = Math.max(0, Number(slot?.elapsedMs) || 0)
    const timerSuffix = (slot?.active === true || elapsedMs > 0)
      ? `  ${formatInlineAgentElapsedMs(elapsedMs)}`
      : ''
    const displayName = name.startsWith('model:') ? name : `agent:${name}`
    return `${parallelPrefix}${displayName}${timerSuffix}`
  })
  const toolLines = tools.length === 1
    ? [`tool:${tools[0]}`]
    : tools.length > 1
      ? [`tools:${tools.length}`]
      : []

  const lines = []
  if (agentLines.length > 0 && toolLines.length > 0) {
    if (toolFirstInSource) {
      lines.push(...toolLines)
      lines.push(...agentLines)
    } else {
      lines.push(...agentLines)
      lines.push(...toolLines)
    }
  } else if (agentLines.length > 0) {
    lines.push(...agentLines)
  } else if (toolLines.length > 0) {
    lines.push(...toolLines)
  }

  if (lines.length === 0) {
    if (outputs.length === 1) return [`output:${outputs[0]}`]
    if (outputs.length > 1) return [`outputs:${outputs.length}`]

    const classification = getTransitionClassName(transition?.classification)
    if (classification === 'pure') return ['logic']
    if (classification === 'side_effect') return ['tool']
    if (classification === 'declared_output') return ['output']
    if (classification === 'mixed') return ['mixed']

    return [eventLabel]
  }

  return lines
}

export function splitNextVGraphHandlerLabelLines(label, options = {}) {
  const maxLineLength = Number.isFinite(Number(options.maxLineLength))
    ? Math.max(8, Number(options.maxLineLength))
    : 20
  const maxLines = Number.isFinite(Number(options.maxLines))
    ? Math.max(1, Number(options.maxLines))
    : 3

  const raw = String(label ?? '').trim()
  if (!raw) return ['']

  // Hard newlines (from parallel agent blocks) always force a line break.
  const hardLines = raw.split('\n').map((s) => s.trim()).filter(Boolean)

  const lines = []
  for (const hardLine of hardLines) {
    const segments = hardLine.includes('+')
      ? hardLine.split('+').map((part) => String(part ?? '').trim()).filter(Boolean)
      : [hardLine]
    let current = ''
    for (const segment of segments) {
      if (!current) {
        current = segment
        continue
      }
      const candidate = `${current}+${segment}`
      if (candidate.length <= maxLineLength) {
        current = candidate
      } else {
        lines.push(current)
        current = segment
      }
    }
    if (current) lines.push(current)
  }

  if (lines.length > maxLines) {
    const collapsed = lines.slice(0, maxLines - 1)
    const overflow = lines.slice(maxLines - 1).join('+')
    collapsed.push(overflow)
    return collapsed
  }
  return lines
}

export function getNextVGraphTransitionScore(transition) {
  if (!transition || typeof transition !== 'object') return -1
  const agents = Array.isArray(transition.agents) ? transition.agents.length : 0
  const tools = Array.isArray(transition.tools) ? transition.tools.length : 0
  const outputs = Array.isArray(transition.outputs) ? transition.outputs.length : 0
  const classification = getTransitionClassName(transition.classification)
  const classScore = classification === 'mixed'
    ? 5
    : classification === 'llm'
      ? 4
    : classification === 'side_effect'
      ? 3
      : classification === 'declared_output'
        ? 2
        : classification === 'pure'
          ? 1
          : 0

  // Prefer handlers with explicit agent metadata, then tools/outputs.
  return (agents * 1000) + (tools * 100) + (outputs * 10) + classScore
}

export function buildNextVGraphTransitionLookup(transitions) {
  const byEvent = new Map()
  for (const transition of transitions) {
    const eventType = String(transition?.eventType ?? '').trim()
    if (!eventType) continue
    const existing = byEvent.get(eventType)
    if (!existing || getNextVGraphTransitionScore(transition) > getNextVGraphTransitionScore(existing)) {
      byEvent.set(eventType, transition)
    }
  }
  return byEvent
}

export function appendTransitionChip(container, text, cls = '') {
  const chip = document.createElement('span')
  chip.className = `nextv-graph-chip${cls ? ` ${cls}` : ''}`
  chip.textContent = text
  container.appendChild(chip)
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  nextVGraphState,
  workspace
} from './state.js'
import {
  normalizeNextVGraphDirection
} from './03_ui_controls.js'
import {
  getNextVGraphViewport,
  getNextVGraphCanvas,
  getNextVGraphRenderScale,
  getNextVGraphScaledPadding,
  clampNextVGraphZoom,
  getNextVGraphHandlerLabelLines,
  splitNextVGraphHandlerLabelLines
} from './05_graph_viewport.js'

export function clearNextVGraphRuntimeTimers() {
  for (const timerId of nextVGraphState.runtimeTimers) {
    window.clearTimeout(timerId)
  }
  nextVGraphState.runtimeTimers.clear()
}

export function parseNextVGraphRuntimeEventTimestampMs(runtimeEvent) {
  const raw = String(runtimeEvent?.timestamp ?? '').trim()
  if (!raw) return Date.now()
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return Date.now()
  return parsed
}

export function formatNextVGraphAgentElapsedMs(value) {
  const elapsedMs = Math.max(0, Number(value) || 0)
  if (elapsedMs >= 10000) {
    return `${(elapsedMs / 1000).toFixed(1)}s`
  }
  if (elapsedMs >= 1000) {
    return `${(elapsedMs / 1000).toFixed(2)}s`
  }
  return `${Math.round(elapsedMs)}ms`
}

export function syncNextVGraphAgentTicker() {
  nextVGraphTimerApi.syncTicker(nextVGraphState, window, applyNextVGraphRuntimeVisuals)
}

export function extractExecutionAgentElapsedMs(result) {
  const agentCalls = Array.isArray(result?.agentCalls) ? result.agentCalls : []
  let maxElapsedMs = null
  for (const call of agentCalls) {
    const elapsedMs = Number(call?.metadata?.elapsedMs)
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) continue
    maxElapsedMs = maxElapsedMs == null ? elapsedMs : Math.max(maxElapsedMs, elapsedMs)
  }
  return maxElapsedMs
}

function getNextVGraphTransitionForHandlerNode(nodeId) {
  const normalizedNodeId = String(nodeId ?? '').trim()
  if (!normalizedNodeId.startsWith('handler:')) return null
  const eventType = normalizedNodeId.slice('handler:'.length)
  return (Array.isArray(nextVGraphState.transitions) ? nextVGraphState.transitions : []).find(
    (transition) => String(transition?.eventType ?? '').trim() === eventType,
  ) ?? null
}

function getNextVGraphAgentEntriesForHandlerNode(nodeId) {
  const transition = getNextVGraphTransitionForHandlerNode(nodeId)
  const entries = Array.isArray(transition?.agentEntries)
    ? transition.agentEntries.filter((entry) => entry && typeof entry === 'object')
    : []
  if (entries.length > 0) return entries

  const agents = Array.isArray(transition?.agents)
    ? transition.agents.map((name) => ({ name: String(name ?? '').trim(), line: null })).filter((entry) => entry.name)
    : []
  return agents
}

function ensureNextVGraphAgentTimerRecord(nodeId) {
  const entries = getNextVGraphAgentEntriesForHandlerNode(nodeId)
  const slotCount = Math.max(1, entries.length || 0)
  const existing = nextVGraphState.runtimeAgentCallTimersByNode.get(nodeId)
  const slots = Array.isArray(existing?.slots) ? existing.slots.slice(0, slotCount) : []
  while (slots.length < slotCount) {
    slots.push({ active: false, startMs: 0, elapsedMs: 0 })
  }
  const record = {
    slots,
    nextStartIndex: Number.isInteger(existing?.nextStartIndex) ? existing.nextStartIndex : 0,
  }
  nextVGraphState.runtimeAgentCallTimersByNode.set(nodeId, record)
  return record
}

function findNextVGraphAgentStartSlot(record) {
  const slots = Array.isArray(record?.slots) ? record.slots : []
  if (slots.length === 0) return 0

  const startIndex = Number.isInteger(record?.nextStartIndex) ? record.nextStartIndex : 0
  for (let offset = 0; offset < slots.length; offset += 1) {
    const idx = (startIndex + offset) % slots.length
    const slot = slots[idx]
    if (slot?.active !== true && Math.max(0, Number(slot?.elapsedMs) || 0) === 0) {
      return idx
    }
  }
  for (let offset = 0; offset < slots.length; offset += 1) {
    const idx = (startIndex + offset) % slots.length
    const slot = slots[idx]
    if (slot?.active !== true) return idx
  }
  return startIndex % slots.length
}

function findNextVGraphAgentFinishSlot(record) {
  const slots = Array.isArray(record?.slots) ? record.slots : []
  let bestIndex = -1
  let bestStartMs = Number.POSITIVE_INFINITY
  for (let idx = 0; idx < slots.length; idx += 1) {
    const slot = slots[idx]
    if (slot?.active !== true) continue
    const startMs = Number(slot?.startMs)
    const resolvedStart = Number.isFinite(startMs) ? startMs : 0
    if (resolvedStart < bestStartMs) {
      bestStartMs = resolvedStart
      bestIndex = idx
    }
  }
  return bestIndex >= 0 ? bestIndex : 0
}

export function reconcileNextVGraphAgentTimersFromExecution(nodeId, result) {
  const normalizedNodeId = String(nodeId ?? '').trim()
  if (!normalizedNodeId) return false

  const calls = Array.isArray(result?.agentCalls) ? result.agentCalls : []
  const entries = getNextVGraphAgentEntriesForHandlerNode(normalizedNodeId)
  if (calls.length === 0 || entries.length === 0) return false

  const indicesByLine = new Map()
  for (let idx = 0; idx < entries.length; idx += 1) {
    const line = Number(entries[idx]?.line)
    if (!Number.isFinite(line)) continue
    if (!indicesByLine.has(line)) indicesByLine.set(line, [])
    indicesByLine.get(line).push(idx)
  }

  const slots = Array.from({ length: Math.max(1, entries.length) }, () => ({ active: false, startMs: 0, elapsedMs: 0 }))
  let fallbackIndex = 0
  for (const call of calls) {
    const callLine = Number(call?.line)
    let slotIndex = -1
    if (Number.isFinite(callLine)) {
      const lineIndices = indicesByLine.get(callLine)
      if (Array.isArray(lineIndices) && lineIndices.length > 0) {
        slotIndex = lineIndices.shift()
      }
    }
    if (slotIndex < 0) {
      slotIndex = Math.min(fallbackIndex, slots.length - 1)
      fallbackIndex += 1
    }
    const elapsedMs = Math.max(0, Number(call?.metadata?.elapsedMs) || 0)
    slots[slotIndex] = { active: false, startMs: 0, elapsedMs }
  }

  nextVGraphState.runtimeAgentCallTimersByNode.set(normalizedNodeId, {
    slots,
    nextStartIndex: Math.min(calls.length, slots.length - 1),
  })
  return true
}

function resolveNextVGraphRuntimeHandlerNode(runtimeEvent) {
  const fallbackNode = String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
  const runtimeEventSourcePath = normalizeNextVGraphFilePath(runtimeEvent?.sourcePath)
  const runtimeEventSourceLineRaw = Number(runtimeEvent?.sourceLine)
  const runtimeEventSourceLine = Number.isFinite(runtimeEventSourceLineRaw) ? runtimeEventSourceLineRaw : null
  const runtimeEventSourcePathLower = runtimeEventSourcePath ? runtimeEventSourcePath.toLowerCase() : ''
  const runtimeEventSourcePathBase = runtimeEventSourcePathLower.includes('/')
    ? runtimeEventSourcePathLower.slice(runtimeEventSourcePathLower.lastIndexOf('/') + 1)
    : runtimeEventSourcePathLower

  const fallbackNodeObj = (Array.isArray(nextVGraphState.nodes) ? nextVGraphState.nodes : []).find(
    (nodeObj) => String(nodeObj?.id ?? '').trim() === fallbackNode,
  )
  const fallbackNodeSourcePath = normalizeNextVGraphFilePath(fallbackNodeObj?.sourcePath)
  const fallbackNodeSourcePathLower = fallbackNodeSourcePath ? fallbackNodeSourcePath.toLowerCase() : ''

  let bestMatchingNodeId = ''
  let bestMatchingNodeLine = Number.NEGATIVE_INFINITY
  let firstPathMatchNodeId = ''
  let firstCaseInsensitivePathMatchNodeId = ''
  let firstSuffixPathMatchNodeId = ''
  let bestSuffixNodeId = ''
  let bestSuffixNodeLine = Number.NEGATIVE_INFINITY
  let bestCaseInsensitiveNodeId = ''
  let bestCaseInsensitiveNodeLine = Number.NEGATIVE_INFINITY
  let bestLineOnlyNodeId = ''
  let bestLineOnlyNodeLine = Number.NEGATIVE_INFINITY

  for (const nodeObj of Array.isArray(nextVGraphState.nodes) ? nextVGraphState.nodes : []) {
    if (String(nodeObj?.kind ?? '').trim() !== 'handler') continue
    const nodeId = String(nodeObj?.id ?? '').trim()
    if (!nodeId) continue
    const nodeSourceLineRaw = Number(nodeObj?.sourceLine)
    const nodeSourceLine = Number.isFinite(nodeSourceLineRaw) ? nodeSourceLineRaw : null

    const nodeSourcePath = normalizeNextVGraphFilePath(nodeObj?.sourcePath)
    const nodeSourcePathLower = nodeSourcePath ? nodeSourcePath.toLowerCase() : ''

    // Last-resort fallback: only line-match within the currently active file context,
    // or when runtime events have no sourcePath at all.
    if (runtimeEventSourceLine != null && nodeSourceLine != null && nodeSourceLine <= runtimeEventSourceLine) {
      const allowLineOnlyFallback = !runtimeEventSourcePathLower
        || (fallbackNodeSourcePathLower && nodeSourcePathLower && nodeSourcePathLower === fallbackNodeSourcePathLower)
      if (allowLineOnlyFallback && nodeSourceLine >= bestLineOnlyNodeLine) {
        bestLineOnlyNodeLine = nodeSourceLine
        bestLineOnlyNodeId = nodeId
      }
    }

    if (!runtimeEventSourcePath || !nodeSourcePath) continue

    if (nodeSourcePath === runtimeEventSourcePath) {
      if (!firstPathMatchNodeId) {
        firstPathMatchNodeId = nodeId
      }

      if (runtimeEventSourceLine == null || nodeSourceLine == null) continue
      if (nodeSourceLine > runtimeEventSourceLine) continue
      if (nodeSourceLine < bestMatchingNodeLine) continue

      bestMatchingNodeLine = nodeSourceLine
      bestMatchingNodeId = nodeId
      continue
    }

    if (runtimeEventSourcePathLower && nodeSourcePath.toLowerCase() === runtimeEventSourcePathLower) {
      if (!firstCaseInsensitivePathMatchNodeId) {
        firstCaseInsensitivePathMatchNodeId = nodeId
      }
      if (runtimeEventSourceLine == null || nodeSourceLine == null) continue
      if (nodeSourceLine > runtimeEventSourceLine) continue
      if (nodeSourceLine < bestCaseInsensitiveNodeLine) continue

      bestCaseInsensitiveNodeLine = nodeSourceLine
      bestCaseInsensitiveNodeId = nodeId
      continue
    }

    // Handle relative-vs-absolute workspace path differences such as:
    // "music-select.nrv" vs "workspaces-local/music-agent/music-select.nrv".
    const nodeSourcePathBase = nodeSourcePathLower.includes('/')
      ? nodeSourcePathLower.slice(nodeSourcePathLower.lastIndexOf('/') + 1)
      : nodeSourcePathLower
    const isSuffixPathMatch = Boolean(
      runtimeEventSourcePathLower
      && nodeSourcePathLower
      && (
        runtimeEventSourcePathLower.endsWith(`/${nodeSourcePathLower}`)
        || nodeSourcePathLower.endsWith(`/${runtimeEventSourcePathLower}`)
        || (runtimeEventSourcePathBase && nodeSourcePathBase && runtimeEventSourcePathBase === nodeSourcePathBase)
      )
    )
    if (isSuffixPathMatch) {
      if (!firstSuffixPathMatchNodeId) {
        firstSuffixPathMatchNodeId = nodeId
      }
      if (runtimeEventSourceLine == null || nodeSourceLine == null) continue
      if (nodeSourceLine > runtimeEventSourceLine) continue
      if (nodeSourceLine < bestSuffixNodeLine) continue

      bestSuffixNodeLine = nodeSourceLine
      bestSuffixNodeId = nodeId
    }
  }

  return (
    bestMatchingNodeId
    || firstPathMatchNodeId
    || bestCaseInsensitiveNodeId
    || firstCaseInsensitivePathMatchNodeId
    || bestSuffixNodeId
    || firstSuffixPathMatchNodeId
    || bestLineOnlyNodeId
    || fallbackNode
  )
}

export function resolveNextVGraphHandlerNodeForSource(sourcePath, sourceLine, fallbackNode = '') {
  return resolveNextVGraphRuntimeHandlerNode({
    sourcePath,
    sourceLine,
    line: sourceLine,
  }) || String(fallbackNode ?? '').trim()
}

function findNextVGraphAgentStartSlotIndex(record, lineNumber) {
  const slots = Array.isArray(record?.slots) ? record.slots : []
  if (slots.length === 0) return 0

  const targetLine = Number(lineNumber)
  if (Number.isFinite(targetLine)) {
    for (let idx = 0; idx < slots.length; idx += 1) {
      const slotLine = Number(slots[idx]?.line)
      if (!Number.isFinite(slotLine) || slotLine !== targetLine) continue
      if (slots[idx]?.active === true) continue
      if (Math.max(0, Number(slots[idx]?.elapsedMs) || 0) === 0) {
        return idx
      }
    }
    for (let idx = 0; idx < slots.length; idx += 1) {
      const slotLine = Number(slots[idx]?.line)
      if (Number.isFinite(slotLine) && slotLine === targetLine && slots[idx]?.active !== true) {
        return idx
      }
    }
  }

  const startIndex = Number.isInteger(record?.nextStartIndex) ? record.nextStartIndex : 0
  for (let offset = 0; offset < slots.length; offset += 1) {
    const idx = (startIndex + offset) % slots.length
    const slot = slots[idx]
    if (slot?.active !== true && Math.max(0, Number(slot?.elapsedMs) || 0) === 0) {
      return idx
    }
  }

  for (let offset = 0; offset < slots.length; offset += 1) {
    const idx = (startIndex + offset) % slots.length
    if (slots[idx]?.active !== true) return idx
  }

  return startIndex % slots.length
}

function findNextVGraphAgentFinishSlotIndex(record, lineNumber) {
  const slots = Array.isArray(record?.slots) ? record.slots : []
  if (slots.length === 0) return 0

  const targetLine = Number(lineNumber)
  if (Number.isFinite(targetLine)) {
    let bestIndex = -1
    let bestStartMs = Number.POSITIVE_INFINITY
    for (let idx = 0; idx < slots.length; idx += 1) {
      const slot = slots[idx]
      const slotLine = Number(slot?.line)
      if (!Number.isFinite(slotLine) || slotLine !== targetLine) continue
      if (slot?.active !== true) continue
      const slotStartMs = Number(slot?.startMs)
      const resolvedStartMs = Number.isFinite(slotStartMs) ? slotStartMs : 0
      if (resolvedStartMs < bestStartMs) {
        bestStartMs = resolvedStartMs
        bestIndex = idx
      }
    }
    if (bestIndex >= 0) return bestIndex
  }

  const oldestActiveIndex = findNextVGraphAgentFinishSlot(record)
  if (Number.isInteger(oldestActiveIndex) && slots[oldestActiveIndex]?.active === true) {
    return oldestActiveIndex
  }

  for (let idx = 0; idx < slots.length; idx += 1) {
    if (slots[idx]?.active !== true) return idx
  }

  return 0
}

function startNextVGraphAgentTimer(runtimeEvent) {
  const currentNode = resolveNextVGraphRuntimeHandlerNode(runtimeEvent)
  const agentName = String(runtimeEvent?.agent ?? '').trim()
  if (!currentNode || !agentName) return false

  const timerRecord = ensureNextVGraphAgentTimerRecord(currentNode)
  const slotIndex = findNextVGraphAgentStartSlotIndex(timerRecord, runtimeEvent?.line ?? runtimeEvent?.sourceLine)
  timerRecord.slots[slotIndex] = {
    active: true,
    startMs: parseNextVGraphRuntimeEventTimestampMs(runtimeEvent),
    elapsedMs: 0,
    line: Number.isFinite(Number(runtimeEvent?.line))
      ? Number(runtimeEvent.line)
      : (Number.isFinite(Number(runtimeEvent?.sourceLine)) ? Number(runtimeEvent.sourceLine) : null),
  }
  timerRecord.nextStartIndex = Math.min(slotIndex + 1, timerRecord.slots.length - 1)
  nextVGraphState.runtimeAgentCallTimersByNode.set(currentNode, timerRecord)
  nextVGraphState.runtimeLastDispatchedNode = currentNode
  applyNextVGraphRuntimeVisuals()
  return true
}

function finishNextVGraphAgentTimer(runtimeEvent) {
  const currentNode = resolveNextVGraphRuntimeHandlerNode(runtimeEvent)
  const agentName = String(runtimeEvent?.agent ?? '').trim()
  if (!currentNode || !agentName) return false

  const timerRecord = ensureNextVGraphAgentTimerRecord(currentNode)
  const slotIndex = findNextVGraphAgentFinishSlotIndex(timerRecord, runtimeEvent?.line ?? runtimeEvent?.sourceLine)
  const currentSlot = timerRecord.slots[slotIndex] ?? null
  const elapsedMs = Number(runtimeEvent?.metadata?.elapsedMs)
  const startMs = Number(currentSlot?.startMs)
  timerRecord.slots[slotIndex] = {
    active: false,
    startMs: Number.isFinite(startMs) ? startMs : 0,
    elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0
      ? elapsedMs
      : Math.max(0, parseNextVGraphRuntimeEventTimestampMs(runtimeEvent) - (Number.isFinite(startMs) ? startMs : parseNextVGraphRuntimeEventTimestampMs(runtimeEvent))),
    line: Number.isFinite(Number(runtimeEvent?.line))
      ? Number(runtimeEvent.line)
      : (Number.isFinite(Number(runtimeEvent?.sourceLine)) ? Number(runtimeEvent.sourceLine) : (Number(currentSlot?.line) || null)),
  }
  timerRecord.nextStartIndex = Math.min(slotIndex + 1, timerRecord.slots.length - 1)
  nextVGraphState.runtimeAgentCallTimersByNode.set(currentNode, timerRecord)
  nextVGraphState.runtimeLastDispatchedNode = currentNode
  applyNextVGraphRuntimeVisuals()
  return true
}

export function finalizeNextVGraphActiveAgentTimers(options = {}) {
  return nextVGraphTimerApi.finalizeActive(
    nextVGraphState,
    options,
    Date.now,
    window,
    applyNextVGraphRuntimeVisuals,
  )
}

export function resetNextVGraphRuntimeState(options = {}) {
  const { keepExternalNodes = true, keepContractState = true } = options
  clearNextVGraphRuntimeTimers()
  nextVGraphState.runtimeStepByNode.clear()
  nextVGraphState.runtimeVisitedEdges.clear()
  nextVGraphState.runtimeActiveNodes.clear()
  nextVGraphState.runtimeActiveEdges.clear()
  nextVGraphState.runtimeTriggeredExternalNodes.clear()
  nextVGraphState.runtimeWarningNodes.clear()
  nextVGraphState.runtimeAgentCallTimersByNode.clear()
  nextVGraphState.runtimeLastDispatchedNode = ''
  nextVGraphState.runtimeSequence = 0
  syncNextVGraphAgentTicker()
  if (!keepExternalNodes) {
    nextVGraphState.runtimeExternalNodes.clear()
  }
  if (!keepContractState) {
    nextVGraphState.declaredExternalNodes.clear()
    nextVGraphState.contractWarningNodes.clear()
    nextVGraphState.contractWarnings = []
  }
}

export function beginNextVGraphExecutionTrail() {
  resetNextVGraphRuntimeState({ keepExternalNodes: true })
  applyNextVGraphRuntimeVisuals()
}

export function flashNextVGraphExternalEvent(eventType) {
  const nodeId = String(eventType ?? '').trim()
  if (!nodeId || !nextVGraphState.nodeElements.has(nodeId)) return

  nextVGraphState.runtimeTriggeredExternalNodes.add(nodeId)
  nextVGraphState.runtimeActiveNodes.add(nodeId)
  applyNextVGraphRuntimeVisuals()

  const timerId = window.setTimeout(() => {
    nextVGraphState.runtimeTimers.delete(timerId)
    nextVGraphState.runtimeTriggeredExternalNodes.delete(nodeId)
    nextVGraphState.runtimeActiveNodes.delete(nodeId)
    applyNextVGraphRuntimeVisuals()
  }, 650)

  nextVGraphState.runtimeTimers.add(timerId)
}

export function flashNextVGraphSignalDispatch(signalType, durationMs = 650) {
  const signal = String(signalType ?? '').trim()
  if (!signal) return

  const eventNodeExists = nextVGraphState.nodeElements.has(signal)
  const handlerId = `handler:${signal}`
  const handlerNodeExists = nextVGraphState.nodeElements.has(handlerId)
  if (!eventNodeExists && !handlerNodeExists) return

  if (eventNodeExists) {
    nextVGraphState.runtimeActiveNodes.add(signal)
  }
  if (handlerNodeExists) {
    nextVGraphState.runtimeActiveNodes.add(handlerId)
  }

  const subscriptionKey = getNextVGraphEdgeKey(signal, handlerId)
  if (subscriptionKey && nextVGraphState.edgeElements.has(subscriptionKey)) {
    nextVGraphState.runtimeActiveEdges.add(subscriptionKey)
  }

  applyNextVGraphRuntimeVisuals()

  const timerId = window.setTimeout(() => {
    nextVGraphState.runtimeTimers.delete(timerId)
    nextVGraphState.runtimeActiveNodes.delete(signal)
    nextVGraphState.runtimeActiveNodes.delete(handlerId)
    if (subscriptionKey) {
      nextVGraphState.runtimeActiveEdges.delete(subscriptionKey)
    }
    applyNextVGraphRuntimeVisuals()
  }, Math.max(120, Number(durationMs) || 650))

  nextVGraphState.runtimeTimers.add(timerId)
}

export function formatNextVGraphEventValue(value) {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed
  }

  try {
    const text = JSON.stringify(value)
    if (!text) return String(value)
    return text.length > 96 ? `${text.slice(0, 93)}...` : text
  } catch {
    const fallback = String(value)
    return fallback.length > 96 ? `${fallback.slice(0, 93)}...` : fallback
  }
}

export function flashNextVGraphEventValue(eventType, value, options = {}) {
  const formatted = formatNextVGraphEventValue(value)
  if (!formatted) return

  const rawType = String(eventType ?? '').trim()
  if (!rawType) return

  const preferredNodeId = String(options.nodeId ?? '').trim()
  const fallbackHandlerId = `handler:${rawType}`
  const nodeId = preferredNodeId
    || (nextVGraphState.layoutPositions.has(rawType) ? rawType : fallbackHandlerId)
  const nodePos = nextVGraphState.layoutPositions.get(nodeId)
  if (!nodePos) return

  const canvas = nextVGraphState.canvasEl ?? getNextVGraphCanvas()
  if (!canvas) return

  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const renderScale = getNextVGraphRenderScale(zoom)
  const scaledPadding = getNextVGraphScaledPadding(zoom, getNextVGraphViewport())
  const nodeX = scaledPadding.x + (nodePos.x * renderScale)
  const nodeY = scaledPadding.y + (nodePos.y * renderScale)

  const badge = document.createElement('div')
  badge.className = 'nextv-graph-emit-value-flash'
  badge.textContent = formatted
  badge.style.left = `${Math.round(nodeX + 14)}px`
  badge.style.top = `${Math.round(nodeY - 10)}px`
  canvas.appendChild(badge)

  // Force transition start after first paint.
  window.requestAnimationFrame(() => {
    badge.classList.add('visible')
  })

  const timerId = window.setTimeout(() => {
    nextVGraphState.runtimeTimers.delete(timerId)
    badge.classList.remove('visible')
    window.setTimeout(() => {
      badge.remove()
    }, 180)
  }, 1400)

  nextVGraphState.runtimeTimers.add(timerId)
}

function getNextVGraphEdgePlacementCandidates(edgeKey) {
  const edgeElement = nextVGraphState.edgeElements.get(edgeKey)
  if (!edgeElement) return []

  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const renderScale = getNextVGraphRenderScale(zoom)
  const scaledPadding = getNextVGraphScaledPadding(zoom, getNextVGraphViewport())
  const toCanvas = (point) => ({
    x: scaledPadding.x + (Number(point.x) * renderScale),
    y: scaledPadding.y + (Number(point.y) * renderScale),
  })

  const ratioSamples = [0.34, 0.42, 0.5, 0.58, 0.66]
  const normalOffsets = [12, 18, 26, 34]
  const candidates = []

  const pushCandidates = (point, normal, ratio) => {
    const base = toCanvas(point)
    const nx = Number(normal?.x)
    const ny = Number(normal?.y)
    const normalLength = Math.hypot(nx, ny) || 1
    const unitNormal = { x: nx / normalLength, y: ny / normalLength }
    const ratioScore = 1 - Math.abs(0.5 - ratio)

    for (const offset of normalOffsets) {
      for (const sign of [1, -1]) {
        candidates.push({
          x: base.x + (unitNormal.x * offset * sign),
          y: base.y + (unitNormal.y * offset * sign),
          score: (ratioScore * 100) - offset,
        })
      }
    }
  }

  if (typeof edgeElement.getTotalLength === 'function' && typeof edgeElement.getPointAtLength === 'function') {
    try {
      const totalLength = Number(edgeElement.getTotalLength())
      if (Number.isFinite(totalLength) && totalLength > 0) {
        for (const ratio of ratioSamples) {
          const edgeLen = totalLength * ratio
          const point = edgeElement.getPointAtLength(edgeLen)
          const span = Math.max(8, totalLength * 0.06)
          const before = edgeElement.getPointAtLength(Math.max(0, edgeLen - span))
          const after = edgeElement.getPointAtLength(Math.min(totalLength, edgeLen + span))
          const tx = Number(after.x) - Number(before.x)
          const ty = Number(after.y) - Number(before.y)
          const tangentLength = Math.hypot(tx, ty) || 1
          pushCandidates(point, { x: -(ty / tangentLength), y: tx / tangentLength }, ratio)
        }
      }
    } catch {
      // Fall through to straight-line fallback below.
    }
  }

  if (candidates.length === 0) {
    const x1 = Number(edgeElement.getAttribute('x1'))
    const y1 = Number(edgeElement.getAttribute('y1'))
    const x2 = Number(edgeElement.getAttribute('x2'))
    const y2 = Number(edgeElement.getAttribute('y2'))
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      const tx = x2 - x1
      const ty = y2 - y1
      const tangentLength = Math.hypot(tx, ty) || 1
      const normal = { x: -(ty / tangentLength), y: tx / tangentLength }
      for (const ratio of ratioSamples) {
        pushCandidates(
          {
            x: x1 + ((x2 - x1) * ratio),
            y: y1 + ((y2 - y1) * ratio),
          },
          normal,
          ratio,
        )
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

function rectsIntersect(a, b) {
  return !(
    a.right <= b.left
    || a.left >= b.right
    || a.bottom <= b.top
    || a.top >= b.bottom
  )
}

function rectOverlapArea(a, b) {
  const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return overlapWidth * overlapHeight
}

function badgeOverlapsAnyNodeShape(badgeRect, nodeShapeRects) {
  const margin = 4
  const expanded = {
    left: badgeRect.left - margin,
    right: badgeRect.right + margin,
    top: badgeRect.top - margin,
    bottom: badgeRect.bottom + margin,
  }
  for (const rect of nodeShapeRects) {
    if (rectsIntersect(expanded, rect)) return true
  }
  return false
}

function positionNextVGraphEdgeBadge(badge, edgeKey, canvas) {
  const nodeShapeRects = Array.from(canvas.querySelectorAll('.nextv-graph-node-shape')).map((el) => el.getBoundingClientRect())
  const candidates = getNextVGraphEdgePlacementCandidates(edgeKey)
  if (candidates.length === 0) return

  let bestCandidate = null
  let bestOverlap = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    badge.style.left = `${Math.round(candidate.x)}px`
    badge.style.top = `${Math.round(candidate.y)}px`
    const rect = badge.getBoundingClientRect()
    if (!badgeOverlapsAnyNodeShape(rect, nodeShapeRects)) {
      return
    }

    let overlapArea = 0
    for (const nodeRect of nodeShapeRects) {
      overlapArea += rectOverlapArea(rect, nodeRect)
    }
    if (overlapArea < bestOverlap) {
      bestOverlap = overlapArea
      bestCandidate = candidate
    }
  }

  // Fallback to the lowest-overlap candidate when all positions collide.
  if (bestCandidate) {
    badge.style.left = `${Math.round(bestCandidate.x)}px`
    badge.style.top = `${Math.round(bestCandidate.y)}px`
  }
}

export function flashNextVGraphEdgeValue(edgeKey, value) {
  const formatted = formatNextVGraphEventValue(value)
  if (!formatted) return

  const canvas = nextVGraphState.canvasEl ?? getNextVGraphCanvas()
  if (!canvas) return

  const badge = document.createElement('div')
  badge.className = 'nextv-graph-emit-value-flash nextv-graph-effect-value-flash nextv-graph-edge-value-flash'
  badge.textContent = formatted
  canvas.appendChild(badge)
  positionNextVGraphEdgeBadge(badge, edgeKey, canvas)

  window.requestAnimationFrame(() => {
    badge.classList.add('visible')
  })

  const timerId = window.setTimeout(() => {
    nextVGraphState.runtimeTimers.delete(timerId)
    badge.classList.remove('visible')
    window.setTimeout(() => {
      badge.remove()
    }, 180)
  }, 1400)

  nextVGraphState.runtimeTimers.add(timerId)
}

export function getNextVGraphEdgeKey(from, to) {
  return `${String(from ?? '').trim()}\u0000${String(to ?? '').trim()}`
}

export function pulseNextVGraphNode(nodeId, durationMs = 650) {
  const normalizedNodeId = String(nodeId ?? '').trim()
  if (!normalizedNodeId) return false

  const nodeEl = nextVGraphState.nodeElements.get(normalizedNodeId)
  if (!nodeEl) return false

  const existingTimerId = nextVGraphState.visualPulseTimersByNode.get(normalizedNodeId)
  if (existingTimerId) {
    window.clearTimeout(existingTimerId)
    nextVGraphState.visualPulseTimers.delete(existingTimerId)
    nextVGraphState.visualPulseTimersByNode.delete(normalizedNodeId)
  }

  // Restart class-driven animation reliably for repeated pulses.
  nodeEl.classList.remove('is-pulsing')
  nodeEl.getBoundingClientRect()
  nodeEl.classList.add('is-pulsing')
  const timerId = window.setTimeout(() => {
    nextVGraphState.visualPulseTimers.delete(timerId)
    nextVGraphState.visualPulseTimersByNode.delete(normalizedNodeId)
    nodeEl.classList.remove('is-pulsing')
  }, Math.max(160, Number(durationMs) || 650))
  nextVGraphState.visualPulseTimers.add(timerId)
  nextVGraphState.visualPulseTimersByNode.set(normalizedNodeId, timerId)
  return true
}

export function queueNextVGraphTimerPulse(eventType) {
  const normalizedEventType = String(eventType ?? '').trim()
  if (!normalizedEventType) return
  nextVGraphState.pendingTimerPulses.push(normalizedEventType)
  if (nextVGraphState.pendingTimerPulses.length > 64) {
    nextVGraphState.pendingTimerPulses.shift()
  }
}

export function flushNextVGraphPendingTimerPulses() {
  if (nextVGraphState.pendingTimerPulses.length === 0) return

  const pulses = nextVGraphState.pendingTimerPulses.slice()
  nextVGraphState.pendingTimerPulses = []
  for (const eventType of pulses) {
    flashNextVGraphTimerPulse(eventType, { force: true })
  }
}

export function flashNextVGraphTimerPulse(eventType, options = {}) {
  const force = options?.force === true
  const normalizedEventType = String(eventType ?? '').trim()
  if (!normalizedEventType) return

  if (nextVGraphState.graphRefreshInProgress && !force) {
    queueNextVGraphTimerPulse(normalizedEventType)
    return
  }

  const hasAnyNodes = nextVGraphState.nodeElements.size > 0
  if (!hasAnyNodes) {
    queueNextVGraphTimerPulse(normalizedEventType)
    return
  }

  const nodeId = `timer:${normalizedEventType}`
  // Keep pulse visuals independent from runtime state reset so they remain
  // visible during rapid start/stop and startup sequencing.
  const timerPulseVisible = pulseNextVGraphNode(nodeId, 700)
  const externalPulseVisible = pulseNextVGraphNode(normalizedEventType, 700)

  if (!timerPulseVisible && !externalPulseVisible) {
    queueNextVGraphTimerPulse(normalizedEventType)
  }
}

export function fadeNextVGraphActiveHighlights(delayMs = 700) {
  const timerId = window.setTimeout(() => {
    nextVGraphState.runtimeTimers.delete(timerId)
    if (nextVGraphState.runtimeActiveNodes.size === 0 && nextVGraphState.runtimeActiveEdges.size === 0) {
      return
    }
    nextVGraphState.runtimeActiveNodes.clear()
    nextVGraphState.runtimeActiveEdges.clear()
    applyNextVGraphRuntimeVisuals()
  }, Math.max(120, Number(delayMs) || 700))

  nextVGraphState.runtimeTimers.add(timerId)
}

export function getNextVGraphEffectOutputNodeId(sourceEvent, outputFormat) {
  const source = String(sourceEvent ?? '').trim()
  const format = String(outputFormat ?? '').trim()
  if (!source || !format) return ''
  return `__effect__${source}__output__${format}`
}

export function getNextVGraphEffectToolNodeId(sourceEvent, toolName) {
  const source = String(sourceEvent ?? '').trim()
  const tool = String(toolName ?? '').trim() || 'dynamic'
  if (!source) return ''
  return `__effect__${source}__tool__${tool}`
}

export function collectNextVGraphExternalNodeCandidates(nodes, edges) {
  // Only event-kind nodes can be external; count only inbound emit edges.
  const eventNodeIds = new Set(
    nodes.filter((n) => n.kind === 'event').map((n) => n.id)
  )
  const inboundCounts = new Map(Array.from(eventNodeIds).map((id) => [id, 0]))
  for (const edge of edges) {
    const to = typeof edge === 'object' && !Array.isArray(edge) ? edge.to : edge[1]
    const type = typeof edge === 'object' && !Array.isArray(edge) ? edge.type : 'emit'
    if (type !== 'emit') continue
    if (!inboundCounts.has(to)) continue
    inboundCounts.set(to, Number(inboundCounts.get(to) ?? 0) + 1)
  }

  const candidates = new Set()
  for (const [id, inboundCount] of inboundCounts.entries()) {
    if (inboundCount === 0) {
      candidates.add(id)
    }
  }
  for (const node of nextVGraphState.runtimeExternalNodes) {
    candidates.add(node)
  }
  return candidates
}

// Must match BUILTIN_OUTPUT_CHANNELS in src/nextv_event_graph.js
const BUILTIN_GRAPH_OUTPUT_CHANNELS = new Set(['text', 'json', 'voice', 'console', 'visual', 'interaction'])

export function getEffectOutputClassification(channel) {
  return BUILTIN_GRAPH_OUTPUT_CHANNELS.has(String(channel ?? '').trim())
    ? 'declared_output'
    : 'side_effect'
}

export function collectNextVGraphEffects(transitions) {
  const effectNodesById = new Map()
  const effectEdges = []
  const effectEdgeKeys = new Set()

  for (const transition of transitions) {
    const sourceEvent = String(transition?.eventType ?? '').trim()
    if (!sourceEvent) continue

    const outputs = Array.isArray(transition?.outputs) ? transition.outputs : []
    const tools = Array.isArray(transition?.tools) ? transition.tools : []

    // Effect edges originate from the handler node, not the raw event node.
    const handlerId = `handler:${sourceEvent}`

    for (const outputFormatRaw of outputs) {
      const outputFormat = String(outputFormatRaw ?? '').trim()
      if (!outputFormat) continue

      const id = `__effect__${sourceEvent}__output__${outputFormat}`
      if (!effectNodesById.has(id)) {
        effectNodesById.set(id, {
          id,
          kind: 'effect',
          sourceEvent,
          type: 'output',
          channel: outputFormat,
          label: `effect: output:${outputFormat}`,
        })
      }
      const edgeKey = `${handlerId}\u0000${id}`
      if (!effectEdgeKeys.has(edgeKey)) {
        effectEdgeKeys.add(edgeKey)
        effectEdges.push({ from: handlerId, to: id, type: 'effect' })
      }
    }

    for (const tool of tools) {
      if (!tool || tool.effectful !== true) continue
      const toolName = String(tool.name ?? 'dynamic').trim() || 'dynamic'
      const id = `__effect__${sourceEvent}__tool__${toolName}`
      if (!effectNodesById.has(id)) {
        effectNodesById.set(id, {
          id,
          kind: 'effect',
          sourceEvent,
          type: 'tool',
          label: `effect: tool:${toolName}`,
        })
      }
      const edgeKey = `${handlerId}\u0000${id}`
      if (!effectEdgeKeys.has(edgeKey)) {
        effectEdgeKeys.add(edgeKey)
        effectEdges.push({ from: handlerId, to: id, type: 'effect' })
      }
    }
  }

  return { effectNodes: Array.from(effectNodesById.values()), effectEdges }
}

export function normalizeNextVGraphFilePath(pathValue) {
  return String(pathValue ?? '').trim().replace(/\\/g, '/')
}

export function compactNextVGraphFileLabel(pathValue) {
  const normalized = normalizeNextVGraphFilePath(pathValue)
  if (!normalized) return '(entrypoint)'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return '(entrypoint)'
  // Path is already workspace-relative; keep up to 2 trailing segments for compact display.
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

export function getNextVGraphNodeGroupKey(nodeObj, entrypointPath = '') {
  const nodeSourcePath = normalizeNextVGraphFilePath(nodeObj?.sourcePath)
  if (nodeSourcePath) return nodeSourcePath

  const fallbackEntrypoint = normalizeNextVGraphFilePath(entrypointPath)
  if (fallbackEntrypoint) return fallbackEntrypoint

  return '(entrypoint)'
}

export function getNextVGraphNodeVisual(nodeObj, effectLabel = '') {
  const nodeKind = String(nodeObj?.kind ?? 'event')
  const label = nodeKind === 'effect'
    ? String(effectLabel || nodeObj?.id || '')
    : String(nodeObj?.displayLabel || nodeObj?.eventType || nodeObj?.id || '')

  if (nodeKind === 'event') {
    const minWidth = 88
    const maxWidth = 170
    const width = Math.max(minWidth, Math.min(maxWidth, 26 + (label.length * 7)))
    const height = 44
    return {
      shape: 'rounded-rect',
      width,
      height,
      cornerRadius: 10,
      edgeClip: Math.max(width, height) * 0.5,
      externalTagOffsetY: Math.round(height * 0.68),
      badgeOffsetX: Math.round(width * 0.34),
      badgeOffsetY: Math.round(height * -0.34),
    }
  }

  if (nodeKind === 'timer') {
    return {
      shape: 'circle',
      width: 40,
      height: 40,
      cornerRadius: 20,
      edgeClip: 20,
      externalTagOffsetY: 24,
      badgeOffsetX: 14,
      badgeOffsetY: -13,
    }
  }

  if (nodeKind === 'control_branch') {
    return {
      shape: 'rounded-rect',
      width: 86,
      height: 34,
      cornerRadius: 8,
      edgeClip: 43,
      externalTagOffsetY: 20,
      badgeOffsetX: 26,
      badgeOffsetY: -13,
    }
  }

  const minWidth = nodeKind === 'handler' ? 108 : 112
  const maxWidth = nodeKind === 'handler' ? 220 : 206
  const handlerLines = nodeKind === 'handler'
    ? splitNextVGraphHandlerLabelLines(label, { maxLineLength: 20, maxLines: 3 })
    : [label]
  const longestLine = handlerLines.reduce((max, line) => Math.max(max, String(line ?? '').length), 0)
  const width = Math.max(minWidth, Math.min(maxWidth, 26 + (longestLine * 7)))
  const height = nodeKind === 'handler' ? Math.max(54, 38 + (handlerLines.length * 14)) : 50

  return {
    shape: 'rounded-rect',
    width,
    height,
    cornerRadius: 12,
    edgeClip: Math.max(width, height) * 0.5,
    externalTagOffsetY: Math.round(height * 0.62),
    badgeOffsetX: Math.round(width * 0.34),
    badgeOffsetY: Math.round(height * -0.34),
  }
}

export function applyNextVGraphRuntimeVisuals() {
  const nowMs = Date.now()

  for (const [nodeName, nodeElement] of nextVGraphState.nodeElements.entries()) {
    const isActive = nextVGraphState.runtimeActiveNodes.has(nodeName)
    const hasWarning = nextVGraphState.runtimeWarningNodes.has(nodeName)
    const isExternal = nextVGraphState.runtimeExternalNodes.has(nodeName)
    const isTriggeredExternal = nextVGraphState.runtimeTriggeredExternalNodes.has(nodeName)
    const stepValue = nextVGraphState.runtimeStepByNode.get(nodeName)
    const stepLabel = nextVGraphState.stepLabelElements.get(nodeName)
    const handlerLineElements = nextVGraphState.handlerLabelLineElements.get(nodeName)
    const agentTimerRecord = nextVGraphState.runtimeAgentCallTimersByNode.get(nodeName)

    nodeElement.classList.toggle('is-active', isActive)
    nodeElement.classList.toggle('is-runtime-warning', hasWarning)
    nodeElement.classList.toggle('external', isExternal)
    nodeElement.classList.toggle('is-external-triggered', isTriggeredExternal)
    nodeElement.classList.toggle('declared-external', nextVGraphState.declaredExternalNodes.has(nodeName))
    nodeElement.classList.toggle('contract-warning', nextVGraphState.contractWarningNodes.has(nodeName))

    if (stepLabel) {
      if (Number.isFinite(stepValue) && stepValue > 0) {
        stepLabel.textContent = String(stepValue)
        stepLabel.classList.add('visible')
      } else {
        stepLabel.textContent = ''
        stepLabel.classList.remove('visible')
      }
    }

    if (Array.isArray(handlerLineElements) && nodeName.startsWith('handler:')) {
      const transition = getNextVGraphTransitionForHandlerNode(nodeName)
      const nodeObj = nextVGraphState.nodes.find((entry) => entry?.id === nodeName)
      const timerSlots = Array.isArray(agentTimerRecord?.slots)
        ? agentTimerRecord.slots.map((slot) => {
          const startMs = Number(slot?.startMs)
          const resolvedElapsedMs = slot?.active === true
            ? Math.max(0, nowMs - (Number.isFinite(startMs) ? startMs : nowMs))
            : Math.max(0, Number(slot?.elapsedMs) || 0)
          return {
            active: slot?.active === true,
            startMs,
            elapsedMs: resolvedElapsedMs,
          }
        })
        : []
      const displayLines = getNextVGraphHandlerLabelLines(nodeObj, transition, { timerSlots })
      for (let idx = 0; idx < handlerLineElements.length; idx += 1) {
        handlerLineElements[idx].textContent = String(displayLines[idx] ?? '')
      }
    }
  }

  for (const [edgeKey, edgeElement] of nextVGraphState.edgeElements.entries()) {
    const isActive = nextVGraphState.runtimeActiveEdges.has(edgeKey)
    const wasTraversed = nextVGraphState.runtimeVisitedEdges.has(edgeKey)

    edgeElement.classList.toggle('is-active', isActive)
    edgeElement.classList.toggle('was-traversed', wasTraversed)

    if (!Object.prototype.hasOwnProperty.call(edgeElement.dataset, 'baseMarkerEnd')) {
      edgeElement.dataset.baseMarkerEnd = String(edgeElement.getAttribute('marker-end') ?? '')
    }
    if (isActive) {
      edgeElement.setAttribute('marker-end', 'url(#nextv-graph-arrow-active)')
    } else if (edgeElement.dataset.baseMarkerEnd) {
      edgeElement.setAttribute('marker-end', edgeElement.dataset.baseMarkerEnd)
    }
  }
}

export function markNextVGraphNodeActive(nodeName) {
  const normalizedNode = String(nodeName ?? '').trim()
  if (!normalizedNode) return
  nextVGraphState.runtimeActiveNodes.clear()
  nextVGraphState.runtimeActiveNodes.add(normalizedNode)
  applyNextVGraphRuntimeVisuals()
}

export function markNextVGraphEdgeActive(from, to) {
  const edgeKey = getNextVGraphEdgeKey(from, to)
  if (!edgeKey || !nextVGraphState.edgeElements.has(edgeKey)) return

  nextVGraphState.runtimeVisitedEdges.add(edgeKey)
  nextVGraphState.runtimeActiveEdges.clear()
  nextVGraphState.runtimeActiveEdges.add(edgeKey)
  applyNextVGraphRuntimeVisuals()
}

export function markNextVGraphEffectEdgeActive(sourceNode, effectType, effectName) {
  // sourceNode may be a handler ID ("handler:X") or a raw event type; normalize to raw event type for node ID lookup.
  const source = String(sourceNode ?? '').trim()
  if (!source) return
  const rawEvent = source.startsWith('handler:') ? source.slice('handler:'.length) : source
  const handlerId = source.startsWith('handler:') ? source : `handler:${source}`

  let effectNodeId = ''
  if (effectType === 'output') {
    effectNodeId = getNextVGraphEffectOutputNodeId(rawEvent, effectName)
  } else if (effectType === 'tool') {
    effectNodeId = getNextVGraphEffectToolNodeId(rawEvent, effectName)
  }

  if (!effectNodeId) return
  markNextVGraphEdgeActive(handlerId, effectNodeId)
}

export function resolveNextVGraphEffectEdgeKey(sourceNode, effectType, effectName) {
  const source = String(sourceNode ?? '').trim()
  if (!source) return ''
  const rawEvent = source.startsWith('handler:') ? source.slice('handler:'.length) : source
  const handlerId = source.startsWith('handler:') ? source : `handler:${source}`

  let effectNodeId = ''
  if (effectType === 'output') {
    effectNodeId = getNextVGraphEffectOutputNodeId(rawEvent, effectName)
  } else if (effectType === 'tool') {
    effectNodeId = getNextVGraphEffectToolNodeId(rawEvent, effectName)
  }

  if (!effectNodeId) return ''
  return getNextVGraphEdgeKey(handlerId, effectNodeId)
}

export function updateNextVGraphRuntimeStep(nodeName) {
  const normalizedNode = String(nodeName ?? '').trim()
  if (!normalizedNode) return

  if (!nextVGraphState.runtimeStepByNode.has(normalizedNode)) {
    nextVGraphState.runtimeSequence += 1
    nextVGraphState.runtimeStepByNode.set(normalizedNode, nextVGraphState.runtimeSequence)
  }
}

export function inferNextVGraphFallbackHandler(eventType) {
  const sourceEventType = String(eventType ?? '').trim()
  if (!sourceEventType) return ''

  const sourceHandlerId = `handler:${sourceEventType}`
  if (!nextVGraphState.nodeElements.has(sourceHandlerId)) return ''

  const transition = nextVGraphState.transitions.find((entry) => String(entry?.eventType ?? '') === sourceEventType)
  const isThinExternalIngress = (
    transition?.subscriptionKind === 'external'
    && transition?.classification === 'pure'
    && Array.isArray(transition?.outputs)
    && transition.outputs.length === 0
    && Array.isArray(transition?.tools)
    && transition.tools.length === 0
  )

  if (!isThinExternalIngress) return sourceHandlerId

  const emittedTargets = nextVGraphState.edges
    .filter((edge) => edge?.type === 'emit' && String(edge?.from ?? '') === sourceHandlerId)
    .map((edge) => String(edge?.to ?? '').trim())
    .filter(Boolean)

  if (emittedTargets.length !== 1) return sourceHandlerId

  const internalHandlerId = `handler:${emittedTargets[0]}`
  if (nextVGraphState.nodeElements.has(internalHandlerId)) {
    return internalHandlerId
  }

  return sourceHandlerId
}

export function markNextVGraphRuntimeWarning(nodeName) {
  const normalizedNode = String(nodeName ?? '').trim()
  if (!normalizedNode) return
  nextVGraphState.runtimeWarningNodes.add(normalizedNode)
  applyNextVGraphRuntimeVisuals()
}

export function inferNextVGraphNodeFromWarning(runtimeEvent) {
  const explicitSignalType = String(runtimeEvent?.signalType ?? '').trim()
  if (explicitSignalType) return explicitSignalType
  return String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
}

export function handleNextVGraphRuntimeEvent(runtimeEvent) {
  if (!runtimeEvent || typeof runtimeEvent !== 'object') return

  if (runtimeEvent.type === 'signal_dispatch') {
    const signalType = String(runtimeEvent.signalType ?? '').trim()
    if (!signalType) return

    const handlerId = `handler:${signalType}`
    updateNextVGraphRuntimeStep(handlerId)

    // Mark both the event node and the handler node as active.
    nextVGraphState.runtimeActiveNodes.clear()
    nextVGraphState.runtimeActiveNodes.add(signalType)
    nextVGraphState.runtimeActiveNodes.add(handlerId)

    const previousNode = String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
    if (previousNode) {
      // Animate: previous handler → this event node (emit edge), then event → handler (subscription edge).
      markNextVGraphEdgeActive(previousNode, signalType)
    }
    // Also activate the subscription edge from event to handler.
    const subscriptionKey = getNextVGraphEdgeKey(signalType, handlerId)
    if (subscriptionKey && nextVGraphState.edgeElements.has(subscriptionKey)) {
      nextVGraphState.runtimeVisitedEdges.add(subscriptionKey)
      nextVGraphState.runtimeActiveEdges.add(subscriptionKey)
    }

    nextVGraphState.runtimeLastDispatchedNode = handlerId
    applyNextVGraphRuntimeVisuals()
    const emitEdgeKey = previousNode ? getNextVGraphEdgeKey(previousNode, signalType) : ''
    const collapsedEmitEdgeKey = previousNode ? getNextVGraphEdgeKey(previousNode, handlerId) : ''
    const payloadEdgeKey = (emitEdgeKey && nextVGraphState.edgeElements.has(emitEdgeKey))
      ? emitEdgeKey
      : (collapsedEmitEdgeKey && nextVGraphState.edgeElements.has(collapsedEmitEdgeKey))
        ? collapsedEmitEdgeKey
      : (subscriptionKey && nextVGraphState.edgeElements.has(subscriptionKey) ? subscriptionKey : '')
    if (payloadEdgeKey) {
      flashNextVGraphEdgeValue(payloadEdgeKey, runtimeEvent.value)
    } else {
      flashNextVGraphEventValue(signalType, runtimeEvent.value, { nodeId: handlerId })
    }
    if (nextVGraphState.autoFollowEnabled && typeof nextVGraphState.setSelectedGraphNodeFn === 'function') {
      nextVGraphState.setSelectedGraphNodeFn(handlerId)
    }
    return
  }

  if (runtimeEvent.type === 'output') {
    const currentNode = resolveNextVGraphRuntimeHandlerNode(runtimeEvent)
    const format = String(runtimeEvent.format ?? '').trim()
    if (currentNode && format) {
      nextVGraphState.runtimeLastDispatchedNode = currentNode
      markNextVGraphEffectEdgeActive(currentNode, 'output', format)
      const edgeKey = resolveNextVGraphEffectEdgeKey(currentNode, 'output', format)
      flashNextVGraphEdgeValue(edgeKey, runtimeEvent.value ?? runtimeEvent.content)
    }
    return
  }

  if (runtimeEvent.type === 'agent_call') {
    startNextVGraphAgentTimer(runtimeEvent)
    return
  }

  if (runtimeEvent.type === 'agent_result' || runtimeEvent.type === 'agent_error') {
    finishNextVGraphAgentTimer(runtimeEvent)
    return
  }

  if (runtimeEvent.type === 'tool_call' || runtimeEvent.type === 'tool_result') {
    const currentNode = resolveNextVGraphRuntimeHandlerNode(runtimeEvent)
    const toolName = String(runtimeEvent.tool ?? runtimeEvent.agent ?? '').trim()
    const runtimeEventTimestampMs = parseNextVGraphRuntimeEventTimestampMs(runtimeEvent)

    if (currentNode && toolName) {
      nextVGraphState.runtimeLastDispatchedNode = currentNode
      const hasDeclaredAgentEntries = getNextVGraphAgentEntriesForHandlerNode(currentNode).length > 0
      if (!hasDeclaredAgentEntries) {
        const timerRecord = ensureNextVGraphAgentTimerRecord(currentNode)
        if (runtimeEvent.type === 'tool_call') {
          const slotIndex = findNextVGraphAgentStartSlot(timerRecord)
          timerRecord.slots[slotIndex] = {
            active: true,
            startMs: runtimeEventTimestampMs,
            elapsedMs: 0,
          }
          timerRecord.nextStartIndex = Math.min(slotIndex + 1, timerRecord.slots.length - 1)
          nextVGraphState.runtimeAgentCallTimersByNode.set(currentNode, timerRecord)
        } else {
          const slotIndex = findNextVGraphAgentFinishSlot(timerRecord)
          const currentTimerState = timerRecord.slots[slotIndex]
          const metadataElapsedMs = Number(runtimeEvent?.result?.metadata?.elapsedMs)
          const startMs = Number(currentTimerState?.startMs)
          const elapsedMs = Number.isFinite(metadataElapsedMs)
            ? Math.max(0, metadataElapsedMs)
            : Math.max(0, runtimeEventTimestampMs - (Number.isFinite(startMs) ? startMs : runtimeEventTimestampMs))

          timerRecord.slots[slotIndex] = {
            active: false,
            startMs: Number.isFinite(startMs) ? startMs : Math.max(0, runtimeEventTimestampMs - elapsedMs),
            elapsedMs,
          }
          nextVGraphState.runtimeAgentCallTimersByNode.set(currentNode, timerRecord)
        }

        syncNextVGraphAgentTicker()
      }

      applyNextVGraphRuntimeVisuals()
    }

    const isEffectful = runtimeEvent?.toolMetadata?.effectful === true
    if (currentNode && toolName && isEffectful) {
      markNextVGraphEffectEdgeActive(currentNode, 'tool', toolName)
    }
    return
  }

  if (runtimeEvent.type === 'warning') {
    const warningNode = String(runtimeEvent.signalType ?? '').trim() || inferNextVGraphNodeFromWarning(runtimeEvent)
    markNextVGraphRuntimeWarning(warningNode)
  }
}

// Builds a smooth SVG path string through an array of {x, y} points.
export function buildSmoothPath(points) {
  if (!points || points.length < 2) return ''
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }
  // Smooth through bendpoints using quadratic bezier between consecutive midpoints.
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`
  }
  d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`
  return d
}

export function buildNextVGraphLayout(graphNodes, options = {}) {
  const entrypointPath = String(options.entrypointPath ?? '')
  const externalNodeIds = options.externalNodeIds instanceof Set ? options.externalNodeIds : new Set()
  const graphEdges = Array.isArray(options.graphEdges) ? options.graphEdges : []
  const effectNodeById = options.effectNodeById instanceof Map ? options.effectNodeById : new Map()
  const layoutDirection = normalizeNextVGraphDirection(options.layoutDirection)

  // ── 1. Build file group membership ────────────────────────────────────────
  // For event nodes, group by the handler's sourcePath so the event renders
  // alongside its handler, not alongside its emitter.
  const handlerGroupKeyByEvent = new Map()
  for (const nodeObj of graphNodes) {
    if (nodeObj?.kind === 'handler') {
      const key = getNextVGraphNodeGroupKey(nodeObj, entrypointPath)
      if (key) handlerGroupKeyByEvent.set(String(nodeObj.eventType ?? ''), key)
    }
  }

  const fileGroups = new Map()
  const nodeGroupById = new Map()
  for (const nodeObj of graphNodes) {
    let key
    if (nodeObj?.kind === 'event') {
      key = handlerGroupKeyByEvent.get(String(nodeObj.eventType ?? nodeObj.id ?? ''))
        ?? getNextVGraphNodeGroupKey(nodeObj, entrypointPath)
    } else {
      key = getNextVGraphNodeGroupKey(nodeObj, entrypointPath)
    }
    if (!fileGroups.has(key)) fileGroups.set(key, [])
    fileGroups.get(key).push(nodeObj)
    nodeGroupById.set(nodeObj.id, key)
  }
  const fileCount = fileGroups.size

  // ── 2. Build and run dagre layout ─────────────────────────────────────────
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: layoutDirection,
    nodesep: 84,
    ranksep: 104,
    marginx: 60,
    marginy: 80,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const nodeObj of graphNodes) {
    const effectLabel = nodeObj.kind === 'effect' ? String(effectNodeById.get(nodeObj.id)?.label ?? '') : ''
    const visual = getNextVGraphNodeVisual(nodeObj, effectLabel)
    g.setNode(nodeObj.id, { width: visual.width + 18, height: visual.height + 14 })
  }
  for (const edge of graphEdges) {
    if (edge.from !== edge.to && g.hasNode(edge.from) && g.hasNode(edge.to)) {
      g.setEdge(edge.from, edge.to)
    }
  }

  dagre.layout(g)

  // ── 3. Extract node positions ──────────────────────────────────────────────
  const positions = new Map()
  for (const nodeObj of graphNodes) {
    const dn = g.node(nodeObj.id)
    if (dn) positions.set(nodeObj.id, { x: dn.x, y: dn.y })
  }

  // ── 3.5 Fold long linear chains into compact 2D blocks ───────────────────
  const movedNodeIds = new Set()
  const chainEligibleNodes = new Set(
    graphNodes
      .filter((nodeObj) => {
        const nodeId = String(nodeObj?.id ?? '')
        const kind = String(nodeObj?.kind ?? '')
        return positions.has(nodeId)
          && !externalNodeIds.has(nodeId)
          && (kind === 'event' || kind === 'handler')
      })
      .map((nodeObj) => String(nodeObj.id))
  )

  const incomingByNode = new Map()
  const outgoingByNode = new Map()
  const addNeighbor = (mapRef, from, to) => {
    if (!mapRef.has(from)) mapRef.set(from, [])
    mapRef.get(from).push(to)
  }

  for (const edge of graphEdges) {
    const fromId = String(edge?.from ?? '')
    const toId = String(edge?.to ?? '')
    const edgeType = String(edge?.type ?? '')
    if (!chainEligibleNodes.has(fromId) || !chainEligibleNodes.has(toId)) continue
    if (fromId === toId) continue
    if (edgeType !== 'emit' && edgeType !== 'subscription') continue

    const fromGroup = nodeGroupById.get(fromId)
    const toGroup = nodeGroupById.get(toId)
    if (!fromGroup || fromGroup !== toGroup) continue

    addNeighbor(outgoingByNode, fromId, toId)
    addNeighbor(incomingByNode, toId, fromId)
  }

  const getVisualSize = (nodeId) => {
    const nodeObj = graphNodes.find((node) => String(node.id) === nodeId)
    if (!nodeObj) return { width: 128, height: 56 }
    const effectLabel = nodeObj.kind === 'effect' ? String(effectNodeById.get(nodeObj.id)?.label ?? '') : ''
    return getNextVGraphNodeVisual(nodeObj, effectLabel)
  }

  const visitedChainNodes = new Set()
  const minChainLength = 6

  for (const startId of chainEligibleNodes) {
    if (visitedChainNodes.has(startId)) continue

    const inDeg = (incomingByNode.get(startId) ?? []).length
    const outDeg = (outgoingByNode.get(startId) ?? []).length
    if (outDeg !== 1 || inDeg === 1) continue

    const chain = [startId]
    const chainSeen = new Set(chain)
    let cursor = startId

    while (true) {
      const outgoing = outgoingByNode.get(cursor) ?? []
      if (outgoing.length !== 1) break

      const nextId = outgoing[0]
      const nextIncoming = incomingByNode.get(nextId) ?? []
      if (nextIncoming.length !== 1) break
      if (chainSeen.has(nextId)) break

      chain.push(nextId)
      chainSeen.add(nextId)
      cursor = nextId
    }

    for (const nodeId of chain) visitedChainNodes.add(nodeId)
    if (chain.length < minChainLength) continue

    let anchorX = Infinity
    let anchorY = Infinity
    let maxNodeWidth = 0
    let maxNodeHeight = 0
    for (const nodeId of chain) {
      const pos = positions.get(nodeId)
      if (!pos) continue
      anchorX = Math.min(anchorX, pos.x)
      anchorY = Math.min(anchorY, pos.y)
      const visual = getVisualSize(nodeId)
      maxNodeWidth = Math.max(maxNodeWidth, Number(visual?.width) || 120)
      maxNodeHeight = Math.max(maxNodeHeight, Number(visual?.height) || 50)
    }
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) continue

    const columns = Math.max(2, Math.min(6, Math.round(Math.sqrt(chain.length))))
    const cellW = maxNodeWidth + 54
    const cellH = maxNodeHeight + 42

    for (let index = 0; index < chain.length; index++) {
      const nodeId = chain[index]
      const row = Math.floor(index / columns)
      const idxInRow = index % columns
      const col = row % 2 === 0 ? idxInRow : (columns - 1 - idxInRow)
      positions.set(nodeId, {
        x: anchorX + (col * cellW),
        y: anchorY + (row * cellH),
      })
      movedNodeIds.add(nodeId)
    }
  }

  // ── 4. Extract edge bendpoints ─────────────────────────────────────────────
  const edgeBendpoints = new Map()
  for (const e of g.edges()) {
    const ed = g.edge(e)
    if (ed && Array.isArray(ed.points) && ed.points.length >= 2) {
      if (movedNodeIds.has(String(e.v)) || movedNodeIds.has(String(e.w))) continue
      edgeBendpoints.set(`${e.v}\u0000${e.w}`, ed.points)
    }
  }

  // ── 5. Derive container bounds from final node positions ───────────────────
  const containerPadX = 30
  const containerPadTop = 38
  const containerPadBottom = 22
  const containers = []
  for (const [key, members] of fileGroups.entries()) {
    const internalMembers = members.filter((n) => !externalNodeIds.has(n.id))
    const positioned = internalMembers.filter((n) => positions.has(n.id))
    if (positioned.length === 0) continue
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of positioned) {
      const pos = positions.get(n.id)
      const effectLabel = n.kind === 'effect' ? String(effectNodeById.get(n.id)?.label ?? '') : ''
      const visual = getNextVGraphNodeVisual(n, effectLabel)
      const halfW = visual.width / 2
      const halfH = visual.height / 2
      minX = Math.min(minX, pos.x - halfW)
      maxX = Math.max(maxX, pos.x + halfW)
      minY = Math.min(minY, pos.y - halfH)
      maxY = Math.max(maxY, pos.y + halfH)
    }

    const box = {
      key,
      label: compactNextVGraphFileLabel(key),
      x: minX - containerPadX,
      y: minY - containerPadTop,
      width: maxX - minX + containerPadX * 2,
      height: maxY - minY + containerPadTop + containerPadBottom,
      memberCount: members.length,
    }
    containers.push(box)
  }

  // Recompute layout bounds after Dagre layout.
  let maxNodeX = 0
  let maxNodeY = 0
  for (const nodeObj of graphNodes) {
    const pos = positions.get(nodeObj.id)
    if (!pos) continue
    const r = nodeObj.kind === 'effect' ? 20 : nodeObj.kind === 'event' ? 18 : 24
    maxNodeX = Math.max(maxNodeX, pos.x + r)
    maxNodeY = Math.max(maxNodeY, pos.y + r)
  }

  let maxContainerX = 0
  let maxContainerY = 0
  for (const box of containers) {
    maxContainerX = Math.max(maxContainerX, box.x + box.width)
    maxContainerY = Math.max(maxContainerY, box.y + box.height)
  }

  const graphMeta = g.graph()
  const width = Math.max(520, (graphMeta.width ?? 520) + 60, maxNodeX + 70, maxContainerX + 40)
  const height = Math.max(320, (graphMeta.height ?? 320) + 60, maxNodeY + 70, maxContainerY + 40)

  return { width, height, positions, containers, fileCount, nodeGroupById, edgeBendpoints }
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  nextVGraphState,
  nextVWorkspaceDirInput,
  nextVEntrypointInput,
  nextVEventsOutput,
  nextVGraphOutput,
  nextVConsoleOutput
} from './state.js'
import {
  isNextVMode,
  normalizeNextVGraphDirection,
  setNextVGraphDirection,
  setNextVControlOverlayEnabled,
  isNextVControlOverlayEnabled,
  setNextVControlBranchesVisible,
  isNextVControlBranchesVisible,
  getControlOverlayClassName,
  appendPanelLogRow,
  clearNextVGraphOutput
} from './03_ui_controls.js'
import {
  openFloatingGraphCodePanel
} from './04_floating_panels.js'
import {
  getNextVGraphViewport,
  getNextVGraphPadding,
  clampNextVGraphZoom,
  getNextVGraphWheelZoomStep,
  applyNextVGraphZoom,
  positionNextVGraphPopover,
  centerNextVGraphViewport,
  captureNextVGraphViewportState,
  scheduleNextVGraphViewportRestore,
  zoomNextVGraph,
  resetNextVGraphZoom,
  getNextVGraphFitZoom,
  renderNextVGraphMessage,
  getTransitionClassName,
  getControlProvenanceClass,
  buildNextVControlGraphArtifacts,
  formatTransitionClassification,
  getNextVGraphHandlerLabel,
  getNextVGraphHandlerLabelLines,
  splitNextVGraphHandlerLabelLines,
  buildNextVGraphTransitionLookup,
  appendTransitionChip
} from './05_graph_viewport.js'
import {
  syncNextVGraphAgentTicker,
  getNextVGraphEdgeKey,
  flushNextVGraphPendingTimerPulses,
  collectNextVGraphExternalNodeCandidates,
  getEffectOutputClassification,
  collectNextVGraphEffects,
  getNextVGraphNodeVisual,
  applyNextVGraphRuntimeVisuals,
  buildSmoothPath,
  buildNextVGraphLayout
} from './06_graph_runtime.js'
import {
  normalizeRelativePath,
  normalizeNextVWorkspaceDir,
  normalizeGraphSourcePathForEditor
} from './08_path_utils.js'
import {
  pathBasename
} from './10_file_tree.js'
import {
  setStatus,
  appendScriptLogRow
} from './13_layout.js'

function getThemeColorToken(name, fallback) {
  const rootStyle = getComputedStyle(document.body || document.documentElement)
  const value = String(rootStyle.getPropertyValue(name) ?? '').trim()
  return value || fallback
}

export function renderNextVGraph(data = {}, options = {}) {
  const { preserveViewport = false, viewportState = null } = options
  if (!nextVGraphOutput) return
  const layoutDirection = normalizeNextVGraphDirection(nextVGraphState.layoutDirection)

  const nodes = Array.isArray(data.nodes) ? data.nodes : []
  const edges = Array.isArray(data.edges) ? data.edges : []
  const controlEdges = Array.isArray(data.controlEdges) ? data.controlEdges : []
  const cycles = Array.isArray(data.cycles) ? data.cycles : []
  const ignoredDynamicEmits = Array.isArray(data.ignoredDynamicEmits) ? data.ignoredDynamicEmits : []
  const transitions = Array.isArray(data.transitions) ? data.transitions : []
  const contractWarnings = Array.isArray(data.contractWarnings) ? data.contractWarnings : []
  const declaredExternals = Array.isArray(data.declaredExternals) ? data.declaredExternals : []
  const entrypointPath = String(data.entrypointPath ?? '')
  const transitionByEvent = buildNextVGraphTransitionLookup(transitions)
  const handlerSourceByEvent = new Map(
    nodes
      .filter((node) => node?.kind === 'handler')
      .map((node) => [String(node.eventType ?? ''), String(node.sourcePath ?? '')])
      .filter(([eventType]) => eventType)
  )
  const { effectNodes, effectEdges } = collectNextVGraphEffects(transitions)
  for (const effectNode of effectNodes) {
    const sourcePath = String(handlerSourceByEvent.get(String(effectNode?.sourceEvent ?? '')) ?? '').trim()
    if (sourcePath) {
      effectNode.sourcePath = sourcePath
    }
  }
  const effectNodeById = new Map(effectNodes.map((node) => [node.id, node]))

  const { controlNodes, controlGraphEdges } = buildNextVControlGraphArtifacts(controlEdges)
  const showControlBranches = isNextVControlBranchesVisible()
  const visibleControlNodes = showControlBranches ? controlNodes : []
  const visibleControlGraphEdges = showControlBranches ? controlGraphEdges : []

  // Timer nodes sourced from host config: each drives the corresponding event node.
  const rawTimerNodes = Array.isArray(data.timerNodes) ? data.timerNodes : []
  const timerEdges = rawTimerNodes
    .filter((tn) => nodes.some((n) => n.id === tn.eventType))
    .map((tn) => ({ from: tn.id, to: tn.eventType, type: 'fires' }))

  for (const nodeObj of nodes) {
    if (nodeObj?.kind !== 'handler') continue
    const transition = transitionByEvent.get(String(nodeObj?.eventType ?? ''))
    nodeObj.displayLabel = getNextVGraphHandlerLabel(nodeObj, transition)
  }

  // Unified graph node objects: data nodes (event/handler) + effect nodes + timer nodes.
  const graphNodes = [...nodes, ...effectNodes, ...rawTimerNodes, ...visibleControlNodes]
  // Unified edge objects: data edges + effect edges + timer fires edges.
  const graphEdges = [...edges, ...effectEdges, ...timerEdges, ...visibleControlGraphEdges]



  // Map of handler-id → [emitted event type strings] for tooltips.
  const emitsByHandler = new Map()
  for (const edge of graphEdges) {
    if (edge.type !== 'emit') continue
    if (!emitsByHandler.has(edge.from)) emitsByHandler.set(edge.from, [])
    emitsByHandler.get(edge.from).push(edge.to)
  }

  const externalCandidates = collectNextVGraphExternalNodeCandidates(nodes, edges)
  nextVGraphState.runtimeExternalNodes = new Set(externalCandidates)

  // Populate contract state
  nextVGraphState.contractWarnings = contractWarnings
  nextVGraphState.declaredExternalNodes = new Set(declaredExternals.map(String))

  // ── Collapse pass-through internal event nodes ─────────────────────────────
  // Internal event nodes that have a handler subscription are collapsed:
  // the event node itself is hidden, and inbound emit edges are rerouted directly
  // to the handler node. The event name becomes a label on the rerouted edge.
  const collapsibleEventIds = new Set()
  for (const nodeObj of nodes) {
    if (nodeObj.kind !== 'event') continue
    // Keep external events as visible entry-point nodes.
    if (externalCandidates.has(nodeObj.id) || nextVGraphState.declaredExternalNodes.has(nodeObj.id)) continue
    const hasSubscription = edges.some((e) => e.from === nodeObj.id && e.type === 'subscription')
    if (hasSubscription) collapsibleEventIds.add(nodeObj.id)
  }
  // For each collapsible event, record its subscriber handler.
  const collapsedEventSubscriber = new Map()
  for (const e of edges) {
    if (e.type === 'subscription' && collapsibleEventIds.has(e.from)) {
      collapsedEventSubscriber.set(e.from, e.to)
    }
  }
  // Build virtual direct edges: emitter handler → subscriber handler.
  const virtualDirectEdges = []
  const skippedEdgeSignatures = new Set()
  for (const e of edges) {
    if (e.type === 'emit' && collapsibleEventIds.has(e.to)) {
      const subscriberId = collapsedEventSubscriber.get(e.to)
      if (subscriberId) {
        virtualDirectEdges.push({ from: e.from, to: subscriberId, waypoint: e.to, type: 'collapsed-emit', eventLabel: String(e.to) })
      }
      skippedEdgeSignatures.add(`${e.from}\u0000${e.to}`)
    }
    if (e.type === 'subscription' && collapsibleEventIds.has(e.from)) {
      skippedEdgeSignatures.add(`${e.from}\u0000${e.to}`)
    }
  }
  nextVGraphState.contractWarningNodes.clear()
  for (const cw of contractWarnings) {
    const eventType = String(cw.eventType ?? '')
    if (!eventType) continue
    if (!nextVGraphState.contractWarningNodes.has(eventType)) {
      nextVGraphState.contractWarningNodes.set(eventType, [])
    }
    nextVGraphState.contractWarningNodes.get(eventType).push(cw)
  }

  nextVGraphState.nodes = nodes
  nextVGraphState.edges = edges
  nextVGraphState.controlEdges = controlEdges
  nextVGraphState.cycles = cycles
  nextVGraphState.entrypointPath = entrypointPath
  nextVGraphState.ignoredDynamicEmits = ignoredDynamicEmits
  nextVGraphState.transitions = transitions
  nextVGraphState.nodeElements = new Map()
  nextVGraphState.edgeElements = new Map()
  nextVGraphState.stepLabelElements = new Map()
  nextVGraphState.handlerLabelLineElements = new Map()
  nextVGraphState.agentTimerLabelElements = new Map()

  const nodeById = new Map(graphNodes.map((node) => [node.id, node]))
  const nodeClickHandlers = new Map()
  let selectedNodeId = ''

  const buildSelectedNodeCard = (nodeId) => {
    const normalizedNodeId = String(nodeId ?? '').trim()
    if (!normalizedNodeId) return null

    const nodeObj = nodeById.get(normalizedNodeId)
    if (!nodeObj) return null

    const isHandlerNode = nodeObj.kind === 'handler'
    const isEffectNode = nodeObj.kind === 'effect'
    const isControlBranchNode = nodeObj.kind === 'control_branch'
    const effectMeta = isEffectNode ? effectNodeById.get(normalizedNodeId) : null
    const transitionEventType = isHandlerNode
      ? String(nodeObj.eventType ?? '')
      : isEffectNode
        ? String(effectMeta?.sourceEvent ?? '')
        : String(nodeObj.eventType ?? nodeObj.id)
    const transition = transitionByEvent.get(transitionEventType)
    const transitionTryBoundaries = Array.isArray(transition?.tryBoundaries)
      ? transition.tryBoundaries
      : []
    const effectClassification = effectMeta?.type === 'output' ? getEffectOutputClassification(effectMeta.channel) : 'side_effect'
    const transitionClass = isControlBranchNode
      ? getControlOverlayClassName(nodeObj?.provenance)
      : getTransitionClassName(isEffectNode ? effectClassification : transition?.classification)

    const card = document.createElement('div')
    card.className = `nextv-graph-transition ${transitionClass}`

    const header = document.createElement('div')
    header.className = 'nextv-graph-transition-header'

    const titleWrap = document.createElement('div')
    titleWrap.className = 'nextv-graph-transition-title'

    const eventName = document.createElement('span')
    eventName.className = 'nextv-graph-transition-event'
    const label = isEffectNode
      ? String(effectMeta?.label ?? normalizedNodeId)
      : isControlBranchNode
        ? String(nodeObj?.branch === 'if_true' ? 'branch: if true' : 'branch: if false')
      : isHandlerNode
        ? getNextVGraphHandlerLabel(nodeObj, transition)
        : String(nodeObj.eventType ?? normalizedNodeId)
    eventName.textContent = label

    const badge = document.createElement('span')
    badge.className = `nextv-graph-chip ${transitionClass}`
    badge.textContent = isControlBranchNode
      ? `control ${getControlProvenanceClass(nodeObj?.provenance)}`
      : formatTransitionClassification(isEffectNode ? effectClassification : transition?.classification)

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'nextv-graph-popover-close'
    closeBtn.textContent = '×'
    closeBtn.title = 'close details'
    closeBtn.setAttribute('aria-label', 'close selected node details')
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      setSelectedGraphNode('')
    })

    titleWrap.appendChild(eventName)
    titleWrap.appendChild(badge)
    if (isHandlerNode && transitionTryBoundaries.length > 0) {
      const tryBadge = document.createElement('span')
      tryBadge.className = 'nextv-graph-chip try-boundary'
      tryBadge.textContent = `try ${transitionTryBoundaries.length}`
      titleWrap.appendChild(tryBadge)
    }
    header.appendChild(titleWrap)
    header.appendChild(closeBtn)
    card.appendChild(header)

    const detailRow = document.createElement('div')
    detailRow.className = 'nextv-graph-transition-detail'

    const addLine = (text, cls = '') => {
      const row = document.createElement('div')
      row.className = `nextv-graph-transition-line${cls ? ` ${cls}` : ''}`
      row.textContent = text
      detailRow.appendChild(row)
    }

    if (nodeObj.kind) addLine(`node kind: ${nodeObj.kind}`)
    if (transitionEventType) addLine(`event: ${transitionEventType}`)
    if (nodeObj.sourcePath) addLine(`file: ${String(nodeObj.sourcePath).replace(/\\/g, '/')}`)
    if (Number.isFinite(Number(nodeObj.sourceLine))) addLine(`line: ${Number(nodeObj.sourceLine)}`)

    if (transition) {
      const tools = Array.isArray(transition.tools) ? transition.tools.filter(Boolean) : []
      const outputs = Array.isArray(transition.outputs) ? transition.outputs : []
      const warnings = Array.isArray(transition.warnings) ? transition.warnings : []
      const tryBoundaries = transitionTryBoundaries

      if (tools.length > 0) {
        addLine(`tools: ${tools.map((tool) => tool.name || 'dynamic').join(', ')}`)
      }

      if (outputs.length > 0) {
        addLine(`outputs: ${outputs.join(', ')}`)
      }

      if (warnings.length > 0) {
        for (const warning of warnings) {
          addLine(`warning: ${String(warning.message ?? warning.code ?? 'unknown warning')}`, 'warning')
        }
      }

      if (tryBoundaries.length > 0) {
        addLine(`try boundaries: ${tryBoundaries.length}`)
        for (const boundary of tryBoundaries) {
          const operation = String(boundary?.operation ?? 'call')
          const target = String(boundary?.target ?? '').trim()
          const boundaryText = target
            ? `try: ${operation} -> ${target}`
            : `try: ${operation}`
          addLine(boundaryText)
        }
      }
    }

    if (isControlBranchNode) {
      addLine(`provenance: ${getControlProvenanceClass(nodeObj?.provenance)}`)
      if (nodeObj?.provenance === 'operational') {
        addLine('control kind: operational envelope branch')
      }
      if (Number.isFinite(Number(nodeObj?.line))) {
        addLine(`line: ${Number(nodeObj.line)}`)
      }
      if (nodeObj?.statement) {
        addLine(`condition: ${String(nodeObj.statement)}`)
      }
    }

    if (isEffectNode) {
      addLine(`effect source: ${String(effectMeta?.sourceEvent ?? '(unknown)')}`)
    }

    if (!detailRow.childNodes.length) {
      addLine('No additional transition metadata.')
    }

    const sourcePath = normalizeGraphSourcePathForEditor(nodeObj?.sourcePath)
    if (sourcePath) {
      const actions = document.createElement('div')
      actions.className = 'nextv-graph-transition-actions'

      const openCodeBtn = document.createElement('button')
      openCodeBtn.type = 'button'
      openCodeBtn.className = 'panel-action'
      openCodeBtn.textContent = 'open code'
      openCodeBtn.title = 'open source in floating panel'
      openCodeBtn.addEventListener('click', async (event) => {
        event.stopPropagation()
        try {
          await openFloatingGraphCodePanel({
            filePath: sourcePath,
            line: Number.isFinite(Number(nodeObj?.sourceLine)) ? Number(nodeObj.sourceLine) : null,
            nodeId: normalizedNodeId,
          })
        } catch (err) {
          appendScriptLogRow(`[file:error] ${err.message}`, 'error')
          setStatus('unable to open graph source', 'responding')
        }
      })

      actions.appendChild(openCodeBtn)
      detailRow.appendChild(actions)
    }

    card.appendChild(detailRow)
    return card
  }

  const setSelectedGraphNode = (nodeId) => {
    // Expose for external callers (e.g., runtime auto-follow).
    nextVGraphState.setSelectedGraphNodeFn = setSelectedGraphNode
    selectedNodeId = String(nodeId ?? '').trim()
    nextVGraphState.selectedNodeId = selectedNodeId

    for (const [id, nodeElement] of nextVGraphState.nodeElements.entries()) {
      nodeElement.classList.toggle('is-selected', id === selectedNodeId)
    }

    const popover = nextVGraphState.detailPopoverEl
    if (!popover) return

    popover.innerHTML = ''
    popover.classList.remove('visible')
    popover.style.visibility = 'hidden'

    if (!selectedNodeId) {
      return
    }

    const card = buildSelectedNodeCard(selectedNodeId)
    if (!card) return

    popover.appendChild(card)
    popover.classList.add('visible')
    positionNextVGraphPopover()
  }

  clearNextVGraphOutput()

  if (graphNodes.length === 0) {
    renderNextVGraphMessage('No static event handlers found in this entrypoint.')
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'nextv-graph-wrap'

  const toolbar = document.createElement('div')
  toolbar.className = 'nextv-graph-toolbar'

  const zoomOutBtn = document.createElement('button')
  zoomOutBtn.type = 'button'
  zoomOutBtn.textContent = '−'
  zoomOutBtn.title = 'zoom out'
  zoomOutBtn.addEventListener('click', () => zoomNextVGraph(-0.15))

  const zoomInBtn = document.createElement('button')
  zoomInBtn.type = 'button'
  zoomInBtn.textContent = '+'
  zoomInBtn.title = 'zoom in'
  zoomInBtn.addEventListener('click', () => zoomNextVGraph(0.15))

  const resetBtn = document.createElement('button')
  resetBtn.type = 'button'
  resetBtn.textContent = 'reset'
  resetBtn.title = 'reset zoom'
  resetBtn.addEventListener('click', () => resetNextVGraphZoom())

  const layoutTbBtn = document.createElement('button')
  layoutTbBtn.type = 'button'
  layoutTbBtn.className = 'nextv-graph-layout-btn'
  layoutTbBtn.textContent = 'TB'
  layoutTbBtn.title = 'layout: top to bottom'
  layoutTbBtn.classList.toggle('active', nextVGraphState.layoutDirection === 'TB')
  layoutTbBtn.addEventListener('click', () => setNextVGraphDirection('TB'))

  const layoutLrBtn = document.createElement('button')
  layoutLrBtn.type = 'button'
  layoutLrBtn.className = 'nextv-graph-layout-btn'
  layoutLrBtn.textContent = 'LR'
  layoutLrBtn.title = 'layout: left to right'
  layoutLrBtn.classList.toggle('active', nextVGraphState.layoutDirection === 'LR')
  layoutLrBtn.addEventListener('click', () => setNextVGraphDirection('LR'))

  const zoomLabel = document.createElement('span')
  zoomLabel.id = 'nextv-graph-zoom-label'
  zoomLabel.className = 'nextv-graph-zoom-label'
  zoomLabel.textContent = '100%'

  const hint = document.createElement('span')
  hint.className = 'nextv-graph-hint'
  hint.textContent = 'drag to pan • wheel to zoom'

  const autoFollowLabel = document.createElement('label')
  autoFollowLabel.className = 'nextv-graph-toolbar-check'
  autoFollowLabel.hidden = true
  autoFollowLabel.title = 'Auto-select active handler node during runtime'
  const autoFollowCheckbox = document.createElement('input')
  autoFollowCheckbox.type = 'checkbox'
  autoFollowCheckbox.checked = nextVGraphState.autoFollowEnabled
  autoFollowCheckbox.addEventListener('change', () => {
    nextVGraphState.autoFollowEnabled = autoFollowCheckbox.checked
  })
  autoFollowLabel.appendChild(autoFollowCheckbox)
  autoFollowLabel.appendChild(document.createTextNode('auto-follow'))

  const controlBranchesBtn = document.createElement('button')
  controlBranchesBtn.type = 'button'
  controlBranchesBtn.className = 'nextv-graph-layout-btn'
  controlBranchesBtn.hidden = true
  controlBranchesBtn.classList.toggle('active', isNextVControlBranchesVisible())
  controlBranchesBtn.textContent = isNextVControlBranchesVisible() ? 'hide branches' : 'show branches'
  controlBranchesBtn.title = 'toggle control branch nodes'
  controlBranchesBtn.addEventListener('click', () => {
    setNextVControlBranchesVisible(!isNextVControlBranchesVisible())
  })

  const controlOverlayBtn = document.createElement('button')
  controlOverlayBtn.type = 'button'
  controlOverlayBtn.className = 'nextv-graph-layout-btn'
  controlOverlayBtn.hidden = true
  controlOverlayBtn.classList.toggle('active', isNextVControlOverlayEnabled())
  controlOverlayBtn.textContent = isNextVControlOverlayEnabled() ? 'boundedness on' : 'boundedness off'
  controlOverlayBtn.title = 'toggle boundedness overlay'
  controlOverlayBtn.addEventListener('click', () => {
    setNextVControlOverlayEnabled(!isNextVControlOverlayEnabled())
  })

  toolbar.appendChild(layoutLrBtn)
  toolbar.appendChild(layoutTbBtn)
  toolbar.appendChild(zoomOutBtn)
  toolbar.appendChild(zoomInBtn)
  toolbar.appendChild(resetBtn)
  toolbar.appendChild(zoomLabel)
  toolbar.appendChild(hint)
  toolbar.appendChild(controlBranchesBtn)
  toolbar.appendChild(controlOverlayBtn)
  wrap.appendChild(toolbar)

  const meta = document.createElement('div')
  meta.className = 'nextv-graph-meta nextv-graph-toolbar-meta'
  const cycleLabel = cycles.length === 1 ? '1 cycle' : `${cycles.length} cycles`
  const mixedCount = transitions.filter((transition) => transition?.classification === 'mixed').length
  const boundedControlCount = visibleControlGraphEdges.filter((edge) => edge.provenance === 'bounded').length
  const unboundedControlCount = visibleControlGraphEdges.filter((edge) => edge.provenance === 'unbounded').length
  const operationalControlCount = visibleControlGraphEdges.filter((edge) => edge.provenance === 'operational').length
  const effectCount = effectNodes.length
  const handlerCount = nodes.filter((n) => n.kind === 'handler').length
  const timerCount = rawTimerNodes.length
  const entrypointLabel = pathBasename(entrypointPath) || 'entrypoint'
  meta.textContent = `${entrypointLabel} • ${handlerCount} handlers • ${edges.length} edges${timerCount ? ` • ${timerCount} timers` : ''}${effectCount ? ` • ${effectCount} effects` : ''}${visibleControlGraphEdges.length ? ` • ${visibleControlGraphEdges.length} control` : ''}${cycles.length ? ` • ${cycleLabel}` : ''}${mixedCount ? ` • ${mixedCount} mixed` : ''}${boundedControlCount ? ` • ${boundedControlCount} bounded-control` : ''}${unboundedControlCount ? ` • ${unboundedControlCount} unbounded-control` : ''}${operationalControlCount ? ` • ${operationalControlCount} operational-control` : ''}`
  toolbar.appendChild(meta)

  if (transitions.length > 0) {
    const legend = document.createElement('div')
    legend.className = 'nextv-graph-legend'
    appendTransitionChip(legend, 'pure', 'pure')
    appendTransitionChip(legend, 'llm', 'llm')
    appendTransitionChip(legend, 'output', 'declared_output')
    appendTransitionChip(legend, 'tool effect', 'side_effect')
    appendTransitionChip(legend, 'mixed', 'mixed')
  }

  if (visibleControlGraphEdges.length > 0 && isNextVControlOverlayEnabled()) {
    const controlLegend = document.createElement('div')
    controlLegend.className = 'nextv-graph-legend'
    appendTransitionChip(controlLegend, 'control bounded', 'control-bounded')
    appendTransitionChip(controlLegend, 'control unbounded', 'control-unbounded')
    appendTransitionChip(controlLegend, 'control operational', 'control-operational')
    appendTransitionChip(controlLegend, 'control mixed', 'control-mixed')
    appendTransitionChip(controlLegend, 'control unknown', 'control-unknown')
  }

  const viewport = document.createElement('div')
  viewport.id = 'nextv-graph-viewport'
  viewport.className = 'nextv-graph-viewport'
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault()
    const step = getNextVGraphWheelZoomStep()
    zoomNextVGraph(event.deltaY < 0 ? step : -step, {
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
    })
  }, { passive: false })

  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  let panScrollLeft = 0
  let panScrollTop = 0

  const stopPan = () => {
    isPanning = false
    viewport.classList.remove('is-panning')
  }

  viewport.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    isPanning = true
    panStartX = event.clientX
    panStartY = event.clientY
    panScrollLeft = viewport.scrollLeft
    panScrollTop = viewport.scrollTop
    viewport.classList.add('is-panning')
    event.preventDefault()
  })

  viewport.addEventListener('mousemove', (event) => {
    if (!isPanning) return
    viewport.scrollLeft = panScrollLeft - (event.clientX - panStartX)
    viewport.scrollTop = panScrollTop - (event.clientY - panStartY)
  })

  viewport.addEventListener('mouseup', stopPan)
  viewport.addEventListener('mouseleave', stopPan)

  const {
    width,
    height,
    positions,
    containers,
    fileCount,
    nodeGroupById,
    edgeBendpoints,
  } = buildNextVGraphLayout(graphNodes, {
    entrypointPath,
    externalNodeIds: externalCandidates,
    graphEdges,
    effectNodeById,
    layoutDirection: nextVGraphState.layoutDirection,
  })
  if (fileCount > 0) {
    meta.textContent += ` • ${fileCount} file${fileCount === 1 ? '' : 's'}`
  }
  const padding = getNextVGraphPadding(width, height)
  const canvas = document.createElement('div')
  canvas.className = 'nextv-graph-canvas'
  nextVGraphState.canvasEl = canvas
  nextVGraphState.layoutPositions = positions

  const detailPopover = document.createElement('div')
  detailPopover.className = 'nextv-graph-popover'
  detailPopover.addEventListener('click', (event) => event.stopPropagation())
  detailPopover.addEventListener('mousedown', (event) => event.stopPropagation())
  nextVGraphState.detailPopoverEl = detailPopover

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('class', 'nextv-graph-svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'nextV event graph')
  svg.dataset.baseWidth = String(width)
  svg.dataset.baseHeight = String(height)
  svg.dataset.padding = String(padding)

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  const edgeColor = getThemeColorToken('--graph-edge-normal', '#5f89a7')
  const cycleEdgeColor = getThemeColorToken('--graph-edge-cycle', '#f44747')
  const activeEdgeColor = getThemeColorToken('--graph-edge-active', '#9cdcfe')

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  arrow.setAttribute('id', 'nextv-graph-arrow')
  arrow.setAttribute('markerWidth', '8')
  arrow.setAttribute('markerHeight', '8')
  arrow.setAttribute('refX', '7')
  arrow.setAttribute('refY', '4')
  arrow.setAttribute('orient', 'auto')
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  arrowPath.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z')
  arrowPath.setAttribute('fill', edgeColor)
  arrow.appendChild(arrowPath)

  const cycleArrow = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  cycleArrow.setAttribute('id', 'nextv-graph-arrow-cycle')
  cycleArrow.setAttribute('markerWidth', '8')
  cycleArrow.setAttribute('markerHeight', '8')
  cycleArrow.setAttribute('refX', '7')
  cycleArrow.setAttribute('refY', '4')
  cycleArrow.setAttribute('orient', 'auto')
  const cycleArrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  cycleArrowPath.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z')
  cycleArrowPath.setAttribute('fill', cycleEdgeColor)
  cycleArrow.appendChild(cycleArrowPath)

  const activeArrow = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  activeArrow.setAttribute('id', 'nextv-graph-arrow-active')
  activeArrow.setAttribute('markerWidth', '9')
  activeArrow.setAttribute('markerHeight', '9')
  activeArrow.setAttribute('refX', '8')
  activeArrow.setAttribute('refY', '4.5')
  activeArrow.setAttribute('orient', 'auto')
  const activeArrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  activeArrowPath.setAttribute('d', 'M 0 0 L 9 4.5 L 0 9 z')
  activeArrowPath.setAttribute('fill', activeEdgeColor)
  activeArrow.appendChild(activeArrowPath)

  defs.appendChild(arrow)
  defs.appendChild(cycleArrow)
  defs.appendChild(activeArrow)
  svg.appendChild(defs)

  const filesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  filesLayer.setAttribute('class', 'nextv-graph-files')
  const containerByKey = new Map()
  for (const box of containers) {
    containerByKey.set(box.key, box)
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'nextv-graph-file-box')

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(box.x))
    rect.setAttribute('y', String(box.y))
    rect.setAttribute('width', String(box.width))
    rect.setAttribute('height', String(box.height))
    rect.setAttribute('rx', '10')
    rect.setAttribute('ry', '10')
    group.appendChild(rect)

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(box.x + 12))
    label.setAttribute('y', String(box.y + 20))
    label.setAttribute('class', 'nextv-graph-file-label')
    label.textContent = box.label
    group.appendChild(label)

    const count = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    count.setAttribute('x', String(box.x + box.width - 12))
    count.setAttribute('y', String(box.y + 20))
    count.setAttribute('text-anchor', 'end')
    count.setAttribute('class', 'nextv-graph-file-count')
    count.textContent = `${box.memberCount}`
    group.appendChild(count)

    filesLayer.appendChild(group)
  }
  svg.appendChild(filesLayer)

  const membershipLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  membershipLayer.setAttribute('class', 'nextv-graph-membership-layer')
  for (const nodeObj of graphNodes) {
    const pos = positions.get(nodeObj.id)
    if (!pos) continue

    const groupKey = nodeGroupById.get(nodeObj.id)
    if (!groupKey) continue

    const container = containerByKey.get(groupKey)
    if (!container) continue

    const effectLabel = nodeObj.kind === 'effect' ? String(effectNodeById.get(nodeObj.id)?.label ?? '') : ''
    const visual = getNextVGraphNodeVisual(nodeObj, effectLabel)
    const isLeftToRight = layoutDirection === 'LR'

    const anchorX = Math.max(container.x + 12, Math.min(container.x + container.width - 12, pos.x))
    const anchorY = Math.max(container.y + 12, Math.min(container.y + container.height - 12, pos.y))

    if (nodeObj?.kind === 'event' && externalCandidates.has(nodeObj.id)) {
      const link = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      link.setAttribute('class', 'nextv-graph-membership-edge')
      if (isLeftToRight) {
        const startX = pos.x + (visual.width / 2)
        link.setAttribute('x1', String(startX))
        link.setAttribute('y1', String(pos.y))
        link.setAttribute('x2', String(container.x))
        link.setAttribute('y2', String(anchorY))
      } else {
        const startY = pos.y + (visual.height / 2)
        link.setAttribute('x1', String(pos.x))
        link.setAttribute('y1', String(startY))
        link.setAttribute('x2', String(anchorX))
        link.setAttribute('y2', String(container.y))
      }
      membershipLayer.appendChild(link)
      continue
    }

    // Effect nodes already have explicit effect edges; skip auxiliary membership
    // connectors here to avoid visual "double arrows".
  }
  svg.appendChild(membershipLayer)

  const cycleNodes = new Set()
  const cycleEdges = new Set()
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length - 1; i++) {
      // Cycles are reported as event-type strings; mark both event and handler nodes.
      cycleNodes.add(cycle[i])
      cycleNodes.add(`handler:${cycle[i]}`)
      // Cycle edges in bipartite model: event→handler (subscription) and handler→next-event (emit).
      cycleEdges.add(`${cycle[i]}\u0000handler:${cycle[i]}`)
      cycleEdges.add(`handler:${cycle[i]}\u0000${cycle[i + 1]}`)
    }
  }

  const allRenderedEdges = [
    ...graphEdges.filter((e) => !skippedEdgeSignatures.has(`${e.from}\u0000${e.to}`)),
    ...virtualDirectEdges,
  ]

  for (const edge of allRenderedEdges) {
    const from = edge.from
    const to = edge.to
    const edgeType = edge.type ?? 'emit'
    const start = positions.get(from)
    const end = positions.get(to)
    if (!start || !end) continue

    const isCycleEdge = cycleEdges.has(`${from}\u0000${to}`)
    // Classification: for emit edges, look up the source handler's transition; for subscription/effect use their own style.
    const srcEventType = from.startsWith('handler:') ? from.slice('handler:'.length) : null
    const fromTransition = srcEventType ? transitionByEvent.get(srcEventType) : transitionByEvent.get(from)
    const fromEffectNode = effectNodeById.get(from)
    const controlProvenance = getControlProvenanceClass(edge.provenance)
    const classification = edgeType === 'control'
      ? getControlOverlayClassName(controlProvenance)
      : fromEffectNode
        ? fromEffectNode.type === 'output'
          ? getEffectOutputClassification(fromEffectNode.channel)
          : 'side_effect'
        : edgeType === 'subscription'
          ? 'subscription'
          : edgeType === 'fires'
            ? 'timer-fires'
            : getTransitionClassName(fromTransition?.classification)
    const hasWarnings = edgeType !== 'subscription' && Array.isArray(fromTransition?.warnings) && fromTransition.warnings.length > 0
    const edgeClass = `nextv-graph-edge ${classification}${isCycleEdge ? ' cycle' : ''}${hasWarnings ? ' warning' : ''}`
    const edgeKey = getNextVGraphEdgeKey(from, to)
    const edgeTitleText = edgeType === 'control'
      ? `control (${String(edge.branch || 'branch')}): ${controlProvenance}`
      : `${edgeType}: ${classification}`

    // Determine node radii for endpoint clipping.
    const toNode = graphNodes.find((n) => n.id === to)
    const toEffectLabel = toNode?.kind === 'effect' ? String(effectNodeById.get(to)?.label ?? '') : ''
    const toRadius = toNode ? getNextVGraphNodeVisual(toNode, toEffectLabel).edgeClip : 24
    const fromNodeObj = graphNodes.find((n) => n.id === from)
    const fromEffectLabel = fromNodeObj?.kind === 'effect' ? String(effectNodeById.get(from)?.label ?? '') : ''
    const fromRadius = fromNodeObj ? getNextVGraphNodeVisual(fromNodeObj, fromEffectLabel).edgeClip : 24

    const getSubscriptionEdgeLabelText = () => {
      if (edgeType === 'collapsed-emit') return String(edge.eventLabel ?? '').trim()
      if (edgeType !== 'subscription') return ''
      return String(edge.from ?? '').trim()
    }

    // Place label near the center of the edge segment, offset to the side.
    const appendEdgeLabelAt = (ax, ay, bx, by, t = 0.5) => {
      const labelText = getSubscriptionEdgeLabelText()
      if (!labelText) return
      const clampedT = Math.max(0.2, Math.min(0.8, Number(t) || 0.5))
      const lx = ax + (bx - ax) * clampedT
      const ly = ay + (by - ay) * clampedT
      // Perpendicular offset so label doesn't sit on the line.
      const len = Math.hypot(bx - ax, by - ay) || 1
      const nx = -(by - ay) / len
      const ny = (bx - ax) / len
      const offset = Math.max(9, Math.min(15, len * 0.15))
      const edgeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      edgeLabel.setAttribute('class', 'nextv-graph-edge-label subscription')
      edgeLabel.setAttribute('x', String(Math.round(lx + nx * offset)))
      edgeLabel.setAttribute('y', String(Math.round(ly + ny * offset)))
      edgeLabel.setAttribute('text-anchor', 'middle')
      edgeLabel.textContent = labelText
      svg.appendChild(edgeLabel)
    }

    if (from === to) {
      // Self-loop: cubic bezier arc above the node.
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('class', edgeClass)
      path.setAttribute('fill', 'none')
      path.dataset.edgeKey = edgeKey
      path.dataset.from = from
      path.dataset.to = to
      path.setAttribute('d', `M ${start.x} ${start.y - 22} C ${start.x + 42} ${start.y - 60}, ${start.x - 42} ${start.y - 60}, ${start.x} ${start.y - 22}`)
      path.setAttribute('marker-end', isCycleEdge ? 'url(#nextv-graph-arrow-cycle)' : 'url(#nextv-graph-arrow)')
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      title.textContent = edgeTitleText
      path.appendChild(title)
      nextVGraphState.edgeElements.set(edgeKey, path)
      svg.appendChild(path)
      continue
    }

    // Collapsed-emit: two-segment path routed through the waypoint (old event node position).
    if (edgeType === 'collapsed-emit' && edge.waypoint) {
      const waypoint = positions.get(edge.waypoint)
      if (waypoint) {
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

        // Clip start point away from `from` node boundary toward waypoint.
        const dx1 = waypoint.x - start.x
        const dy1 = waypoint.y - start.y
        const d1 = Math.hypot(dx1, dy1) || 1
        const sx = start.x + (dx1 / d1) * fromRadius
        const sy = start.y + (dy1 / d1) * fromRadius

        // Clip end point away from `to` node boundary toward waypoint.
        const dx2 = waypoint.x - end.x
        const dy2 = waypoint.y - end.y
        const d2 = Math.hypot(dx2, dy2) || 1
        const ex = end.x + (dx2 / d2) * toRadius
        const ey = end.y + (dy2 / d2) * toRadius

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        pathEl.setAttribute('class', edgeClass)
        pathEl.setAttribute('fill', 'none')
        pathEl.dataset.edgeKey = edgeKey
        pathEl.dataset.from = from
        pathEl.dataset.to = to
        // Smooth elbow: cubic bezier from start through waypoint to end.
        pathEl.setAttribute('d',
          `M ${Math.round(sx)} ${Math.round(sy)} ` +
          `C ${Math.round(sx + (waypoint.x - sx) * 0.6)} ${Math.round(sy + (waypoint.y - sy) * 0.6)},` +
          ` ${Math.round(waypoint.x + (ex - waypoint.x) * 0.4)} ${Math.round(waypoint.y + (ey - waypoint.y) * 0.4)},` +
          ` ${Math.round(ex)} ${Math.round(ey)}`
        )
        pathEl.setAttribute('marker-end', isCycleEdge ? 'url(#nextv-graph-arrow-cycle)' : 'url(#nextv-graph-arrow)')
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
        title.textContent = edgeTitleText
        pathEl.appendChild(title)
        nextVGraphState.edgeElements.set(edgeKey, pathEl)
        svg.appendChild(pathEl)
        // Label near the geometric center of the collapsed edge route.
        appendEdgeLabelAt(sx, sy, ex, ey, 0.5)
        continue
      }
    }

    // Use dagre-computed bendpoints when available; fall back to straight line.
    const bendpoints = edgeBendpoints ? edgeBendpoints.get(edgeKey) : null
    if (bendpoints && bendpoints.length >= 2) {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      pathEl.setAttribute('class', edgeClass)
      pathEl.setAttribute('fill', 'none')
      pathEl.dataset.edgeKey = edgeKey
      pathEl.dataset.from = from
      pathEl.dataset.to = to
      pathEl.setAttribute('d', buildSmoothPath(bendpoints))
      pathEl.setAttribute('marker-end', isCycleEdge ? 'url(#nextv-graph-arrow-cycle)' : 'url(#nextv-graph-arrow)')
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      title.textContent = edgeTitleText
      pathEl.appendChild(title)
      nextVGraphState.edgeElements.set(edgeKey, pathEl)
      svg.appendChild(pathEl)

      // Label near the middle of the routed path for better readability.
      const midStartIdx = Math.max(0, Math.floor((bendpoints.length - 2) / 2))
      const midEndIdx = Math.min(bendpoints.length - 1, midStartIdx + 1)
      appendEdgeLabelAt(
        bendpoints[midStartIdx].x,
        bendpoints[midStartIdx].y,
        bendpoints[midEndIdx].x,
        bendpoints[midEndIdx].y,
        0.5,
      )
      continue
    }

    // Straight-line fallback (no dagre bendpoints for this edge).
    const dx = end.x - start.x
    const dy = end.y - start.y
    const distance = Math.hypot(dx, dy) || 1
    const x1 = start.x + ((dx / distance) * fromRadius)
    const y1 = start.y + ((dy / distance) * fromRadius)
    const x2 = end.x - ((dx / distance) * toRadius)
    const y2 = end.y - ((dy / distance) * toRadius)

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('class', edgeClass)
    line.dataset.edgeKey = edgeKey
    line.dataset.from = from
    line.dataset.to = to
    line.setAttribute('x1', String(x1))
    line.setAttribute('y1', String(y1))
    line.setAttribute('x2', String(x2))
    line.setAttribute('y2', String(y2))
    line.setAttribute('marker-end', isCycleEdge ? 'url(#nextv-graph-arrow-cycle)' : 'url(#nextv-graph-arrow)')
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = edgeTitleText
    line.appendChild(title)
    nextVGraphState.edgeElements.set(edgeKey, line)
    svg.appendChild(line)
    appendEdgeLabelAt(x1, y1, x2, y2, 0.5)
  }

  for (const nodeObj of graphNodes) {
    const nodeId = nodeObj.id
    const pos = positions.get(nodeId)
    if (!pos) continue

    const nodeKind = nodeObj.kind ?? 'event'
    const isEffectNode = nodeKind === 'effect'
    const isHandlerNode = nodeKind === 'handler'
    const isEventNode = nodeKind === 'event'
    const isTimerNode = nodeKind === 'timer'
    const isControlBranchNode = nodeKind === 'control_branch'
    // Collapsed internal event nodes: position is used as edge waypoint only — no box rendered.
    const isCollapsedEvent = isEventNode && collapsibleEventIds.has(nodeId)
    if (isCollapsedEvent) continue

    const effectMeta = isEffectNode ? effectNodeById.get(nodeId) : null
    const transition = isHandlerNode ? transitionByEvent.get(nodeObj.eventType) : null
    const classification = isEffectNode
      ? effectMeta?.type === 'output'
        ? getEffectOutputClassification(effectMeta.channel)
        : 'side_effect'
      : isControlBranchNode
        ? getControlOverlayClassName(nodeObj.provenance)
      : isHandlerNode
        ? getTransitionClassName(transition?.classification)
        : '' // event and timer nodes carry no classification color

    const hasWarnings = isHandlerNode && Array.isArray(transition?.warnings) && transition.warnings.length > 0
    const hasAgentCalls = isHandlerNode && (
      (Array.isArray(transition?.agents) && transition.agents.length > 0)
      || getTransitionClassName(transition?.classification) === 'llm'
    )
    const parallelAgentCount = isHandlerNode && Array.isArray(transition?.agents) ? transition.agents.length : 0
    const hasParallelAgents = isHandlerNode && transition?.hasParallelAgents === true && parallelAgentCount > 1
    const hasParallelSingle = isHandlerNode && transition?.hasParallelAgents === true && parallelAgentCount <= 1
    const isExternal = isEventNode && externalCandidates.has(nodeId)
    const isDeclaredExternal = isEventNode && nextVGraphState.declaredExternalNodes.has(nodeId)
    const nodeContractWarnings = isEventNode ? (nextVGraphState.contractWarningNodes.get(nodeId) ?? []) : []
    const hasContractWarnings = nodeContractWarnings.length > 0

    // Emits shown on handler node tooltips.
    const emittedEvents = isHandlerNode ? (emitsByHandler.get(nodeId) ?? []).filter((t) => !effectNodeById.has(t)) : []
    const emittedEffects = isHandlerNode
      ? (emitsByHandler.get(nodeId) ?? []).filter((t) => effectNodeById.has(t)).map((t) => String(effectNodeById.get(t)?.label ?? t))
      : []

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const classStr = [
      'nextv-graph-node',
      classification,
      cycleNodes.has(nodeId) ? 'cycle' : '',
      hasWarnings ? 'warning' : '',
      isEffectNode ? 'effect' : '',
      isEventNode ? 'event-node' : '',
      isHandlerNode ? 'handler-node' : '',
      isTimerNode ? 'timer-node' : '',
      isControlBranchNode ? 'control-branch-node' : '',
      hasAgentCalls ? 'agent-node' : '',
      hasParallelAgents ? 'parallel-agent' : '',
      hasParallelSingle ? 'parallel-agent-single' : '',
      isExternal ? 'external' : '',
      isDeclaredExternal ? 'declared-external' : '',
      hasContractWarnings ? 'contract-warning' : '',
    ].filter(Boolean).join(' ')
    group.setAttribute('class', classStr)
    group.dataset.nodeId = nodeId
    if (nodeObj.eventType) group.dataset.eventType = nodeObj.eventType

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    const label = isEffectNode
      ? String(effectMeta?.label ?? nodeId)
      : isControlBranchNode
        ? String(nodeObj?.branch === 'if_true' ? 'if:true' : 'if:false')
        : isHandlerNode
          ? getNextVGraphHandlerLabel(nodeObj, transition)
          : (nodeObj.eventType ?? nodeId)
    const labelLines = isHandlerNode
      ? getNextVGraphHandlerLabelLines(nodeObj, transition)
      : [label]
    const visual = getNextVGraphNodeVisual(nodeObj, isEffectNode ? String(effectMeta?.label ?? '') : '')
    const titleParts = [label]
    if (isHandlerNode) titleParts[0] = `handler: ${nodeObj.eventType}`
    if (isTimerNode) titleParts[0] = `timer: ${nodeObj.eventType}`
    if (isControlBranchNode) titleParts[0] = `control: ${label}`
    if (isTimerNode && nodeObj.interval) titleParts.push(`interval=${nodeObj.interval}ms`)
    if (isTimerNode && nodeObj.runOnStart) titleParts.push('runOnStart=true')
    if (isControlBranchNode) titleParts.push(`provenance=${getControlProvenanceClass(nodeObj.provenance)}`)
    if (isExternal) titleParts.push('external=true')
    if (isDeclaredExternal) titleParts.push('declared-external=true')
    if (hasContractWarnings) titleParts.push(`contract-warnings=${nodeContractWarnings.map((cw) => cw.code).join(', ')}`)
    if (transition?.classification && isHandlerNode) titleParts.push(`type=${formatTransitionClassification(transition.classification)}`)
    if (emittedEvents.length > 0) titleParts.push(`emits=${emittedEvents.join(', ')}`)
    if (emittedEffects.length > 0) titleParts.push(`effects=${emittedEffects.join(', ')}`)
    if (hasParallelAgents && Array.isArray(transition?.agents) && transition.agents.length > 0) titleParts.push(`parallel=${transition.agents.join(', ')}`)
    if (Array.isArray(transition?.outputs) && transition.outputs.length > 0) titleParts.push(`outputs=${transition.outputs.join(', ')}`)
    if (Array.isArray(transition?.tools) && transition.tools.length > 0) titleParts.push(`tools=${transition.tools.map((tool) => tool.name || 'dynamic').join(', ')}`)
    if (Array.isArray(transition?.tryBoundaries) && transition.tryBoundaries.length > 0) {
      const tryBoundarySummary = transition.tryBoundaries
        .map((boundary) => {
          const operation = String(boundary?.operation ?? 'call')
          const target = String(boundary?.target ?? '').trim()
          return target ? `${operation}->${target}` : operation
        })
        .join(', ')
      titleParts.push(`try=${tryBoundarySummary}`)
    }
    if (hasWarnings) titleParts.push(`warnings=${transition.warnings.map((warning) => warning.code).join(', ')}`)
    title.textContent = titleParts.join(' | ')
    group.appendChild(title)

    if (visual.shape === 'circle') {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('class', 'nextv-graph-node-shape')
      circle.setAttribute('cx', String(pos.x))
      circle.setAttribute('cy', String(pos.y))
      circle.setAttribute('r', String(Math.round(visual.width / 2)))
      group.appendChild(circle)
    } else {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('class', 'nextv-graph-node-shape')
      rect.setAttribute('x', String(Math.round(pos.x - (visual.width / 2))))
      rect.setAttribute('y', String(Math.round(pos.y - (visual.height / 2))))
      rect.setAttribute('width', String(Math.round(visual.width)))
      rect.setAttribute('height', String(Math.round(visual.height)))
      rect.setAttribute('rx', String(visual.cornerRadius))
      rect.setAttribute('ry', String(visual.cornerRadius))
      group.appendChild(rect)
    }

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(pos.x))
    text.setAttribute('y', String(pos.y))
    text.setAttribute('dominant-baseline', 'middle')
    if (isHandlerNode) {
      text.textContent = ''
      const lineHeight = 12
      const startDy = -((labelLines.length - 1) * lineHeight) / 2
      const tspans = []
      for (let idx = 0; idx < labelLines.length; idx++) {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
        tspan.setAttribute('x', String(pos.x))
        tspan.setAttribute('dy', String(idx === 0 ? startDy : lineHeight))
        tspan.textContent = String(labelLines[idx] ?? '')
        text.appendChild(tspan)
        tspans.push(tspan)
      }
      nextVGraphState.handlerLabelLineElements.set(nodeId, tspans)
    } else {
      text.textContent = label
    }
    group.appendChild(text)

    if (isEventNode && isExternal) {
      const externalTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      externalTag.setAttribute('x', String(pos.x))
      externalTag.setAttribute('y', String(pos.y + visual.externalTagOffsetY))
      externalTag.setAttribute('class', 'nextv-graph-node-tag external')
      externalTag.textContent = 'external'
      group.appendChild(externalTag)
    }

    if (isHandlerNode && hasWarnings) {
      const wx = Math.round(pos.x + visual.width / 2)
      const wy = Math.round(pos.y - visual.height / 2)
      const warningCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      warningCircle.setAttribute('cx', String(wx))
      warningCircle.setAttribute('cy', String(wy))
      warningCircle.setAttribute('r', '8')
      warningCircle.setAttribute('class', 'nextv-graph-node-warning-bg')
      group.appendChild(warningCircle)
      const warningTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      warningTag.setAttribute('x', String(wx))
      warningTag.setAttribute('y', String(wy))
      warningTag.setAttribute('class', 'nextv-graph-node-warning')
      warningTag.textContent = '!'
      group.appendChild(warningTag)
    }

    if (isEventNode && hasContractWarnings) {
      const cx = Math.round(pos.x - visual.width / 2)
      const cy = Math.round(pos.y - visual.height / 2)
      const contractCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      contractCircle.setAttribute('cx', String(cx))
      contractCircle.setAttribute('cy', String(cy))
      contractCircle.setAttribute('r', '8')
      contractCircle.setAttribute('class', 'nextv-graph-node-contract-warning-bg')
      group.appendChild(contractCircle)
      const contractTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      contractTag.setAttribute('x', String(cx))
      contractTag.setAttribute('y', String(cy))
      contractTag.setAttribute('class', 'nextv-graph-node-contract-warning')
      contractTag.textContent = '!'
      group.appendChild(contractTag)
    }

    // Handler nodes carry the step counter label; effect nodes don't need tracking elements.
    if (isHandlerNode) {
      const stepTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      stepTag.setAttribute('x', String(pos.x + visual.badgeOffsetX))
      stepTag.setAttribute('y', String(pos.y + visual.badgeOffsetY - 2))
      stepTag.setAttribute('class', 'nextv-graph-node-step')
      stepTag.textContent = ''
      group.appendChild(stepTag)
      nextVGraphState.stepLabelElements.set(nodeId, stepTag)

      if (hasAgentCalls) {
        nextVGraphState.agentTimerLabelElements.set(nodeId, null)
      }
    }

    // Register node element by ID for runtime visual updates.
    nextVGraphState.nodeElements.set(nodeId, group)
    nodeClickHandlers.set(nodeId, () => setSelectedGraphNode(nodeId))
    group.classList.add('clickable')
    group.addEventListener('click', (event) => {
      event.stopPropagation()
      const onClick = nodeClickHandlers.get(nodeId)
      if (typeof onClick === 'function') onClick()
    })

    svg.appendChild(group)
  }

  svg.addEventListener('click', () => setSelectedGraphNode(''))
  canvas.addEventListener('click', (event) => {
    if (event.target === canvas) setSelectedGraphNode('')
  })

  canvas.appendChild(svg)
  canvas.appendChild(detailPopover)
  viewport.appendChild(canvas)
  wrap.appendChild(viewport)

  if (cycles.length > 0) {
    const cycleInfo = document.createElement('div')
    cycleInfo.className = 'nextv-graph-cycles'
    cycleInfo.textContent = `cycles: ${cycles.map((cycle) => cycle.join(' → ')).join(' • ')}`
    wrap.appendChild(cycleInfo)
  }

  if (ignoredDynamicEmits.length > 0) {
    const note = document.createElement('div')
    note.className = 'nextv-graph-note'
    const label = ignoredDynamicEmits.length === 1 ? '1 dynamic emit target ignored' : `${ignoredDynamicEmits.length} dynamic emit targets ignored`
    note.textContent = label
    wrap.appendChild(note)
  }

  nextVGraphOutput.appendChild(wrap)
  const preservedZoom = Number(viewportState?.zoom)
  nextVGraphState.zoom = preserveViewport && Number.isFinite(preservedZoom)
    ? clampNextVGraphZoom(preservedZoom)
    : getNextVGraphFitZoom()
  applyNextVGraphZoom()
  setSelectedGraphNode(nextVGraphState.selectedNodeId)
  applyNextVGraphRuntimeVisuals()
  syncNextVGraphAgentTicker()
  flushNextVGraphPendingTimerPulses()
  window.requestAnimationFrame(() => {
    if (!preserveViewport) {
      centerNextVGraphViewport()
      positionNextVGraphPopover()
      return
    }

    scheduleNextVGraphViewportRestore(viewportState)
  })
}

export async function refreshNextVGraph(options = {}) {
  const { silent = false, preserveViewport = false, viewportStateOverride = null } = options
  if (!nextVGraphOutput) return

  const entrypointPath = normalizeRelativePath(nextVEntrypointInput?.value ?? '')
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')

  if (!entrypointPath) {
    renderNextVGraphMessage('Set an entrypoint to view the graph.')
    return
  }

  if (!silent) {
    renderNextVGraphMessage('Loading graph…')
  }

  const viewport = preserveViewport ? getNextVGraphViewport() : null
  const viewportState = preserveViewport
    ? (viewportStateOverride || captureNextVGraphViewportState(viewport))
    : null

  nextVGraphState.graphRefreshInProgress = true
  try {
    const params = new URLSearchParams()
    if (workspaceDir) params.set('workspaceDir', workspaceDir)
    params.set('entrypointPath', entrypointPath)

    const res = await fetch(`/api/nextv/graph?${params.toString()}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'Unable to load nextV graph')
    }

    renderNextVGraph(data, { preserveViewport, viewportState })
    if (preserveViewport && viewportState) {
      nextVGraphState.savedViewportState = viewportState
    }
  } catch (err) {
    renderNextVGraphMessage(`Graph unavailable: ${String(err?.message ?? err)}`, 'error')
    if (!silent) {
      setStatus('nextv graph unavailable', 'responding')
    }
  } finally {
    nextVGraphState.graphRefreshInProgress = false
  }
}

export function appendNextVLogRow(line, cls = '') {
  if (!isNextVMode()) {
    appendScriptLogRow(line, cls)
    return
  }

  if (cls === 'error') {
    appendPanelLogRow(nextVConsoleOutput, line, cls)
    return
  }

  if (cls === 'content') {
    appendPanelLogRow(nextVConsoleOutput, line, cls)
    return
  }

  appendPanelLogRow(nextVEventsOutput, line, cls)
}

export function appendNextVDebugRow(label, debugPayload) {
  if (!isNextVMode()) return
  const panel = nextVEventsOutput
  if (!panel) return

  const rowId = 'nextv-debug-' + Math.random().toString(36).slice(2)
  
  // Create toggle button
  const toggleBtn = document.createElement('button')
  toggleBtn.type = 'button'
  toggleBtn.className = 'nextv-debug-toggle'
  toggleBtn.textContent = '▶'
  toggleBtn.title = 'show'
  toggleBtn.setAttribute('aria-label', 'show')
  
  // Create row with label
  const row = document.createElement('div')
  row.className = 'script-log-row result'
  row.appendChild(toggleBtn)
  row.appendChild(document.createTextNode(' ' + label))
  panel.appendChild(row)
  
  // Create debug payload element
  const debugEl = document.createElement('pre')
  debugEl.id = rowId
  debugEl.className = 'nextv-debug-payload'
  debugEl.hidden = true
  debugEl.textContent = debugPayload
  panel.appendChild(debugEl)
  
  // Attach click handler
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const isExpanded = !debugEl.hidden
    debugEl.hidden = isExpanded
    toggleBtn.textContent = isExpanded ? '▶' : '▼'
    toggleBtn.title = isExpanded ? 'show' : 'hide'
    toggleBtn.setAttribute('aria-label', isExpanded ? 'show' : 'hide')
  })
  
  panel.scrollTop = panel.scrollHeight
}

export function extractErrorLineNumber(raw) {
  const text = String(raw ?? '')
  if (!text) return 0

  const patterns = [
    /\bline\s*=\s*(\d+)\b/i,
    /\bline\s+(\d+)\b/i,
    /\bat\s+line\s+(\d+)\b/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > 0) {
      return value
    }
  }

  return 0
}

export function normalizeErrorSourcePath(raw) {
  return String(raw ?? '').trim().replace(/\\/g, '/')
}

export function extractErrorSourcePath(raw) {
  const text = String(raw ?? '')
  if (!text) return ''

  const patterns = [
    /\bfile\s*=\s*([^\s]+)/i,
    /\bsource(?:Path)?\s*=\s*([^\s]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return normalizeErrorSourcePath(match[1])
    }
  }

  return ''
}

export function formatErrorMessageWithSource(message, line, sourcePath) {
  const text = String(message ?? 'runtime error').trim() || 'runtime error'
  const lineNumber = Number(line)
  const normalizedSourcePath = normalizeErrorSourcePath(sourcePath)
  const fileLabel = normalizedSourcePath ? pathBasename(normalizedSourcePath) : ''
  const hasLine = Number.isFinite(lineNumber) && lineNumber > 0

  if (normalizedSourcePath && /\bfile\s*=\s*[^\s]+/i.test(text)) {
    return text
  }
  if (!fileLabel && !hasLine) {
    return text
  }
  if (!fileLabel && (/\bline\s*=\s*\d+\b/i.test(text) || /\bline\s+\d+\b/i.test(text) || /\bat\s+line\s+\d+\b/i.test(text))) {
    return text
  }

  const parts = []
  if (fileLabel) {
    parts.push(`file=${fileLabel}`)
  }
  if (hasLine) {
    parts.push(`line=${lineNumber}`)
  }

  return `${parts.join(' ')} ${text}`
}

export function getErrorMessageAndSource(payloadLike, fallbackMessage = 'runtime error') {
  if (payloadLike == null) {
    return { message: fallbackMessage, line: 0, sourcePath: '' }
  }

  if (typeof payloadLike === 'string') {
    return {
      message: payloadLike,
      line: extractErrorLineNumber(payloadLike),
      sourcePath: extractErrorSourcePath(payloadLike),
    }
  }

  if (payloadLike instanceof Error) {
    const message = String(payloadLike.message ?? fallbackMessage)
    const sourceLineCandidate = Number(payloadLike.sourceLine)
    const lineCandidate = Number(payloadLike.line)
    const line = Number.isFinite(sourceLineCandidate) && sourceLineCandidate > 0
      ? sourceLineCandidate
      : (Number.isFinite(lineCandidate) && lineCandidate > 0
        ? lineCandidate
        : extractErrorLineNumber(message))
    const sourcePath = normalizeErrorSourcePath(payloadLike.sourcePath) || extractErrorSourcePath(message)
    return { message, line, sourcePath }
  }

  const message = String(payloadLike.message ?? fallbackMessage)
  const sourceLineCandidate = Number(payloadLike.sourceLine)
  const lineCandidate = Number(payloadLike.line)
  const line = Number.isFinite(sourceLineCandidate) && sourceLineCandidate > 0
    ? sourceLineCandidate
    : (Number.isFinite(lineCandidate) && lineCandidate > 0
      ? lineCandidate
      : extractErrorLineNumber(message))
  const sourcePath = normalizeErrorSourcePath(payloadLike.sourcePath) || extractErrorSourcePath(message)

  return { message, line, sourcePath }
}

export function appendNextVErrorLog(payloadLike, prefix = '[nextv:error]') {
  const { message, line, sourcePath } = getErrorMessageAndSource(payloadLike)
  appendNextVLogRow(`${prefix} ${formatErrorMessageWithSource(message, line, sourcePath)}`, 'error')
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  nextVWorkspaceDirInput,
  workspace
} from './state.js'

export function normalizeRelativePath(pathValue) {
  return String(pathValue ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

export function normalizeNextVWorkspaceDir(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized || normalized === '.') return ''
  return normalized
}

export function resolveNextVPath(pathValue) {
  const pathPart = normalizeRelativePath(pathValue)
  if (!pathPart) return ''

  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!workspaceDir || workspaceDir === '.') return pathPart
  if (pathPart === workspaceDir || pathPart.startsWith(`${workspaceDir}/`)) {
    return pathPart
  }
  return `${workspaceDir}/${pathPart}`
}

export function canonicalizeFloatingPanelPath(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized) return ''

  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!workspaceDir) return normalized
  if (normalized === workspaceDir || normalized.startsWith(`${workspaceDir}/`)) return normalized
  if (normalized.startsWith('workspaces-local/') || normalized.startsWith('workspaces/')) return normalized
  return `${workspaceDir}/${normalized}`
}

export function normalizePathSegments(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized) return ''

  const parts = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

export function pathDirname(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized || !normalized.includes('/')) return ''
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

export function joinRelativePath(basePath, childPath) {
  return normalizePathSegments([basePath, childPath].filter(Boolean).join('/'))
}

export function toNextVRelativePath(workspacePath) {
  const normalizedPath = normalizeRelativePath(workspacePath)
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!normalizedPath) return ''
  if (!workspaceDir) return normalizedPath
  if (!normalizedPath.startsWith(`${workspaceDir}/`)) return normalizedPath
  return normalizedPath.slice(workspaceDir.length + 1)
}

export function normalizeGraphSourcePathForEditor(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized) return ''

  // Graph metadata can include absolute host paths; convert back to workspace-relative.
  if (/^[a-zA-Z]:\//.test(normalized)) {
    const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
    if (workspaceDir) {
      const marker = `/${workspaceDir}/`
      const markerIdx = normalized.lastIndexOf(marker)
      if (markerIdx >= 0) return normalized.slice(markerIdx + 1)
      if (normalized.endsWith(`/${workspaceDir}`)) return workspaceDir
    }

    const localWorkspaceIdx = normalized.lastIndexOf('/workspaces-local/')
    if (localWorkspaceIdx >= 0) {
      return normalized.slice(localWorkspaceIdx + 1)
    }

    return ''
  }

  return normalized
}

// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  DEFAULT_EDITOR_GRID_SPLIT_PERCENT,
  MIN_EDITOR_GRID_SPLIT_PERCENT,
  _setActiveEditorGridResize,
  _setActivePaneId,
  _setActiveScriptLine,
  _setDeleteConfirmTickerId,
  _setDeleteConfirmTimeoutId,
  _setPendingDeleteConfirmResolver,
  activeEditorGridResize,
  activePaneId,
  activeScriptLine,
  deleteConfirmTickerId,
  deleteConfirmTimeoutId,
  dirtyEditsCache,
  editorGridCenterHandle,
  editorGridSplitState,
  editorLayoutGridBtn,
  editorLayoutSplitBtn,
  editorLayoutState,
  editorPaneDescriptors,
  editorPaneStateById,
  editorPanesGrid,
  fileTree,
  filetreeDeleteConfirm,
  filetreeDeleteDesc,
  filetreeDeleteTimer,
  inputPanelState,
  nextVAutoSaveInput,
  nextVAttachWsUrlInput,
  nextVEditorTabSizeInput,
  nextVEntrypointInput,
  nextVFileState,
  nextVGraphState,
  nextVPanelState,
  nextVRuntimeTargetInput,
  nextVRuntimeTargetState,
  nextVViewState,
  nextVWorkspaceDirInput,
  openFileTabs,
  paneAssignments,
  pendingDeleteConfirmResolver,
  scriptCache,
  scriptOpenFileLabel,
  storageKeys,
  tracePanelState,
  workspace
} from './state.js'
import {
  isNextVMode,
  normalizeNextVGraphDirection,
  normalizeNextVRuntimeTarget,
  getNextVRuntimeTarget,
  setNextVPrimaryView
} from './03_ui_controls.js'
import {
  areEditorPathsEquivalent,
  syncFloatingPanelsFromEditorBuffer,
  openFloatingGraphCodePanel
} from './04_floating_panels.js'
import {
  appendNextVErrorLog
} from './07_graph_render.js'
import {
  normalizeRelativePath,
  normalizeNextVWorkspaceDir,
  resolveNextVPath,
  pathDirname,
  toNextVRelativePath
} from './08_path_utils.js'
import {
  pathBasename
} from './10_file_tree.js'
import {
  setStatus,
  appendScriptLogRow,
  syncScriptBadgeState,
  clearScriptView,
  normalizeNewlines,
  syncScriptMirrorScroll
} from './13_layout.js'

export function updateOpenFileLabel(filePath = '') {
  if (!scriptOpenFileLabel) return
  const normalized = normalizeRelativePath(filePath)
  scriptOpenFileLabel.textContent = normalized || 'no file open'
  scriptOpenFileLabel.title = normalized || 'no file open'
}

const NEXTV_EDITOR_TAB_SIZE_OPTIONS = new Set([2, 4, 8])

export function normalizeNextVEditorTabSize(value) {
  const parsed = Number(value)
  if (NEXTV_EDITOR_TAB_SIZE_OPTIONS.has(parsed)) return parsed
  return 4
}

export function getCurrentNextVEditorTabSize() {
  return normalizeNextVEditorTabSize(
    nextVEditorTabSizeInput?.value
      ?? localStorage.getItem(storageKeys.nextVEditorTabSize)
      ?? '4'
  )
}

export function applyNextVEditorTabSize(tabSize, options = {}) {
  const { persist = true } = options
  const normalized = normalizeNextVEditorTabSize(tabSize)

  if (nextVEditorTabSizeInput) {
    nextVEditorTabSizeInput.value = String(normalized)
  }

  for (const descriptor of editorPaneDescriptors.values()) {
    const textarea = descriptor?.textarea
    if (!textarea) continue
    textarea.style.tabSize = String(normalized)
    textarea.style.MozTabSize = String(normalized)
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVEditorTabSize, String(normalized))
  }

  return normalized
}

export function setNextVEditorTabSize(value) {
  const normalized = applyNextVEditorTabSize(value)
  persistNextVConfig()
  return normalized
}

export function ensureOpenFileTab(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return
  if (!nextVFileState.openTabs.includes(normalized)) {
    nextVFileState.openTabs.push(normalized)
  }
}

export function removeOpenFileTab(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return
  nextVFileState.openTabs = nextVFileState.openTabs.filter((path) => path !== normalized)
}

export async function closeOpenFileTab(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return

  for (const paneId of getPaneIds()) {
    const paneState = getPaneState(paneId)
    if (paneState.dirty && normalizeRelativePath(paneState.path) === normalized) {
      await saveCurrentEditorFile({ silent: true, paneId })
    }
  }

  const assignedPaneId = paneAssignments.get(normalized)
  if (assignedPaneId) {
    clearEditorPane(assignedPaneId)
  }
  paneAssignments.delete(normalized)

  const currentTabs = [...nextVFileState.openTabs]
  const index = currentTabs.indexOf(normalized)
  if (index === -1) return

  removeOpenFileTab(normalized)
  dirtyEditsCache.delete(normalized)
  const wasActive = normalizeRelativePath(nextVFileState.openFilePath) === normalized

  if (wasActive) {
    const nextPath = currentTabs[index + 1] || currentTabs[index - 1] || ''
    if (nextPath) {
      await openWorkspaceEditorFile(nextPath)
      persistPaneAssignments()
      renderPaneTitles()
      return
    }

    clearScriptView()
    persistNextVOpenFile('')
    renderWorkspaceTree()
  }

  persistPaneAssignments()
  renderPaneTitles()
  renderOpenFileTabs()
}

export function renderOpenFileTabs() {
  if (!openFileTabs) return
  openFileTabs.innerHTML = ''

  if (nextVFileState.openTabs.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'open-file-tabs-empty'
    empty.textContent = 'no open files'
    openFileTabs.appendChild(empty)
    return
  }

  const activePath = normalizeRelativePath(nextVFileState.openFilePath)
  const panePathById = new Map(getPaneIds().map((paneId) => [paneId, getPanePath(paneId)]))
  const focusedPath = getPanePath(activePaneId)
  const fragment = document.createDocumentFragment()

  for (const tabPath of nextVFileState.openTabs) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = `open-file-tab${tabPath === focusedPath ? ' active' : ''}`
    tab.title = tabPath
    tab.draggable = true
    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', tabPath)
      e.dataTransfer.effectAllowed = 'link'
    })

    const tabName = document.createElement('span')
    tabName.className = 'open-file-tab-name'
    const basename = pathBasename(tabPath)
    const isPaneDirty = getPaneIds().some((paneId) => {
      const paneState = getPaneState(paneId)
      return tabPath === panePathById.get(paneId) && paneState.dirty
    })
    const isAssignedToPane = getPaneIds().some((paneId) => tabPath === panePathById.get(paneId))
    const isStashedDirty = !isAssignedToPane && dirtyEditsCache.has(tabPath)
    tabName.textContent = (isPaneDirty || isStashedDirty) ? `${basename} *` : basename
    tab.appendChild(tabName)

    // Pane assignment badge
    const assignedPane = paneAssignments.get(tabPath)
    if (assignedPane) {
      const badge = document.createElement('span')
      badge.className = 'pane-badge'
      badge.dataset.pane = assignedPane
      badge.textContent = assignedPane
      tab.appendChild(badge)
    }

    const close = document.createElement('span')
    close.className = 'open-file-tab-close'
    close.textContent = 'x'
    close.title = `close ${basename}`
    close.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      try {
        await closeOpenFileTab(tabPath)
      } catch (err) {
        appendScriptLogRow(`[file:error] ${err.message}`, 'error')
        setStatus('file tab close error', 'responding')
      }
    })
    tab.appendChild(close)

    tab.addEventListener('click', async () => {
      if (normalizeRelativePath(getPaneState(activePaneId).path) === tabPath) return
      try {
        await openWorkspaceEditorFile(tabPath)
      } catch (err) {
        appendScriptLogRow(`[file:error] ${err.message}`, 'error')
        setStatus('file tab open error', 'responding')
      }
    })

    fragment.appendChild(tab)
  }

  openFileTabs.appendChild(fragment)

  // Drop zone: drag a tab here to open it in a floating panel in graph view
  const dropZone = document.createElement('div')
  dropZone.className = 'open-file-tab-graph-drop'
  dropZone.title = 'Drop a tab here to open in graph view'
  dropZone.textContent = '⬡ graph'
  dropZone.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'link'
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over')
  })
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const filePath = e.dataTransfer.getData('text/plain')
    if (!filePath) return
    setNextVPrimaryView('graph')
    await openFloatingGraphCodePanel({ filePath })
  })
  openFileTabs.appendChild(dropZone)
}

export function persistNextVOpenFile(filePath = '') {
  const normalized = normalizeRelativePath(filePath)
  nextVFileState.openFilePath = normalized
  if (normalized) ensureOpenFileTab(normalized)
  if (normalized) localStorage.setItem(storageKeys.nextVOpenFile, normalized)
  else localStorage.removeItem(storageKeys.nextVOpenFile)
  updateOpenFileLabel(normalized)
  renderOpenFileTabs()
}

export function getStoredNextVOpenFile() {
  return normalizeRelativePath(localStorage.getItem(storageKeys.nextVOpenFile) ?? '')
}

export function clearNextVAutoSaveTimer() {
  if (!nextVFileState.autoSaveTimer) return
  window.clearTimeout(nextVFileState.autoSaveTimer)
  nextVFileState.autoSaveTimer = null
}

export function rememberExpandedPath(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return
  const segments = normalized.split('/')
  let current = ''
  for (let index = 0; index < segments.length - 1; index++) {
    current = current ? `${current}/${segments[index]}` : segments[index]
    nextVFileState.expandedDirs.add(current)
  }
}

export function getTreeNodeIcon(node, expanded = false) {
  if (node?.type === 'dir') return expanded ? '▾' : '▸'

  const ext = String(node?.ext ?? '').toLowerCase()
  if (ext === '.nrv' || ext === '.wfs') return 'ƒ'
  if (ext === '.json' || ext === '.jsonc') return '{}'
  if (ext === '.md') return '≣'
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx') return 'js'
  if (ext === '.ts' || ext === '.tsx') return 'ts'
  if (ext === '.html' || ext === '.htm') return '</>'
  if (ext === '.css' || ext === '.scss') return '#'
  return '·'
}

// --- File tree context menu ---

const ctxMenu = {
  el: null,
  targetPath: null,
  targetType: null, // 'file' | 'dir' | 'root'
}

export function initFileTreeCtxMenu() {
  ctxMenu.el = document.getElementById('filetree-ctx-menu')
  document.addEventListener('click', hideFileTreeCtxMenu)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (pendingDeleteConfirmResolver) {
      onDeleteConfirmCancel()
      return
    }
    hideFileTreeCtxMenu()
  })
}

export function showFileTreeCtxMenu(event, path, type) {
  if (!ctxMenu.el) return
  event.preventDefault()
  event.stopPropagation()
  ctxMenu.targetPath = path
  ctxMenu.targetType = type

  const deleteBtn = document.getElementById('ctx-delete')
  if (deleteBtn) deleteBtn.style.display = type === 'root' ? 'none' : ''
  const renameBtn = document.getElementById('ctx-rename')
  if (renameBtn) renameBtn.style.display = type === 'root' ? 'none' : ''

  const { clientX, clientY } = event
  const menuWidth = 160
  const menuHeight = 150
  const left = (clientX + menuWidth > window.innerWidth) ? clientX - menuWidth : clientX
  const top = (clientY + menuHeight > window.innerHeight) ? clientY - menuHeight : clientY
  ctxMenu.el.style.left = `${left}px`
  ctxMenu.el.style.top = `${top}px`
  ctxMenu.el.style.display = ''
  ctxMenu.el.focus?.()
}

export function hideFileTreeCtxMenu() {
  if (ctxMenu.el) ctxMenu.el.style.display = 'none'
  ctxMenu.targetPath = null
  ctxMenu.targetType = null
}

export function clearDeleteConfirmTimers() {
  if (deleteConfirmTimeoutId != null) {
    window.clearTimeout(deleteConfirmTimeoutId)
    _setDeleteConfirmTimeoutId(null)
  }
  if (deleteConfirmTickerId != null) {
    window.clearInterval(deleteConfirmTickerId)
    _setDeleteConfirmTickerId(null)
  }
}

export function hideDeleteConfirmModal() {
  clearDeleteConfirmTimers()
  if (filetreeDeleteConfirm) {
    filetreeDeleteConfirm.style.display = 'none'
  }
}

export function resolvePendingDeleteConfirm(confirmed) {
  const resolver = pendingDeleteConfirmResolver
  _setPendingDeleteConfirmResolver(null)
  hideDeleteConfirmModal()
  if (resolver) resolver(Boolean(confirmed))
}

export function updateDeleteConfirmTimer(endAtMs) {
  if (!filetreeDeleteTimer) return
  const remainingMs = Math.max(0, endAtMs - Date.now())
  filetreeDeleteTimer.textContent = (remainingMs / 1000).toFixed(1)
}

export function buildDeleteConfirmDescription(type, targetPath) {
  const pathText = String(targetPath ?? '').trim() || '(unknown path)'
  if (type === 'dir') {
    return `Delete folder "${pathText}" and all contents?`
  }
  return `Delete file "${pathText}"?`
}

export function requestTimedDeleteConfirm(type, targetPath) {
  const canUseModal = Boolean(filetreeDeleteConfirm && filetreeDeleteDesc && filetreeDeleteTimer)
  if (!canUseModal) {
    return Promise.resolve(window.confirm(buildDeleteConfirmDescription(type, targetPath)))
  }

  if (pendingDeleteConfirmResolver) {
    resolvePendingDeleteConfirm(false)
  }

  const timeoutMs = 3000
  const endAtMs = Date.now() + timeoutMs
  filetreeDeleteDesc.textContent = buildDeleteConfirmDescription(type, targetPath)
  filetreeDeleteConfirm.style.display = ''
  updateDeleteConfirmTimer(endAtMs)
  const confirmBtn = filetreeDeleteConfirm.querySelector('.allow-btn')
  if (confirmBtn) {
    window.requestAnimationFrame(() => confirmBtn.focus())
  }

  return new Promise((resolve) => {
    _setPendingDeleteConfirmResolver(resolve)
    _setDeleteConfirmTickerId(window.setInterval(() => {
      updateDeleteConfirmTimer(endAtMs)
    }, 100))
    _setDeleteConfirmTimeoutId(window.setTimeout(() => {
      resolvePendingDeleteConfirm(false)
      setStatus('delete cancelled (timeout)', 'responding')
    }, timeoutMs))
  })
}

export function onDeleteConfirmApprove() {
  if (!pendingDeleteConfirmResolver) return
  resolvePendingDeleteConfirm(true)
}

export function onDeleteConfirmCancel() {
  if (!pendingDeleteConfirmResolver) {
    hideDeleteConfirmModal()
    return
  }
  resolvePendingDeleteConfirm(false)
  setStatus('delete cancelled')
}

export function getCtxMenuParentPath() {
  if (ctxMenu.targetType === 'dir') {
    return normalizeRelativePath(ctxMenu.targetPath)
  }
  if (ctxMenu.targetType === 'file') {
    return pathDirname(ctxMenu.targetPath)
  }
  return ''
}

export function ctxMenuNewFile() {
  const parentPath = getCtxMenuParentPath()
  hideFileTreeCtxMenu()
  showInlineNameInput(parentPath, 'file')
}

export function ctxMenuNewFolder() {
  const parentPath = getCtxMenuParentPath()
  hideFileTreeCtxMenu()
  showInlineNameInput(parentPath, 'dir')
}

export async function ctxMenuRename() {
  const path = normalizeRelativePath(ctxMenu.targetPath)
  const type = ctxMenu.targetType
  hideFileTreeCtxMenu()
  if (!path) return

  const currentName = pathBasename(path)
  const newNameRaw = window.prompt('Rename to:', currentName)
  if (newNameRaw == null) return

  const newName = String(newNameRaw).trim()
  if (!newName) {
    setStatus('rename cancelled: empty name', 'responding')
    return
  }
  if (/[/\\]/.test(newName)) {
    setStatus('rename failed: name must not contain / or \\', 'responding')
    return
  }

  if (type === 'file') {
    await doRenameFile(path, newName)
    return
  }
  if (type === 'dir') {
    await doRenameFolder(path, newName)
  }
}

export async function ctxMenuDelete() {
  const path = ctxMenu.targetPath
  const type = ctxMenu.targetType
  hideFileTreeCtxMenu()
  if (!path) return
  if (type === 'file') await doDeleteFile(path)
  else if (type === 'dir') await doDeleteFolder(path)
}

// --- Inline name input ---

export function showInlineNameInput(parentFolderPath, kind) {
  if (parentFolderPath) {
    nextVFileState.expandedDirs.add(parentFolderPath)
    renderWorkspaceTree()
  }

  const iconText = kind === 'dir' ? '▸' : '·'
  const placeholder = kind === 'dir' ? 'folder name' : 'file name'

  const wrap = document.createElement('div')
  wrap.className = 'file-tree-node filetree-inline-input-wrap'
  wrap.dataset.inlineInput = '1'

  const icon = document.createElement('span')
  icon.className = 'file-tree-icon'
  icon.textContent = iconText
  wrap.appendChild(icon)

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'filetree-inline-input'
  input.placeholder = placeholder
  input.autocomplete = 'off'
  input.spellcheck = false
  wrap.appendChild(input)

  function cleanup() {
    wrap.remove()
  }

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { cleanup(); return }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const rawName = input.value.trim()
    if (!rawName) { cleanup(); return }
    if (/[/\\]/.test(rawName)) {
      setStatus('name must not contain / or \\', 'responding')
      input.select()
      return
    }
    cleanup()
    const fullPath = parentFolderPath ? `${parentFolderPath}/${rawName}` : rawName
    if (kind === 'file') await doCreateFile(parentFolderPath, rawName, fullPath)
    else await doCreateFolder(parentFolderPath, rawName, fullPath)
  })

  input.addEventListener('blur', () => {
    // Small delay so "Enter" handler fires first
    setTimeout(() => { if (document.body.contains(wrap)) cleanup() }, 150)
  })

  if (parentFolderPath) {
    const childrenWrap = document.querySelector(`.file-tree-node-children[data-parent-path="${CSS.escape(parentFolderPath)}"]`)
    const inserted = Boolean(childrenWrap)
    if (childrenWrap) childrenWrap.appendChild(wrap)
    if (!inserted) document.getElementById('file-tree')?.appendChild(wrap)
  } else {
    document.getElementById('file-tree')?.appendChild(wrap)
  }

  requestAnimationFrame(() => input.focus())
}

// --- Create / Delete operations ---

export async function doCreateFile(parentFolderPath, name, fullPath) {
  try {
    const targetPath = resolveNextVPath(fullPath)
    if (!targetPath) {
      setStatus('create failed: invalid file path', 'responding')
      return
    }
    const res = await fetch('/api/file/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: targetPath }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(`create failed: ${data.error ?? res.status}`, 'responding')
      return
    }
    appendScriptLogRow(`[file:create] ${data.filePath}`, 'result')
    setStatus(`created ${data.filePath}`)
    rememberExpandedPath(data.filePath)
    await loadWorkspaceTree(nextVFileState.workspaceDir || '').catch(() => {})
    await openWorkspaceEditorFile(data.filePath)
  } catch (err) {
    setStatus(`create error: ${err.message}`, 'responding')
  }
}

export async function doCreateFolder(parentFolderPath, name, fullPath) {
  try {
    const targetPath = resolveNextVPath(fullPath)
    if (!targetPath) {
      setStatus('create failed: invalid folder path', 'responding')
      return
    }
    const res = await fetch('/api/folder/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: targetPath }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(`create failed: ${data.error ?? res.status}`, 'responding')
      return
    }
    appendScriptLogRow(`[folder:create] ${data.folderPath}`, 'result')
    setStatus(`created ${data.folderPath}`)
    nextVFileState.expandedDirs.add(data.folderPath)
    await loadWorkspaceTree(nextVFileState.workspaceDir || '').catch(() => {})
  } catch (err) {
    setStatus(`create error: ${err.message}`, 'responding')
  }
}

export async function doDeleteFile(filePath) {
  const confirmed = await requestTimedDeleteConfirm('file', filePath)
  if (!confirmed) return
  try {
    const res = await fetch('/api/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, kind: 'editor' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(`delete failed: ${data.error ?? res.status}`, 'responding')
      return
    }
    appendScriptLogRow(`[file:delete] ${data.filePath}`, 'result')
    setStatus(`deleted ${data.filePath}`)
    await closeOpenFileTab(filePath)
    await loadWorkspaceTree(nextVFileState.workspaceDir || '').catch(() => {})
  } catch (err) {
    setStatus(`delete error: ${err.message}`, 'responding')
  }
}

export async function doDeleteFolder(folderPath) {
  const confirmed = await requestTimedDeleteConfirm('dir', folderPath)
  if (!confirmed) return
  try {
    const res = await fetch('/api/folder', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(`delete failed: ${data.error ?? res.status}`, 'responding')
      return
    }
    appendScriptLogRow(`[folder:delete] ${data.folderPath}`, 'result')
    setStatus(`deleted ${data.folderPath}`)
    // Close any open tabs whose path starts with the deleted folder
    const prefix = normalizeRelativePath(folderPath) + '/'
    const tabsToClose = nextVFileState.openTabs.filter(
      t => normalizeRelativePath(t).startsWith(prefix) || normalizeRelativePath(t) === normalizeRelativePath(folderPath)
    )
    for (const t of tabsToClose) await closeOpenFileTab(t)
    nextVFileState.expandedDirs.delete(folderPath)
    await loadWorkspaceTree(nextVFileState.workspaceDir || '').catch(() => {})
  } catch (err) {
    setStatus(`delete error: ${err.message}`, 'responding')
  }
}

export function remapPathPrefix(pathValue, fromPrefix, toPrefix) {
  const normalizedPath = normalizeRelativePath(pathValue)
  const from = normalizeRelativePath(fromPrefix)
  const to = normalizeRelativePath(toPrefix)
  if (!normalizedPath || !from || !to) return normalizedPath
  if (normalizedPath === from) return to
  if (!normalizedPath.startsWith(`${from}/`)) return normalizedPath
  return `${to}${normalizedPath.slice(from.length)}`
}

export function remapMapKeysByPrefix(mapRef, fromPrefix, toPrefix) {
  const entries = Array.from(mapRef.entries())
  let changed = false
  for (const [key, value] of entries) {
    const remappedKey = remapPathPrefix(key, fromPrefix, toPrefix)
    if (!remappedKey || remappedKey === key) continue
    mapRef.delete(key)
    mapRef.set(remappedKey, value)
    changed = true
  }
  return changed
}

export function remapEditorStatePaths(oldPath, newPath) {
  const oldNormalized = normalizeRelativePath(oldPath)
  const newNormalized = normalizeRelativePath(newPath)
  if (!oldNormalized || !newNormalized) return

  nextVFileState.openTabs = nextVFileState.openTabs.map((path) => remapPathPrefix(path, oldNormalized, newNormalized))
  nextVFileState.openFilePath = remapPathPrefix(nextVFileState.openFilePath, oldNormalized, newNormalized)
  for (const paneId of getPaneIds()) {
    const paneState = getPaneState(paneId)
    paneState.path = remapPathPrefix(paneState.path, oldNormalized, newNormalized)
  }

  const remappedExpanded = new Set()
  for (const path of nextVFileState.expandedDirs) {
    remappedExpanded.add(remapPathPrefix(path, oldNormalized, newNormalized))
  }
  nextVFileState.expandedDirs = remappedExpanded

  remapMapKeysByPrefix(scriptCache, oldNormalized, newNormalized)
  remapMapKeysByPrefix(dirtyEditsCache, oldNormalized, newNormalized)

  const workspaceEntrypoint = resolveNextVPath(nextVEntrypointInput?.value ?? '')
  const remappedEntrypoint = remapPathPrefix(workspaceEntrypoint, oldNormalized, newNormalized)
  if (workspaceEntrypoint && remappedEntrypoint !== workspaceEntrypoint && nextVEntrypointInput) {
    nextVEntrypointInput.value = toNextVRelativePath(remappedEntrypoint)
    persistNextVConfig()
  }

  persistNextVOpenFile(nextVFileState.openFilePath)
  renderOpenFileTabs()
  syncScriptBadgeState()
}

export async function doRenameFile(filePath, newName) {
  try {
    const sourcePath = normalizeRelativePath(filePath)
    if (!sourcePath) {
      setStatus('rename failed: invalid file path', 'responding')
      return
    }

    const res = await fetch('/api/file/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: sourcePath, newName }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(`rename failed: ${data.error ?? res.status}`, 'responding')
      return
    }

    const oldPath = normalizeRelativePath(data.oldPath || sourcePath)
    const renamedPath = normalizeRelativePath(data.filePath || sourcePath)
    remapEditorStatePaths(oldPath, renamedPath)

    appendScriptLogRow(`[file:rename] ${oldPath} -> ${renamedPath}`, 'result')
    setStatus(`renamed ${pathBasename(oldPath)} to ${pathBasename(renamedPath)}`)
    rememberExpandedPath(renamedPath)
    await loadWorkspaceTree(nextVFileState.workspaceDir || '').catch(() => {})
    renderWorkspaceTree()
  } catch (err) {
    setStatus(`rename error: ${err.message}`, 'responding')
  }
}

export async function doRenameFolder(folderPath, newName) {
  try {
    const sourcePath = normalizeRelativePath(folderPath)
    if (!sourcePath) {
      setStatus('rename failed: invalid folder path', 'responding')
      return
    }

    const res = await fetch('/api/folder/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: sourcePath, newName }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setStatus(`rename failed: ${data.error ?? res.status}`, 'responding')
      return
    }

    const oldPath = normalizeRelativePath(data.oldPath || sourcePath)
    const renamedPath = normalizeRelativePath(data.folderPath || sourcePath)
    remapEditorStatePaths(oldPath, renamedPath)

    appendScriptLogRow(`[folder:rename] ${oldPath} -> ${renamedPath}`, 'result')
    setStatus(`renamed ${pathBasename(oldPath)} to ${pathBasename(renamedPath)}`)
    nextVFileState.expandedDirs.add(renamedPath)
    await loadWorkspaceTree(nextVFileState.workspaceDir || '').catch(() => {})
    renderWorkspaceTree()
  } catch (err) {
    setStatus(`rename error: ${err.message}`, 'responding')
  }
}

export function renderFileTreeNode(node) {
  const wrapper = document.createElement('div')
  wrapper.className = 'file-tree-node'
  wrapper.dataset.nodePath = normalizeRelativePath(node.path)

  const item = document.createElement('button')
  item.type = 'button'
  item.className = `file-tree-item ${node.type}`
  if (node.type === 'file' && normalizeRelativePath(node.path) === normalizeRelativePath(nextVFileState.openFilePath)) {
    item.classList.add('active')
  }

  const expanded = node.type === 'dir' ? nextVFileState.expandedDirs.has(node.path) : false

  const icon = document.createElement('span')
  icon.className = 'file-tree-icon'
  icon.textContent = getTreeNodeIcon(node, expanded)
  item.appendChild(icon)

  const name = document.createElement('span')
  name.className = 'file-tree-name'
  name.textContent = node.name
  item.appendChild(name)

  if (node.type === 'file' && node.ext) {
    const meta = document.createElement('span')
    meta.className = 'file-tree-meta'
    meta.textContent = node.ext.replace(/^\./, '') || 'text'
    item.appendChild(meta)
  }

  item.addEventListener('click', async () => {
    if (node.type === 'dir') {
      if (expanded) nextVFileState.expandedDirs.delete(node.path)
      else nextVFileState.expandedDirs.add(node.path)
      renderWorkspaceTree()
      return
    }
    try {
      ensureOpenFileTab(node.path)
      renderOpenFileTabs()
      setStatus(`opened ${node.path}`)
    } catch (err) {
      appendScriptLogRow(`[file:error] ${err.message}`, 'error')
      setStatus('file open error', 'responding')
    }
  })

  item.addEventListener('contextmenu', (e) => {
    showFileTreeCtxMenu(e, node.path, node.type)
  })

  wrapper.appendChild(item)

  if (node.type === 'dir' && expanded) {
    const childrenWrap = document.createElement('div')
    childrenWrap.className = 'file-tree-node-children'
    childrenWrap.dataset.parentPath = normalizeRelativePath(node.path)
    for (const child of node.children ?? []) {
      childrenWrap.appendChild(renderFileTreeNode(child))
    }
    wrapper.appendChild(childrenWrap)
  }

  return wrapper
}

export function renderWorkspaceTree() {
  if (!fileTree) return
  fileTree.innerHTML = ''

  const children = Array.isArray(nextVFileState.tree?.children) ? nextVFileState.tree.children : []
  if (children.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'file-tree-empty'
    empty.textContent = 'No workspace files available.'
    fileTree.appendChild(empty)
    return
  }

  const fragment = document.createDocumentFragment()
  for (const child of children) {
    fragment.appendChild(renderFileTreeNode(child))
  }
  fileTree.appendChild(fragment)
}

if (fileTree) {
  fileTree.addEventListener('contextmenu', (e) => {
    if (e.target === fileTree || e.target.classList.contains('file-tree-empty')) {
      showFileTreeCtxMenu(e, '', 'root')
    }
  })
}

export function inferEditorKind() {
  return 'editor'
}

export async function loadEditorFileContent(filePath, options = {}) {
  const normalizedPath = normalizeRelativePath(filePath)
  if (!normalizedPath) return null

  const kind = String(options.kind ?? inferEditorKind(normalizedPath))
  const url = `/api/file/content?kind=${encodeURIComponent(kind)}&filePath=${encodeURIComponent(normalizedPath)}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? 'Unable to load file content.')
  }
  return data
}

export async function loadWorkspaceTree(workspaceDir) {
  const normalizedWorkspaceDir = normalizeNextVWorkspaceDir(workspaceDir)
  const url = `/api/workspace/tree?workspaceDir=${encodeURIComponent(normalizedWorkspaceDir)}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? 'Unable to load workspace tree.')
  }

  nextVFileState.tree = {
    root: String(data.root ?? normalizedWorkspaceDir),
    children: Array.isArray(data.children) ? data.children : [],
  }
  nextVFileState.workspaceDir = normalizedWorkspaceDir
  renderWorkspaceTree()
  return nextVFileState.tree
}

export async function saveCurrentEditorFile(options = {}) {
  const paneId = options.paneId ?? activePaneId
  const state = getPaneState(paneId)
  const silent = options.silent === true
  const explicitPath = normalizeRelativePath(options.explicitPath)
  const fallbackEntrypoint = resolveNextVPath(nextVEntrypointInput?.value)
  const filePath = explicitPath || normalizeRelativePath(state.path) || fallbackEntrypoint

  if (!filePath) {
    if (!silent) setStatus('file path required to save', 'responding')
    return false
  }

  const content = normalizeNewlines(getPaneTextarea(paneId)?.value ?? '')
  const { savedPath, bytes } = await saveEditorFileContent(filePath, content)
  state.path = savedPath
  state.loadedText = content
  state.dirty = false
  syncFloatingPanelsFromEditorBuffer(savedPath, content, { markSaved: true })
  dirtyEditsCache.delete(savedPath)
  persistNextVOpenFile(savedPath)
  persistPaneAssignments()
  syncScriptBadgeState()
  renderOpenFileTabs()
  renderPaneTitles()
  renderWorkspaceTree()

  if (!silent) {
    appendScriptLogRow(`[file:save] path=${savedPath} bytes=${bytes}`, 'result')
    setStatus('file saved')
  }

  return true
}

export async function saveEditorFileContent(filePath, content) {
  const normalizedPath = normalizeRelativePath(filePath)
  if (!normalizedPath) {
    throw new Error('file path required to save')
  }

  const kind = inferEditorKind(normalizedPath)
  const payload = normalizeNewlines(String(content ?? ''))
  const res = await fetch('/api/file/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, filePath: normalizedPath, content: payload }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? 'Unable to save file')
  }

  const savedPath = normalizeRelativePath(data.filePath ?? normalizedPath)
  // Verify write by reading back from the same API surface before reporting success.
  const verify = await loadEditorFileContent(savedPath, { kind })
  const verifiedContent = normalizeNewlines(String(verify?.content ?? ''))
  if (verifiedContent !== payload) {
    throw new Error(`Save verification failed for ${savedPath}: disk content does not match saved payload.`)
  }

  scriptCache.set(savedPath, payload.split('\n'))
  return { savedPath, bytes: data.bytes ?? 0 }
}

export async function saveAllNextVFiles(options = {}) {
  const silent = options.silent === true
  const failed = []
  let savedCount = 0

  for (const tabPath of nextVFileState.openTabs) {
    const normalizedTabPath = normalizeRelativePath(tabPath)
    if (!normalizedTabPath) continue

    let content = null
    const paneIdForTab = findPaneIdByFilePath(normalizedTabPath)
    if (paneIdForTab) {
      const paneState = getPaneState(paneIdForTab)
      if (paneState.dirty) {
        content = normalizeNewlines(getPaneTextarea(paneIdForTab)?.value ?? '')
      }
    }
    if (content == null) {
      const stashed = dirtyEditsCache.get(normalizedTabPath)
      if (stashed) content = normalizeNewlines(String(stashed.content ?? ''))
    }

    if (content == null) continue

    try {
      const { savedPath, bytes } = await saveEditorFileContent(normalizedTabPath, content)
      savedCount += 1
      dirtyEditsCache.delete(normalizedTabPath)
      dirtyEditsCache.delete(savedPath)

      if (savedPath !== normalizedTabPath) {
        const tabIndex = nextVFileState.openTabs.indexOf(normalizedTabPath)
        if (tabIndex >= 0) nextVFileState.openTabs[tabIndex] = savedPath
        if (nextVFileState.openFilePath === normalizedTabPath) {
          nextVFileState.openFilePath = savedPath
        }
      }

      if (paneIdForTab) {
        const paneState = getPaneState(paneIdForTab)
        paneState.path = savedPath
        paneState.loadedText = content
        paneState.dirty = false
        syncFloatingPanelsFromEditorBuffer(savedPath, content, { markSaved: true })
        if (activePaneId === paneIdForTab) persistNextVOpenFile(savedPath)
      }

      if (!silent) {
        appendScriptLogRow(`[file:save] path=${savedPath} bytes=${bytes}`, 'result')
      }
    } catch (err) {
      failed.push({ path: normalizedTabPath, error: err })
    }
  }

  syncScriptBadgeState()
  renderOpenFileTabs()
  renderWorkspaceTree()

  if (!silent) {
    if (savedCount > 0) {
      setStatus(`saved ${savedCount} dirty tab${savedCount === 1 ? '' : 's'}`)
    } else {
      setStatus('no dirty tabs to save')
    }
    for (const item of failed) {
      appendScriptLogRow(`[file:error] ${item.path}: ${item.error.message}`, 'error')
    }
    if (failed.length > 0) {
      setStatus('save all completed with errors', 'responding')
    }
  }

  return { savedCount, failedCount: failed.length }
}

// --- Multi-pane editor helpers ---

export function getPaneIds() {
  return Array.from(editorLayoutState.paneOrder)
}

export function getPaneState(paneId) {
  const normalizedPaneId = String(paneId ?? editorLayoutState.activePaneId).trim() || editorLayoutState.activePaneId
  return editorPaneStateById.get(normalizedPaneId) ?? editorPaneStateById.get('A')
}

export function getPaneDescriptor(paneId) {
  const normalizedPaneId = String(paneId ?? editorLayoutState.activePaneId).trim() || editorLayoutState.activePaneId
  return editorPaneDescriptors.get(normalizedPaneId) ?? editorPaneDescriptors.get('A')
}

export function getPaneElements(paneId) {
  const descriptor = getPaneDescriptor(paneId)
  const normalizedPaneId = String(paneId ?? editorLayoutState.activePaneId).trim() || editorLayoutState.activePaneId
  return {
    pane: descriptor?.pane || document.getElementById(`editor-pane-${normalizedPaneId.toLowerCase()}`),
    title: descriptor?.title || document.getElementById(`pane-${normalizedPaneId.toLowerCase()}-title`),
    textarea: descriptor?.textarea || document.getElementById(normalizedPaneId === 'A' ? 'script-view' : `script-view-${normalizedPaneId.toLowerCase()}`),
    mirror: descriptor?.mirror || document.getElementById(normalizedPaneId === 'A' ? 'script-view-mirror' : `script-view-mirror-${normalizedPaneId.toLowerCase()}`),
    gutter: descriptor?.gutter || document.getElementById(normalizedPaneId === 'A' ? 'script-line-gutter' : `script-line-gutter-${normalizedPaneId.toLowerCase()}`),
  }
}

export function getPaneEditorShell(paneId) {
  const { textarea, mirror, gutter, pane } = getPaneElements(paneId)
  return textarea?.closest('.panel-editor-shell')
    || mirror?.closest('.panel-editor-shell')
    || gutter?.closest('.panel-editor-shell')
    || pane?.querySelector('.panel-editor-shell')
    || null
}

export function updatePaneGutterMetrics(paneId, lineCount) {
  const shell = getPaneEditorShell(paneId)
  if (!shell) return
  const digits = Math.max(4, String(Math.max(1, Number(lineCount) || 1)).length)
  shell.style.setProperty('--editor-gutter-width', `${digits}ch`)
}

export function getPaneTextarea(paneId) {
  return getPaneElements(paneId).textarea
}

export function getPaneMirror(paneId) {
  return getPaneElements(paneId).mirror
}

export function getPaneGutter(paneId) {
  return getPaneElements(paneId).gutter
}

export function getPaneEl(paneId) {
  return getPaneElements(paneId).pane
}

export function getPaneTitleEl(paneId) {
  return getPaneElements(paneId).title
}

export function getPanePath(paneId) {
  return normalizeRelativePath(getPaneState(paneId)?.path)
}

export function findPaneIdByFilePath(filePath) {
  const normalizedFilePath = normalizeRelativePath(filePath)
  if (!normalizedFilePath) return ''
  for (const paneId of editorLayoutState.allPanes) {
    const panePath = getPanePath(paneId)
    if (panePath && areEditorPathsEquivalent(panePath, normalizedFilePath)) return paneId
  }
  return ''
}

export function clearEditorPane(paneId) {
  const paneState = getPaneState(paneId)
  const textarea = getPaneTextarea(paneId)
  const previousPath = normalizeRelativePath(paneState.path)
  paneState.path = ''
  paneState.loadedText = ''
  paneState.dirty = false
  if (textarea) textarea.value = ''
  if (previousPath && paneAssignments.get(previousPath) === paneId) {
    paneAssignments.delete(previousPath)
  }
  renderScriptMirrorForPane(paneId, '')
}

export function focusEditorPane(paneId) {
  const normalizedPaneId = editorPaneStateById.has(paneId) ? paneId : 'A'
  _setActivePaneId(normalizedPaneId)
  editorLayoutState.activePaneId = normalizedPaneId
  for (const currentPaneId of getPaneIds()) {
    const paneEl = getPaneEl(currentPaneId)
    if (paneEl) paneEl.classList.toggle('pane-focused', currentPaneId === normalizedPaneId)
  }
}

export function clampEditorGridSplitPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_EDITOR_GRID_SPLIT_PERCENT
  return Math.max(MIN_EDITOR_GRID_SPLIT_PERCENT, Math.min(100 - MIN_EDITOR_GRID_SPLIT_PERCENT, numeric))
}

export function parseEditorGridSplitPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return clampEditorGridSplitPercent(numeric)
}

export function readStoredEditorGridSplit() {
  try {
    const raw = localStorage.getItem(storageKeys.nextVEditorGridSplit)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const xPercent = parseEditorGridSplitPercent(parsed?.xPercent)
    const yPercent = parseEditorGridSplitPercent(parsed?.yPercent)
    if (xPercent === null || yPercent === null) return null
    return { xPercent, yPercent }
  } catch {
    return null
  }
}

export function persistEditorGridSplit() {
  try {
    localStorage.setItem(storageKeys.nextVEditorGridSplit, JSON.stringify(editorGridSplitState))
  } catch {}
}

export function applyEditorGridSplit() {
  if (!editorPanesGrid) return
  editorPanesGrid.style.setProperty('--editor-grid-split-x', `${editorGridSplitState.xPercent}%`)
  editorPanesGrid.style.setProperty('--editor-grid-split-y', `${editorGridSplitState.yPercent}%`)
}

export function setEditorGridSplit(split, options = {}) {
  editorGridSplitState.xPercent = clampEditorGridSplitPercent(split?.xPercent)
  editorGridSplitState.yPercent = clampEditorGridSplitPercent(split?.yPercent)
  applyEditorGridSplit()
  if (options.persist !== false) {
    persistEditorGridSplit()
  }
}

export function stopEditorGridResize(options = {}) {
  if (!activeEditorGridResize) return
  _setActiveEditorGridResize(false)
  document.body.classList.remove('is-resizing-editor-grid')
  if (options.persist !== false) {
    persistEditorGridSplit()
  }
}

export function updateEditorGridSplitFromPointer(event) {
  if (!editorPanesGrid) return
  const rect = editorPanesGrid.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const xPercent = ((event.clientX - rect.left) / rect.width) * 100
  const yPercent = ((event.clientY - rect.top) / rect.height) * 100
  setEditorGridSplit({ xPercent, yPercent }, { persist: false })
}

export function setupEditorGridCenterHandle() {
  const storedSplit = readStoredEditorGridSplit()
  if (storedSplit) {
    setEditorGridSplit(storedSplit, { persist: false })
  } else {
    applyEditorGridSplit()
  }

  if (!editorGridCenterHandle || editorGridCenterHandle.dataset.bound === '1') return
  editorGridCenterHandle.dataset.bound = '1'

  editorGridCenterHandle.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    if (editorLayoutState.layoutMode !== 'grid-2x2') return
    _setActiveEditorGridResize(true)
    document.body.classList.add('is-resizing-editor-grid')
    updateEditorGridSplitFromPointer(event)
    event.preventDefault()
  })

  window.addEventListener('mousemove', (event) => {
    if (!activeEditorGridResize) return
    updateEditorGridSplitFromPointer(event)
  })

  window.addEventListener('mouseup', () => {
    stopEditorGridResize()
  })
}

export function setEditorLayout(mode, options = {}) {
  const panesByLayout = {
    'split-2': ['A', 'B'],
    'grid-2x2': ['A', 'B', 'C', 'D'],
  }
  const persist = options.persist !== false
  const normalizedMode = panesByLayout[mode] ? mode : 'split-2'
  editorLayoutState.layoutMode = normalizedMode
  editorLayoutState.paneOrder = panesByLayout[normalizedMode]
  if (persist) {
    localStorage.setItem(storageKeys.nextVEditorLayout, normalizedMode)
  }
  if (editorPanesGrid) editorPanesGrid.dataset.layout = normalizedMode
  for (const paneId of editorLayoutState.allPanes) {
    const els = editorPaneDescriptors.get(paneId)
    if (!els?.pane) continue
    const visible = editorLayoutState.paneOrder.includes(paneId)
    els.pane.classList.toggle('pane-hidden', !visible)
  }
  if (editorLayoutSplitBtn) {
    const isActive = normalizedMode === 'split-2'
    editorLayoutSplitBtn.classList.toggle('active', isActive)
    editorLayoutSplitBtn.setAttribute('aria-pressed', String(isActive))
  }
  if (editorLayoutGridBtn) {
    const isActive = normalizedMode === 'grid-2x2'
    editorLayoutGridBtn.classList.toggle('active', isActive)
    editorLayoutGridBtn.setAttribute('aria-pressed', String(isActive))
  }
  if (normalizedMode === 'grid-2x2') {
    applyEditorGridSplit()
  } else {
    stopEditorGridResize({ persist: false })
  }
  // If active pane is no longer visible, reset to first pane
  if (!editorLayoutState.paneOrder.includes(editorLayoutState.activePaneId)) {
    focusEditorPane(editorLayoutState.paneOrder[0])
  }
}

export function renderPaneTitles() {
  for (const paneId of getPaneIds()) {
    const panePath = getPanePath(paneId)
    const paneTitle = getPaneTitleEl(paneId)
    const paneEl = getPaneEl(paneId)
    if (paneTitle) paneTitle.textContent = panePath ? pathBasename(panePath) : '—'
    if (paneEl) paneEl.classList.toggle('pane-empty', !panePath)
  }
}

export function renderScriptMirrorForPane(paneId, textValue) {
  const mirror = getPaneMirror(paneId)
  const gutter = getPaneGutter(paneId)
  const textarea = getPaneTextarea(paneId)
  if (!mirror && !gutter) return

  if (mirror) mirror.innerHTML = ''
  if (gutter) gutter.innerHTML = ''

  const text = normalizeNewlines(textValue ?? '')
  if (!text) {
    updatePaneGutterMetrics(paneId, 1)
    if (mirror && textarea) {
      mirror.scrollTop = textarea.scrollTop
      mirror.scrollLeft = textarea.scrollLeft
    }
    if (gutter && textarea) gutter.scrollTop = textarea.scrollTop
    return
  }

  const lines = text.split('\n')
  updatePaneGutterMetrics(paneId, lines.length)
  const gutterFragment = document.createDocumentFragment()
  for (let index = 0; index < lines.length; index++) {
    if (gutter) {
      const gutterLine = document.createElement('div')
      gutterLine.className = 'script-editor-gutter-line'
      if (activeScriptLine === index + 1) {
        gutterLine.classList.add('is-active')
      }
      gutterLine.textContent = String(index + 1)
      gutterFragment.appendChild(gutterLine)
    }
  }
  if (gutter) gutter.appendChild(gutterFragment)

  if (mirror && textarea) {
    mirror.scrollTop = textarea.scrollTop
    mirror.scrollLeft = textarea.scrollLeft
  }
  if (gutter && textarea) gutter.scrollTop = textarea.scrollTop
}

export function onPaneDragOver(event, paneId) {
  if (!event.dataTransfer.types.includes('text/plain')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'link'
  getPaneEl(paneId)?.classList.add('pane-dragover')
}

export function onPaneDragLeave(event, paneId) {
  if (event.relatedTarget && getPaneEl(paneId)?.contains(event.relatedTarget)) return
  getPaneEl(paneId)?.classList.remove('pane-dragover')
}

export async function onPaneDrop(event, paneId) {
  event.preventDefault()
  getPaneEl(paneId)?.classList.remove('pane-dragover')
  const filePath = event.dataTransfer.getData('text/plain')
  if (!filePath) return
  try {
    await openWorkspaceEditorFile(filePath, { paneId })
    setStatus(`opened ${filePath}`)
  } catch (err) {
    appendScriptLogRow(`[file:error] ${err.message}`, 'error')
    setStatus('file open error', 'responding')
  }
}

export function persistPaneAssignments() {
  const obj = {}
  for (const [file, pane] of paneAssignments) obj[file] = pane
  try { localStorage.setItem('editor-pane-assignments', JSON.stringify(obj)) } catch {}
}

export function getStoredPaneAssignments(workspaceDir = '') {
  const normalizedWorkspaceDir = normalizeNextVWorkspaceDir(workspaceDir)
  const paneToFile = new Map()
  try {
    const raw = localStorage.getItem('editor-pane-assignments')
    if (!raw) return []
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return []
    for (const [file, pane] of Object.entries(obj)) {
      if (!editorPaneStateById.has(pane)) continue
      const normalizedFile = normalizeRelativePath(file)
      if (!normalizedFile) continue
      if (normalizedWorkspaceDir && !normalizedFile.startsWith(`${normalizedWorkspaceDir}/`)) continue
      paneToFile.set(pane, normalizedFile)
    }
  } catch {
    return []
  }

  return editorLayoutState.allPanes
    .filter((paneId) => paneToFile.has(paneId))
    .map((paneId) => ({ paneId, filePath: paneToFile.get(paneId) }))
}

export async function restorePaneAssignments(options = {}) {
  const workspaceDir = normalizeNextVWorkspaceDir(options.workspaceDir ?? (nextVWorkspaceDirInput?.value ?? ''))
  const preferredOpenFile = normalizeRelativePath(options.preferredOpenFile ?? '')
  const entries = getStoredPaneAssignments(workspaceDir)
  if (entries.length === 0) {
    return { restoredCount: 0, firstPath: '', focusedPath: '' }
  }

  let restoredCount = 0
  let firstPath = ''
  for (const entry of entries) {
    try {
      await openWorkspaceEditorFile(entry.filePath, { paneId: entry.paneId })
      restoredCount += 1
      if (!firstPath) firstPath = entry.filePath
    } catch {
      // best-effort restore for each pane
    }
  }

  let focusedPath = ''
  if (preferredOpenFile) {
    const preferredPaneId = paneAssignments.get(preferredOpenFile)
    if (preferredPaneId) {
      focusEditorPane(preferredPaneId)
      persistNextVOpenFile(preferredOpenFile)
      focusedPath = preferredOpenFile
    }
  }

  return { restoredCount, firstPath, focusedPath }
}

export function scheduleNextVAutoSave() {
  if (!isNextVMode()) return
  if (nextVAutoSaveInput?.checked === false) {
    clearNextVAutoSaveTimer()
    return
  }
  const hasActiveDirty = getPaneIds().some((paneId) => {
    const paneState = getPaneState(paneId)
    return Boolean(paneState.path && paneState.dirty)
  })
  const hasStashedDirty = dirtyEditsCache.size > 0
  if (!hasActiveDirty && !hasStashedDirty) return

  clearNextVAutoSaveTimer()
  nextVFileState.autoSaveTimer = window.setTimeout(async () => {
    nextVFileState.autoSaveTimer = null
    if (nextVAutoSaveInput?.checked === false) return
    try {
      const result = await saveAllNextVFiles({ silent: true })
      if (result.savedCount > 0) {
        setStatus(`autosaved ${result.savedCount} tab${result.savedCount === 1 ? '' : 's'}`)
      }
    } catch (err) {
      appendScriptLogRow(`[file:error] ${err.message}`, 'error')
      setStatus('autosave failed', 'responding')
    }
  }, 500)
}

export async function openWorkspaceEditorFile(filePath, options = {}) {
  let normalizedPath = normalizeRelativePath(filePath)
  if (!normalizedPath) return

  const hasExplicitPaneTarget = Object.prototype.hasOwnProperty.call(options, 'paneId')
  const paneId = options.paneId ?? activePaneId

  const existingPaneForPath = findPaneIdByFilePath(normalizedPath)
  if (existingPaneForPath && existingPaneForPath !== paneId && !hasExplicitPaneTarget) {
    const existingState = getPaneState(existingPaneForPath)
    focusEditorPane(existingPaneForPath)
    persistNextVOpenFile(existingState.path || normalizedPath)
    renderPaneTitles()
    syncScriptBadgeState()
    renderOpenFileTabs()
    renderWorkspaceTree()
    return
  }

  const state = getPaneState(paneId)
  const textarea = getPaneTextarea(paneId)

  const leavingPath = state.path ? normalizeRelativePath(state.path) : ''
  if (state.dirty && leavingPath && leavingPath !== normalizedPath) {
    if (nextVAutoSaveInput?.checked === false) {
      dirtyEditsCache.set(leavingPath, {
        content: normalizeNewlines(textarea?.value ?? ''),
        loadedText: state.loadedText,
      })
    } else {
      await saveCurrentEditorFile({ silent: true, paneId })
    }
  }

  const stashed = dirtyEditsCache.get(normalizedPath)
  let text, loadedText, isDirty

  if (stashed) {
    dirtyEditsCache.delete(normalizedPath)
    text = stashed.content
    loadedText = stashed.loadedText
    isDirty = true
  } else {
    const data = await loadEditorFileContent(normalizedPath, options)
    text = normalizeNewlines(String(data.content ?? ''))
    loadedText = text
    isDirty = false
    normalizedPath = normalizeRelativePath(data.filePath ?? normalizedPath)
  }

  const existingPaneId = findPaneIdByFilePath(normalizedPath)
  if (existingPaneId && existingPaneId !== paneId) {
    if (!hasExplicitPaneTarget) {
      const existingState = getPaneState(existingPaneId)
      focusEditorPane(existingPaneId)
      persistNextVOpenFile(existingState.path || normalizedPath)
      renderPaneTitles()
      syncScriptBadgeState()
      renderOpenFileTabs()
      renderWorkspaceTree()
      return
    }

    clearEditorPane(existingPaneId)
    paneAssignments.delete(normalizedPath)
    renderPaneTitles()
  }

  if (leavingPath && leavingPath !== normalizedPath && paneAssignments.get(leavingPath) === paneId) {
    paneAssignments.delete(leavingPath)
  }

  if (textarea) textarea.value = text
  state.path = normalizedPath
  state.loadedText = loadedText
  state.dirty = isDirty
  // Only sync clean floating panels when loading from disk; never overwrite dirty floating panel edits.
  syncFloatingPanelsFromEditorBuffer(normalizedPath, text, { markSaved: !isDirty, skipIfDirty: !isDirty })
  paneAssignments.set(normalizedPath, paneId)
  _setActiveScriptLine(null)
  rememberExpandedPath(state.path)
  persistNextVOpenFile(state.path)
  persistPaneAssignments()
  renderPaneTitles()
  renderScriptMirrorForPane(paneId, text)
  focusEditorPane(paneId)
  if (paneId === 'A') syncScriptMirrorScroll()
  syncScriptBadgeState()
  renderOpenFileTabs()
  renderWorkspaceTree()
}

export function refreshNextVWorkspaceTree() {
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!workspaceDir) {
    setStatus('nextv workspace required', 'responding')
    return
  }

  loadWorkspaceTree(workspaceDir)
    .then(() => {
      rememberExpandedPath(nextVFileState.openFilePath)
      renderWorkspaceTree()
      setStatus('workspace tree refreshed')
    })
    .catch((err) => {
      appendNextVErrorLog(err, '[nextv:workspace:error]')
      setStatus('workspace tree error', 'responding')
    })
}

export function setOpenFileAsNextVEntrypoint() {
  const openFilePath = getPanePath(activePaneId)
  if (!openFilePath) {
    setStatus('open a file first', 'responding')
    return
  }
  if (nextVEntrypointInput) {
    nextVEntrypointInput.value = toNextVRelativePath(openFilePath)
  }
  persistNextVConfig()
  setStatus(`entrypoint: ${toNextVRelativePath(openFilePath)}`)
}

export function persistNextVConfig() {
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const entrypointPath = normalizeRelativePath(nextVEntrypointInput?.value ?? '')
  const autoSaveEnabled = nextVAutoSaveInput?.checked !== false
  const runtimeTarget = getNextVRuntimeTarget()
  const attachWsUrl = String(nextVRuntimeTargetState.attachWsUrl ?? '').trim()
  const graphDirection = normalizeNextVGraphDirection(nextVGraphState.layoutDirection)
  const editorTabSize = getCurrentNextVEditorTabSize()

  localStorage.setItem(storageKeys.nextVWorkspaceDir, workspaceDir)
  localStorage.setItem(storageKeys.nextVEntrypoint, entrypointPath)
  localStorage.setItem(storageKeys.nextVAutoSave, autoSaveEnabled ? '1' : '0')
  localStorage.setItem(storageKeys.nextVRuntimeTarget, runtimeTarget)
  localStorage.setItem(storageKeys.nextVAttachWsUrl, attachWsUrl)
  localStorage.setItem(storageKeys.nextVGraphDirection, graphDirection)
  localStorage.setItem(storageKeys.nextVEditorTabSize, String(editorTabSize))
}

export function restoreNextVConfig() {
  const workspaceDir = normalizeNextVWorkspaceDir(localStorage.getItem(storageKeys.nextVWorkspaceDir) ?? '')
  const entrypointPath = normalizeRelativePath(localStorage.getItem(storageKeys.nextVEntrypoint) ?? '')
  const primaryView = 'graph'
  const storedAutoSave = localStorage.getItem(storageKeys.nextVAutoSave)
  const autoSaveEnabled = storedAutoSave == null ? false : storedAutoSave === '1'
  const storedDevTab = localStorage.getItem(storageKeys.nextVDevTab)
  const devTab = ['events', 'trace', 'console'].includes(storedDevTab) ? storedDevTab : 'events'
  const storedInputTab = String(localStorage.getItem(storageKeys.nextVInputTab) ?? '').trim()
  const storedRuntimeTarget = normalizeNextVRuntimeTarget(localStorage.getItem(storageKeys.nextVRuntimeTarget) ?? 'attach')
  const runtimeTarget = 'attach'
  const attachWsUrl = String(localStorage.getItem(storageKeys.nextVAttachWsUrl) ?? '').trim()
  const devConsoleOpen = localStorage.getItem(storageKeys.nextVDevConsoleOpen) !== '0'
  const graphDirection = normalizeNextVGraphDirection(localStorage.getItem(storageKeys.nextVGraphDirection) ?? 'TB')
  const controlOverlayEnabled = localStorage.getItem(storageKeys.nextVControlOverlay) !== '0'
  const showControlBranches = localStorage.getItem(storageKeys.nextVShowControlBranches) === '1'
  const storedEditorLayout = String(localStorage.getItem(storageKeys.nextVEditorLayout) ?? '').trim()
  const editorLayoutMode = storedEditorLayout === 'grid-2x2' ? 'grid-2x2' : 'split-2'
  const editorTabSize = normalizeNextVEditorTabSize(localStorage.getItem(storageKeys.nextVEditorTabSize) ?? '4')

  if (nextVWorkspaceDirInput) nextVWorkspaceDirInput.value = workspaceDir
  if (nextVEntrypointInput) nextVEntrypointInput.value = entrypointPath
  if (nextVAutoSaveInput) nextVAutoSaveInput.checked = autoSaveEnabled
  nextVRuntimeTargetState.target = runtimeTarget
  nextVRuntimeTargetState.attachWsUrl = attachWsUrl
  if (nextVRuntimeTargetInput) nextVRuntimeTargetInput.value = runtimeTarget
  if (nextVAttachWsUrlInput) nextVAttachWsUrlInput.value = attachWsUrl
  tracePanelState.currentTab = devTab
  inputPanelState.currentTab = storedInputTab || 'manual'
  nextVViewState.currentView = primaryView
  nextVPanelState.devConsoleOpen = devConsoleOpen
  nextVGraphState.layoutDirection = graphDirection
  nextVGraphState.controlOverlayEnabled = controlOverlayEnabled
  nextVGraphState.showControlBranches = showControlBranches
  editorLayoutState.layoutMode = editorLayoutMode
  editorLayoutState.paneOrder = editorLayoutMode === 'grid-2x2' ? ['A', 'B', 'C', 'D'] : ['A', 'B']
  applyNextVEditorTabSize(editorTabSize, { persist: false })
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  _setIsStateDiffResizing,
  _setNextVStateFilterQuery,
  isStateDiffResizing,
  nextVStateDiffFeed,
  nextVStateDiffPanel,
  nextVStateDiffSplitter,
  nextVStateFilterInput,
  nextVStateFilterQuery,
  nextVStateSectionOpenByKey,
  nextVStateSnapshotPane,
  storageKeys,
  workspace
} from './state.js'
import {
  isNextVMode
} from './03_ui_controls.js'

export function pathBasename(p) {
  return String(p ?? '').replace(/\\/g, '/').split('/').pop() || String(p ?? '')
}

export function formatNextVStartLine(entrypointPath, runtimeStatePath, baselineStatePath) {
  const entry = pathBasename(entrypointPath) || '(unknown)'
  const runtimeRaw = String(runtimeStatePath ?? '').trim()
  const runtime = runtimeRaw === 'in-memory' ? 'in-memory' : (pathBasename(runtimeRaw) || '(in-memory)')
  const baseline = String(baselineStatePath ?? '').trim()
  if (!baseline) {
    return `[nextv:start] entrypoint=${entry} runtime=${runtime}`
  }
  return `[nextv:start] entrypoint=${entry} runtime=${runtime} baseline=${pathBasename(baseline)}`
}

export function formatWorkspaceConfigStatus(config = {}) {
  const agentsStatus = String(config.agents ?? 'missing')
  const toolsStatus = String(config.tools ?? 'missing')
  const nextvStatus = String(config.nextv ?? 'missing')
  const operatorsStatus = String(config.operators ?? 'missing')
  const agentsSource = pathBasename(config.agentsSource) || 'agents.json'
  const toolsSource = pathBasename(config.toolsSource) || 'tools.json'
  const nextvSource = pathBasename(config.nextvSource) || 'nextv.json'
  const operatorsSource = pathBasename(config.operatorsSource) || 'operators.json'
  return `[nextv:workspace-config] agents=${agentsSource}(${agentsStatus}) tools=${toolsSource}(${toolsStatus}) nextv=${nextvSource}(${nextvStatus}) operators=${operatorsSource}(${operatorsStatus})`
}

export function formatCapabilityStatus(summary = {}, effects = {}) {
  const required = Number(summary.required ?? 0)
  const unsupported = Number(summary.unsupportedBindings ?? 0)
  const declaredEffects = Number(effects.declared ?? 0)
  const unsupportedEffects = Number(effects.unsupportedBindings ?? 0)
  const policy = String(effects.policy ?? 'warn')
  return `[nextv:capabilities] required=${required} unsupported=${unsupported} effects=${declaredEffects} effectUnsupported=${unsupportedEffects} policy=${policy}`
}

export function formatHostModulesStatus(hostModules = {}) {
  const toolProviders = Number(hostModules.toolProviders ?? 0)
  const ingressConnectors = Number(hostModules.ingressConnectors ?? 0)
  const effectRealizers = Number(hostModules.effectRealizers ?? 0)
  const workspaceDir = String(hostModules.workspaceDir ?? '').trim() || '.'
  return `[nextv:host-modules] tools=${toolProviders} ingress=${ingressConnectors} effects=${effectRealizers} workspace=${workspaceDir}`
}

export function toPrettyJson(value) {
  if (value === undefined) return '(none)'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function isObjectRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function safeJsonByteSize(value) {
  try {
    const encoded = JSON.stringify(value)
    return typeof encoded === 'string' ? encoded.length : 0
  } catch {
    return 0
  }
}

export function formatPayloadByteSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0B'
  if (value < 1024) return `${Math.round(value)}B`
  if (value < (1024 * 1024)) return `${(value / 1024).toFixed(1)}kb`
  return `${(value / (1024 * 1024)).toFixed(1)}mb`
}

export function getToolCallDetail(toolName, args) {
  const positional = Array.isArray(args?.positional) ? args.positional : []
  const named = isObjectRecord(args?.named) ? args.named : {}
  if (toolName === 'agent' || toolName === 'model') {
    const label = String(named.agent ?? named.model ?? positional[0] ?? '').trim()
    return label ? `name=${label}` : ''
  }
  if (toolName === 'file') {
    const label = String(named.path ?? positional[0] ?? '').trim()
    return label ? `path=${label}` : ''
  }
  if (toolName === 'tool') {
    const label = String(named.name ?? positional[0] ?? '').trim()
    return label ? `name=${label}` : ''
  }
  return ''
}

export function summarizeToolCallArgs(args) {
  const positional = Array.isArray(args?.positional) ? args.positional : []
  const named = isObjectRecord(args?.named) ? args.named : {}
  const positionalCount = positional.length
  const namedCount = Object.keys(named).length
  const totalCount = positionalCount + namedCount
  const sizeLabel = formatPayloadByteSize(safeJsonByteSize(args))
  return `args=${totalCount} (${positionalCount}p/${namedCount}n) size=${sizeLabel}`
}

export function summarizeToolResultPayload(result) {
  let shape = 'result=unknown'
  if (result === null) {
    shape = 'result=null'
  } else if (Array.isArray(result)) {
    shape = `result=array len=${result.length}`
  } else if (isObjectRecord(result)) {
    shape = `result=object keys=${Object.keys(result).length}`
  } else if (typeof result === 'string') {
    shape = `result=string chars=${result.length}`
  } else {
    shape = `result=${typeof result}`
  }

  const sizeLabel = formatPayloadByteSize(safeJsonByteSize(result))
  return `${shape} size=${sizeLabel}`
}

export function summarizeExecutionAgentCalls(result) {
  const agentCalls = Array.isArray(result?.agentCalls) ? result.agentCalls : []
  if (agentCalls.length === 0) return 'agentCalls=0'

  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let hasPromptTokens = false
  let hasCompletionTokens = false
  let hasTotalTokens = false

  for (const call of agentCalls) {
    const usage = call?.metadata?.usage

    const promptValue = Number(usage?.promptTokens)
    if (Number.isFinite(promptValue)) {
      promptTokens += promptValue
      hasPromptTokens = true
    }

    const completionValue = Number(usage?.completionTokens)
    if (Number.isFinite(completionValue)) {
      completionTokens += completionValue
      hasCompletionTokens = true
    }

    const totalValue = Number(usage?.totalTokens)
    if (Number.isFinite(totalValue)) {
      totalTokens += totalValue
      hasTotalTokens = true
    }
  }

  const promptLabel = hasPromptTokens ? String(promptTokens) : 'n/a'
  const completionLabel = hasCompletionTokens ? String(completionTokens) : 'n/a'
  const totalLabel = hasTotalTokens ? String(totalTokens) : 'n/a'

  return `agentCalls=${agentCalls.length} tokens=${promptLabel}/${completionLabel}/${totalLabel}`
}

export function summarizeExecutionAgentCallDetails(result) {
  const agentCalls = Array.isArray(result?.agentCalls) ? result.agentCalls : []
  if (agentCalls.length === 0) return ''

  const byAgent = new Map()

  for (const call of agentCalls) {
    const agentName = String(call?.agent ?? '').trim() || 'unknown'
    const usage = call?.metadata?.usage
    const totalValue = Number(usage?.totalTokens)

    const entry = byAgent.get(agentName) ?? {
      count: 0,
      totalTokens: 0,
      hasTotalTokens: false,
    }

    entry.count += 1
    if (Number.isFinite(totalValue)) {
      entry.totalTokens += totalValue
      entry.hasTotalTokens = true
    }

    byAgent.set(agentName, entry)
  }

  const parts = []
  for (const [agentName, entry] of byAgent.entries()) {
    const tokenLabel = entry.hasTotalTokens ? String(entry.totalTokens) : 'n/a'
    parts.push(`${agentName}=${tokenLabel} (${entry.count}x)`)
  }

  if (parts.length === 0) return ''
  return `[nextv:agent_tokens] ${parts.join(', ')}`
}

export function flattenStatePaths(value, basePath = '', out = new Map()) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.set(basePath || '[]', value)
      return out
    }
    for (let i = 0; i < value.length; i++) {
      const nextPath = basePath ? `${basePath}[${i}]` : `[${i}]`
      flattenStatePaths(value[i], nextPath, out)
    }
    return out
  }

  if (isObjectRecord(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0 && basePath) {
      out.set(basePath, value)
      return out
    }

    for (const key of keys) {
      const nextPath = basePath ? `${basePath}.${key}` : key
      flattenStatePaths(value[key], nextPath, out)
    }
    return out
  }

  out.set(basePath || '(root)', value)
  return out
}

export function buildStateDiff(previousState, nextState) {
  const previousMap = flattenStatePaths(previousState)
  const nextMap = flattenStatePaths(nextState)
  const pathSet = new Set([...previousMap.keys(), ...nextMap.keys()])
  const changes = []

  for (const path of Array.from(pathSet).sort()) {
    const hasPrev = previousMap.has(path)
    const hasNext = nextMap.has(path)
    if (!hasPrev && hasNext) {
      changes.push({ kind: 'added', path, after: nextMap.get(path) })
      continue
    }
    if (hasPrev && !hasNext) {
      changes.push({ kind: 'removed', path, before: previousMap.get(path) })
      continue
    }

    const before = previousMap.get(path)
    const after = nextMap.get(path)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ kind: 'changed', path, before, after })
    }
  }

  return changes
}

export function formatStateDiff(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return 'No state changes captured for this step.'
  }

  return changes.slice(0, 60).map((change) => {
    if (change.kind === 'added') {
      return `+ ${change.path} = ${toPrettyJson(change.after)}`
    }
    if (change.kind === 'removed') {
      return `- ${change.path} (was ${toPrettyJson(change.before)})`
    }
    return `~ ${change.path}\n  before: ${toPrettyJson(change.before)}\n  after:  ${toPrettyJson(change.after)}`
  }).join('\n')
}

export function normalizeNextVStateFilterQuery(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function formatStateSectionMeta(value) {
  if (Array.isArray(value)) return `${value.length} items`
  if (isObjectRecord(value)) return `${Object.keys(value).length} keys`
  if (typeof value === 'string') return `${value.length} chars`
  if (value === null) return 'null'
  return typeof value
}

export function isNextVStateTreeContainer(value) {
  return Array.isArray(value) || isObjectRecord(value)
}

export function formatNextVStateLeafPreview(value) {
  if (typeof value === 'string') {
    const compact = value.length > 120 ? `${value.slice(0, 117)}...` : value
    return JSON.stringify(compact)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }
  return toPrettyJson(value)
}

export function createNextVStateTreeNode(label, value, options = {}) {
  const { depth = 0 } = options
  const node = document.createElement('details')
  node.className = 'nextv-state-tree-node'
  node.open = depth < 1

  const summary = document.createElement('summary')
  summary.className = 'nextv-state-tree-summary'

  const labelSpan = document.createElement('span')
  labelSpan.className = 'nextv-state-tree-label'
  labelSpan.textContent = String(label)
  summary.appendChild(labelSpan)

  if (isNextVStateTreeContainer(value)) {
    const meta = document.createElement('span')
    meta.className = 'nextv-state-tree-meta'
    meta.textContent = formatStateSectionMeta(value)
    summary.appendChild(meta)
  } else {
    const valueSpan = document.createElement('span')
    valueSpan.className = 'nextv-state-tree-value'
    valueSpan.textContent = formatNextVStateLeafPreview(value)
    summary.appendChild(valueSpan)
  }

  node.appendChild(summary)

  if (!isNextVStateTreeContainer(value)) {
    return node
  }

  const children = document.createElement('div')
  children.className = 'nextv-state-tree-children'

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      children.appendChild(createNextVStateTreeNode(`[${i}]`, value[i], { depth: depth + 1 }))
    }
  } else {
    const keys = Object.keys(value)
    for (const key of keys) {
      children.appendChild(createNextVStateTreeNode(key, value[key], { depth: depth + 1 }))
    }
  }

  node.appendChild(children)
  return node
}

export function matchesNextVStateFilter(element, query) {
  if (!query) return true
  return String(element?.dataset?.searchText ?? '').includes(query)
}

export function applyNextVStateSearchFilter() {
  const query = nextVStateFilterQuery

  if (nextVStateDiffFeed) {
    const entries = nextVStateDiffFeed.querySelectorAll('.nextv-state-diff-entry')
    for (const entry of entries) {
      const visible = matchesNextVStateFilter(entry, query)
      entry.classList.toggle('nextv-state-hidden', !visible)
      if (query && visible && entry instanceof HTMLDetailsElement) {
        entry.open = true
      }
    }
  }

  if (nextVStateSnapshotPane) {
    const sections = nextVStateSnapshotPane.querySelectorAll('.nextv-state-section')
    for (const section of sections) {
      const visible = matchesNextVStateFilter(section, query)
      section.classList.toggle('nextv-state-hidden', !visible)
      if (query && visible && section instanceof HTMLDetailsElement) {
        section.open = true
      }
    }
  }
}

export function setNextVStateFilter(value, options = {}) {
  const { persist = true } = options
  _setNextVStateFilterQuery(normalizeNextVStateFilterQuery(value))
  if (nextVStateFilterInput && nextVStateFilterInput.value !== value) {
    nextVStateFilterInput.value = String(value ?? '')
  }
  applyNextVStateSearchFilter()
  if (persist) {
    localStorage.setItem(storageKeys.nextVStateFilter, String(value ?? ''))
  }
}

export function initNextVStatePanelTools() {
  const stored = localStorage.getItem(storageKeys.nextVStateFilter) ?? ''
  setNextVStateFilter(stored, { persist: false })

  if (!nextVStateFilterInput || nextVStateFilterInput.dataset.bound === '1') return
  nextVStateFilterInput.dataset.bound = '1'
  nextVStateFilterInput.addEventListener('input', (event) => {
    setNextVStateFilter(event.target?.value ?? '')
  })
}

export function setNextVStateCollapseAll(collapsed) {
  const shouldOpen = collapsed !== true

  if (nextVStateDiffFeed) {
    const entries = nextVStateDiffFeed.querySelectorAll('.nextv-state-diff-entry')
    for (const entry of entries) {
      if (entry.classList.contains('nextv-state-hidden')) continue
      if (entry instanceof HTMLDetailsElement) {
        entry.open = shouldOpen
      }
    }
  }

  if (nextVStateSnapshotPane) {
    const sections = nextVStateSnapshotPane.querySelectorAll('.nextv-state-section')
    for (const section of sections) {
      if (section.classList.contains('nextv-state-hidden')) continue
      if (section instanceof HTMLDetailsElement) {
        section.open = shouldOpen
        const sectionKey = section.dataset.sectionKey
        if (sectionKey) {
          nextVStateSectionOpenByKey.set(sectionKey, shouldOpen)
        }
      }
    }
  }
}

export function clearNextVStateDiff() {
  if (nextVStateDiffFeed) nextVStateDiffFeed.innerHTML = ''
}

export function clampNextVStateDiffWidth(value) {
  const numeric = Number(value)
  const maxWidth = Math.max(300, Math.min(820, Math.round(window.innerWidth * 0.7)))
  if (!Number.isFinite(numeric)) return 260
  return Math.max(220, Math.min(maxWidth, Math.round(numeric)))
}

export function persistNextVStateDiffWidth(width) {
  localStorage.setItem(storageKeys.nextVStateDiffWidth, String(clampNextVStateDiffWidth(width)))
}

export function getStoredNextVStateDiffWidth() {
  const stored = Number(localStorage.getItem(storageKeys.nextVStateDiffWidth))
  if (!Number.isFinite(stored)) return 260
  return clampNextVStateDiffWidth(stored)
}

export function toggleNextVStateDiff() {
  const panel = nextVStateDiffPanel
  const splitterEl = nextVStateDiffSplitter
  const btn = document.getElementById('toggle-nextv-state-diff-btn')
  if (!panel) return
  const collapsed = panel.classList.toggle('collapsed')
  if (collapsed) {
    panel.style.width = '0px'
  } else {
    panel.style.width = `${getStoredNextVStateDiffWidth()}px`
  }
  if (splitterEl) splitterEl.classList.toggle('collapsed', collapsed)
  if (btn) {
    btn.textContent = collapsed ? 'show state' : 'hide state'
    btn.setAttribute('aria-pressed', collapsed ? 'false' : 'true')
  }
  localStorage.setItem(storageKeys.nextVStateDiffOpen, collapsed ? '0' : '1')
}

export function initNextVStateDiffPanel() {
  const stored = localStorage.getItem(storageKeys.nextVStateDiffOpen)
  const shouldOpen = stored === '1'
  const panel = nextVStateDiffPanel
  const splitterEl = nextVStateDiffSplitter
  const btn = document.getElementById('toggle-nextv-state-diff-btn')
  if (!panel) return

  panel.classList.toggle('collapsed', !shouldOpen)
  panel.style.width = shouldOpen ? `${getStoredNextVStateDiffWidth()}px` : '0px'
  if (splitterEl) splitterEl.classList.toggle('collapsed', !shouldOpen)
  if (btn) {
    btn.textContent = shouldOpen ? 'hide state' : 'show state'
    btn.setAttribute('aria-pressed', shouldOpen ? 'true' : 'false')
  }
}

export function setupNextVStateDiffSplitter() {
  if (!nextVStateDiffSplitter || !nextVStateDiffPanel) return

  const applyStateDiffWidth = (pixels) => {
    const clamped = clampNextVStateDiffWidth(pixels)
    nextVStateDiffPanel.style.width = `${clamped}px`
    persistNextVStateDiffWidth(clamped)
  }

  nextVStateDiffSplitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode() || nextVStateDiffPanel.classList.contains('collapsed')) return
    _setIsStateDiffResizing(true)
    document.body.classList.add('is-resizing-statediff')
    event.preventDefault()
  })

  window.addEventListener('mousemove', (event) => {
    if (!isStateDiffResizing) return
    const panelRect = nextVStateDiffPanel.getBoundingClientRect()
    applyStateDiffWidth(panelRect.right - event.clientX)
  })

  window.addEventListener('mouseup', () => {
    if (!isStateDiffResizing) return
    _setIsStateDiffResizing(false)
    document.body.classList.remove('is-resizing-statediff')
  })
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  _setIsUserIOResizing,
  _setNextVEventSource,
  _setNextVHasLiveRuntimeEvents,
  _setNextVLastKnownState,
  _setNextVRuntimeRunning,
  _setTraceRowCounter,
  isUserIOResizing,
  nextVEventSource,
  nextVHasLiveRuntimeEvents,
  nextVLastKnownState,
  nextVRuntimeRunning,
  nextVStateDiffFeed,
  nextVStateSectionOpenByKey,
  nextVStateSnapshotPane,
  nextVUserIOSplitter,
  scriptEditorPanel,
  storageKeys,
  traceDetail,
  traceList,
  tracePanelState,
  traceRowCounter,
  userIOPanelState
} from './state.js'
import {
  normalizeUserOutputChannel,
  appendUserOutputMessage,
  appendUserOutputVoice,
  openVisualOutputWindow,
  parseMaybeJson
} from './02_user_output.js'
import {
  isNextVMode,
  clampNextVUserIOWidth,
  persistNextVUserIOWidth,
  setUserIOPanelOpen,
  setNextVRunControls
} from './03_ui_controls.js'
import {
  appendNextVLogRow,
  appendNextVDebugRow
} from './07_graph_render.js'
import {
  toPrettyJson,
  isObjectRecord,
  summarizeToolCallArgs,
  getToolCallDetail,
  summarizeToolResultPayload,
  buildStateDiff,
  formatStateDiff,
  normalizeNextVStateFilterQuery,
  formatStateSectionMeta,
  isNextVStateTreeContainer,
  createNextVStateTreeNode,
  applyNextVStateSearchFilter
} from './10_file_tree.js'
import {
  setStatus,
  appendErrorRow,
  escapeHtml
} from './13_layout.js'

const NEXTV_EVENT_DEDUPE_TTL_MS = 8000
const nextVRenderedEventKeys = new Map()

function normalizeEventPart(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildCanonicalEventDedupeKey(event) {
  if (!event || typeof event !== 'object') return ''
  const type = String(event.type ?? '')
  const timestamp = String(event.timestamp ?? '')
  const tool = String(event.tool ?? '')
  const agent = String(event.agent ?? '')
  const line = String(event.line ?? '')
  const statement = String(event.statement ?? '')
  const sourcePath = String(event.sourcePath ?? '')
  const sourceLine = String(event.sourceLine ?? '')
  const args = normalizeEventPart(event.args)
  const result = normalizeEventPart(event.result)
  const content = normalizeEventPart(event.content)
  const value = normalizeEventPart(event.value)
  const metadata = normalizeEventPart(event.metadata)
  return [
    type,
    timestamp,
    tool,
    agent,
    line,
    statement,
    sourcePath,
    sourceLine,
    args,
    result,
    content,
    value,
    metadata,
  ].join('|')
}

function shouldRenderCanonicalEvent(event) {
  const key = buildCanonicalEventDedupeKey(event)
  if (!key) return true
  const now = Date.now()
  const lastSeenAt = nextVRenderedEventKeys.get(key)
  if (Number.isFinite(lastSeenAt) && (now - lastSeenAt) < NEXTV_EVENT_DEDUPE_TTL_MS) {
    return false
  }
  nextVRenderedEventKeys.set(key, now)

  if (nextVRenderedEventKeys.size > 5000) {
    for (const [seenKey, seenAt] of nextVRenderedEventKeys.entries()) {
      if ((now - seenAt) >= NEXTV_EVENT_DEDUPE_TTL_MS) {
        nextVRenderedEventKeys.delete(seenKey)
      }
    }
  }
  return true
}

export function initNextVUserIOPanel() {
  const stored = localStorage.getItem(storageKeys.nextVUserIOOpen)
  const shouldOpen = stored === '1'
  setUserIOPanelOpen(shouldOpen, { persist: false })
}

export function setupNextVUserIOSplitter() {
  if (!nextVUserIOSplitter || !scriptEditorPanel) return

  const applyUserIOWidth = (pixels) => {
    const clamped = clampNextVUserIOWidth(pixels)
    scriptEditorPanel.style.width = `${clamped}px`
    persistNextVUserIOWidth(clamped)
  }

  nextVUserIOSplitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode() || !userIOPanelState.open) return
    _setIsUserIOResizing(true)
    document.body.classList.add('is-resizing-userio')
    event.preventDefault()
  })

  window.addEventListener('mousemove', (event) => {
    if (!isUserIOResizing) return
    const shell = scriptEditorPanel.parentElement
    if (!shell) return
    const shellRect = shell.getBoundingClientRect()
    applyUserIOWidth(shellRect.right - event.clientX)
  })

  window.addEventListener('mouseup', () => {
    if (!isUserIOResizing) return
    _setIsUserIOResizing(false)
    document.body.classList.remove('is-resizing-userio')
  })
}

export function appendNextVStateDiffEntry(signalType, changes) {
  if (!nextVStateDiffFeed) return
  if (!Array.isArray(changes) || changes.length === 0) return

  const entry = document.createElement('details')
  entry.className = 'nextv-state-diff-entry'
  entry.open = true

  const header = document.createElement('summary')
  header.className = 'nextv-state-diff-entry-header'
  const now = new Date()
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  const title = document.createElement('span')
  title.textContent = `▷ ${String(signalType ?? '')}`
  const meta = document.createElement('span')
  const totalChanges = Array.isArray(changes) ? changes.length : 0
  meta.textContent = `${timestamp} • ${totalChanges} ${totalChanges === 1 ? 'change' : 'changes'}`
  header.appendChild(title)
  header.appendChild(meta)
  entry.appendChild(header)

  const body = document.createElement('div')
  body.className = 'nextv-state-diff-body'
  const searchParts = [String(signalType ?? '')]

  const capped = Array.isArray(changes) ? changes.slice(0, 30) : []
  if (capped.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'nextv-diff-empty'
    empty.textContent = 'no state changes'
    body.appendChild(empty)
  } else {
    for (const change of capped) {
      const line = document.createElement('div')
      if (change.kind === 'added') {
        line.className = 'nextv-diff-line nextv-diff-added'
        line.textContent = `+ ${change.path} = ${toPrettyJson(change.after)}`
        searchParts.push(String(change.path ?? ''), toPrettyJson(change.after))
      } else if (change.kind === 'removed') {
        line.className = 'nextv-diff-line nextv-diff-removed'
        line.textContent = `- ${change.path} (was ${toPrettyJson(change.before)})`
        searchParts.push(String(change.path ?? ''), toPrettyJson(change.before))
      } else {
        line.className = 'nextv-diff-line nextv-diff-changed'
        line.textContent = `~ ${change.path}: ${toPrettyJson(change.before)} → ${toPrettyJson(change.after)}`
        searchParts.push(String(change.path ?? ''), toPrettyJson(change.before), toPrettyJson(change.after))
      }
      body.appendChild(line)
    }
    if (Array.isArray(changes) && changes.length > 30) {
      const more = document.createElement('div')
      more.className = 'nextv-diff-empty'
      more.textContent = `… ${changes.length - 30} more changes`
      body.appendChild(more)
    }
  }

  if (totalChanges > 10) {
    entry.open = false
  }

  entry.dataset.searchText = normalizeNextVStateFilterQuery(searchParts.join(' '))
  entry.appendChild(body)
  nextVStateDiffFeed.appendChild(entry)
  applyNextVStateSearchFilter()
  nextVStateDiffFeed.scrollTop = nextVStateDiffFeed.scrollHeight
}

export function buildTraceRow(event, previousState) {
  if (!event || typeof event !== 'object') return null

  const isStepTrace = event.type === 'trace' && String(event.phase ?? '') === 'after'
  const isCallTrace = event.type === 'trace_call' && String(event.phase ?? '') === 'after'
  if (!isStepTrace && !isCallTrace) return null

  const step = Number(event.step ?? 0)
  const line = Number(event.line ?? 0)
  const op = String(event.op ?? event.type ?? '')
  const statement = String(event.statement ?? '').trim()
  const stateAfter = event?.snapshot?.state
  const stateDiff = stateAfter !== undefined ? buildStateDiff(previousState, stateAfter) : []
  _setTraceRowCounter(traceRowCounter + 1)
  const rowId = `trace-${traceRowCounter}`

  return {
    id: rowId,
    step: Number.isFinite(step) ? step : 0,
    line: Number.isFinite(line) ? line : 0,
    op,
    statement,
    eventType: String(event.type ?? ''),
    phase: String(event.phase ?? ''),
    origin: String(event.origin ?? ''),
    callName: String(event.name ?? ''),
    args: event.args,
    dst: event.dst,
    result: event.result,
    stateDiff,
    stateAfter,
    localsAfter: event?.snapshot?.locals,
  }
}

export function renderTraceDetail() {
  if (!traceDetail) return
  const selected = tracePanelState.rows.find((row) => row.id === tracePanelState.selectedId)
  if (!selected) {
    traceDetail.innerHTML = '<div class="trace-empty">Select a trace row to inspect result and state diff.</div>'
    return
  }

  const detailTitle = `[${selected.step || '?'}] line ${selected.line || '?'} | ${selected.op} | ${selected.statement || '(no statement)'}`

  traceDetail.innerHTML = `
    <div class="trace-detail-title">${escapeHtml(detailTitle)}</div>
    <dl class="trace-detail-grid">
      <dt>Event</dt><dd>${escapeHtml(selected.eventType || '(none)')}</dd>
      <dt>Phase</dt><dd>${escapeHtml(selected.phase || '(none)')}</dd>
      <dt>Origin</dt><dd>${escapeHtml(selected.origin || '(none)')}</dd>
      <dt>Destination</dt><dd>${escapeHtml(toPrettyJson(selected.dst))}</dd>
    </dl>
    <div class="trace-detail-block">
      <div class="trace-detail-label">Result</div>
      <pre class="trace-detail-pre">${escapeHtml(toPrettyJson(selected.result))}</pre>
    </div>
    <div class="trace-detail-block">
      <div class="trace-detail-label">State Diff</div>
      <pre class="trace-detail-pre">${escapeHtml(formatStateDiff(selected.stateDiff))}</pre>
    </div>
    <div class="trace-detail-block">
      <div class="trace-detail-label">State After</div>
      <pre class="trace-detail-pre">${escapeHtml(toPrettyJson(selected.stateAfter))}</pre>
    </div>
  `
}

export function renderTraceList() {
  if (!traceList) return
  traceList.innerHTML = ''

  if (tracePanelState.rows.length === 0) {
    traceList.innerHTML = '<div class="trace-empty">No trace rows captured yet.</div>'
    renderTraceDetail()
    return
  }

  const fragment = document.createDocumentFragment()
  for (const row of tracePanelState.rows) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = `trace-row${row.id === tracePanelState.selectedId ? ' active' : ''}`
    item.innerHTML = `
      <div class="trace-row-main">${escapeHtml(`[${row.step || '?'}] ${row.line || '?'} | ${row.op} | ${row.statement || '(no statement)'}`)}</div>
      <div class="trace-row-meta"><span>${escapeHtml(row.eventType)}</span><span>${escapeHtml(row.phase || 'after')}</span></div>
    `
    item.addEventListener('click', () => {
      tracePanelState.selectedId = row.id
      renderTraceList()
      renderTraceDetail()
    })
    fragment.appendChild(item)
  }

  traceList.appendChild(fragment)
  renderTraceDetail()
}

export function appendTraceRows(events) {
  if (!Array.isArray(events) || events.length === 0) return

  let previousState = tracePanelState.rows.length > 0
    ? tracePanelState.rows[tracePanelState.rows.length - 1].stateAfter
    : undefined

  for (const event of events) {
    const row = buildTraceRow(event, previousState)
    if (!row) continue
    tracePanelState.rows.push(row)
    tracePanelState.selectedId = row.id
    if (row.stateAfter !== undefined) {
      previousState = row.stateAfter
    }
  }

  if (tracePanelState.rows.length > 600) {
    tracePanelState.rows = tracePanelState.rows.slice(-600)
  }

  renderTraceList()
  if (traceList) {
    traceList.scrollTop = traceList.scrollHeight
  }
}

export function clearTracePanel(options = {}) {
  const { silent = false } = options
  tracePanelState.rows = []
  tracePanelState.selectedId = ''
  renderTraceList()
  if (!silent) {
    setStatus('trace panel cleared')
  }
}

export function renderCanonicalNextVEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (!shouldRenderCanonicalEvent(event)) continue

    if (event.type === 'output') {
      const format = String(event.format ?? 'text')
      const outputChannel = normalizeUserOutputChannel(
        event.channel,
        (format === 'json' || format === 'voice') ? format : 'text',
      )
      if (format === 'text') {
        appendUserOutputMessage(String(event.content ?? ''), outputChannel)
      } else if (format === 'json') {
        const hasValue = Object.prototype.hasOwnProperty.call(event, 'value')
        const hasPayload = Object.prototype.hasOwnProperty.call(event, 'payload')
        const rawValue = hasValue
          ? event.value
          : (hasPayload ? event.payload : parseMaybeJson(event.content))
        let formatted = String(event.content ?? '')
        if (rawValue !== null && rawValue !== undefined) {
          if (typeof rawValue === 'string') {
            const parsed = parseMaybeJson(rawValue)
            if (parsed !== null) {
              try {
                formatted = JSON.stringify(parsed, null, 2)
              } catch {
                formatted = rawValue
              }
            } else {
              formatted = rawValue
            }
          } else {
            try {
              formatted = JSON.stringify(rawValue, null, 2)
            } catch {
              formatted = String(rawValue)
            }
          }
        }

        if (formatted === '[object Object]') {
          try {
            formatted = JSON.stringify(event, null, 2)
          } catch {
            // Keep fallback string
          }
        }
        appendUserOutputMessage(formatted, outputChannel)
      } else if (format === 'voice') {
        appendUserOutputVoice(event, outputChannel)
      } else if (format === 'visual') {
        if (event.visualError) {
          appendErrorRow(`[visual error] ${String(event.visualError)}`)
        }
        openVisualOutputWindow(event.visual, 'nextv visual')
      } else if (format === 'interaction') {
        const payload = Object.prototype.hasOwnProperty.call(event, 'value')
          ? event.value
          : parseMaybeJson(event.content)

        const promptText = String(
          payload?.prompt
            ?? payload?.message
            ?? payload?.title
            ?? event.content
            ?? 'Operator requests user input.'
        ).trim()

        appendUserOutputMessage(`[interaction] ${promptText}`, outputChannel)
        appendNextVLogRow('[nextv:interaction] request received (host policy decides follow-up)', 'step')
      }
      continue
    }

    if (event.type === 'tool_call') {
      const toolName = String(event.tool ?? '')
      if (toolName === 'agent' || toolName === 'model') {
        continue
      }
      const detail = getToolCallDetail(toolName, event.args)
      const detailSuffix = detail ? ` ${detail}` : ''
      appendNextVLogRow(
        `[nextv:tool_call] tool=${toolName}${detailSuffix} ${summarizeToolCallArgs(event.args)}`,
        'step'
      )
      if (event.args != null) {
        appendNextVDebugRow('[nextv:tool_call:args]', toPrettyJson(event.args))
      }
      continue
    }

    if (event.type === 'agent_call') {
      const agentName = String(event.agent ?? '').trim() || 'unknown'
      appendNextVLogRow(`[nextv:agent_call] agent=${agentName}`, 'step')
      if (event.args && typeof event.args === 'object') {
        appendNextVDebugRow('[nextv:agent_call:args]', toPrettyJson(event.args))
      }
      continue
    }

    if (event.type === 'agent_result') {
      const agentName = String(event.agent ?? '').trim() || 'unknown'
      const elapsedMs = Number(event?.metadata?.elapsedMs)
      const elapsedLabel = Number.isFinite(elapsedMs) ? ` elapsedMs=${Math.max(0, Math.round(elapsedMs))}` : ''
      appendNextVLogRow(`[nextv:agent_result] agent=${agentName}${elapsedLabel}`, 'result')

      const requestDebug = event?.metadata?.request ?? null
      const wirePayload = requestDebug && typeof requestDebug === 'object'
        ? (requestDebug.wirePayload ?? requestDebug)
        : null
      if (wirePayload) {
        appendNextVDebugRow('[nextv:agent_request:wire]', toPrettyJson(wirePayload))
      }

      const lineageAttempts = Array.isArray(event?.metadata?.retryLineage?.attempts)
        ? event.metadata.retryLineage.attempts
        : []
      if (lineageAttempts.length > 0) {
        appendNextVDebugRow('[nextv:agent_retry_lineage]', toPrettyJson(lineageAttempts))
      }
      continue
    }

    if (event.type === 'agent_error') {
      const agentName = String(event.agent ?? '').trim() || 'unknown'
      const errorCode = String(event?.metadata?.code ?? '').trim()
      const errorMessage = String(event?.metadata?.message ?? '').trim()
      const errorSuffix = errorCode ? ` code=${errorCode}` : ''
      appendNextVLogRow(`[nextv:agent_error] agent=${agentName}${errorSuffix}`, 'result')

      if (errorMessage) {
        appendNextVDebugRow('[nextv:agent_error:message]', errorMessage)
      }

      const requestDebug = event?.metadata?.request ?? null
      const wirePayload = requestDebug && typeof requestDebug === 'object'
        ? (requestDebug.wirePayload ?? requestDebug)
        : null
      if (wirePayload) {
        appendNextVDebugRow('[nextv:agent_request:wire]', toPrettyJson(wirePayload))
      }

      const lineageAttempts = Array.isArray(event?.metadata?.retryLineage?.attempts)
        ? event.metadata.retryLineage.attempts
        : []
      if (lineageAttempts.length > 0) {
        appendNextVDebugRow('[nextv:agent_retry_lineage]', toPrettyJson(lineageAttempts))
      }
      continue
    }

    if (event.type === 'tool_result') {
      const toolName = String(event.tool ?? '')
      if (toolName === 'agent' || toolName === 'model') {
        continue
      }
      appendNextVLogRow(
        `[nextv:tool_result] tool=${toolName} ${summarizeToolResultPayload(event.result)}`,
        'result'
      )
      if (event.result != null) {
        appendNextVDebugRow('[nextv:tool_result:detail]', toPrettyJson(event.result))
      }
      continue
    }

    if (event.type === 'state_update') {
      appendNextVLogRow('[nextv:state_update] debug state mutation captured', 'step')
      continue
    }

    if (event.type === 'input') {
      const source = String(event.source ?? 'external')
      appendNextVLogRow(`[nextv:input] source=${source}`, 'step')
    }
  }
}

export function renderNextVSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return
  const { log = false, skipControlUpdate = false } = options
  _setNextVRuntimeRunning(snapshot.running === true)
  if (!skipControlUpdate) {
    setNextVRunControls()
  }

  if (log) {
    appendNextVLogRow(`[nextv:snapshot] running=${nextVRuntimeRunning} executions=${Number(snapshot.executionCount ?? 0)} pending=${Number(snapshot.pendingEvents ?? 0)}`, 'result')
  }

  const nextState = snapshot.state ?? {}
  if (nextVStateSnapshotPane) {
    nextVStateSnapshotPane.innerHTML = ''

    const sectionEntries = isObjectRecord(nextState)
      ? Object.entries(nextState)
      : [['(state)', nextState]]

    if (sectionEntries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'nextv-diff-empty'
      empty.textContent = 'state is empty'
      nextVStateSnapshotPane.appendChild(empty)
    } else {
      const root = document.createElement('div')
      root.className = 'nextv-state-tree-root'

      for (const [key, value] of sectionEntries) {
        const section = document.createElement('details')
        section.className = 'nextv-state-section nextv-state-tree-root-node'
        section.dataset.sectionKey = String(key)
        section.dataset.searchText = normalizeNextVStateFilterQuery(`${key} ${toPrettyJson(value)}`)
        section.open = nextVStateSectionOpenByKey.has(String(key))
          ? nextVStateSectionOpenByKey.get(String(key)) === true
          : true

        const summary = document.createElement('summary')
        summary.className = 'nextv-state-section-header nextv-state-tree-summary'

        const title = document.createElement('span')
        title.className = 'nextv-state-section-title nextv-state-tree-label'
        title.textContent = String(key)

        const meta = document.createElement('span')
        meta.className = 'nextv-state-section-meta nextv-state-tree-meta'
        meta.textContent = formatStateSectionMeta(value)

        summary.appendChild(title)
        summary.appendChild(meta)
        section.appendChild(summary)

        const content = document.createElement('div')
        content.className = 'nextv-state-section-content'
        if (isNextVStateTreeContainer(value)) {
          if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
              content.appendChild(createNextVStateTreeNode(`[${i}]`, value[i], { depth: 1 }))
            }
          } else {
            for (const childKey of Object.keys(value)) {
              content.appendChild(createNextVStateTreeNode(childKey, value[childKey], { depth: 1 }))
            }
          }
        } else {
          const pre = document.createElement('pre')
          pre.className = 'nextv-state-section-pre'
          pre.textContent = toPrettyJson(value)
          content.appendChild(pre)
        }
        section.appendChild(content)

        section.addEventListener('toggle', () => {
          nextVStateSectionOpenByKey.set(String(key), section.open)
        })

        root.appendChild(section)
      }

      nextVStateSnapshotPane.appendChild(root)
    }

    applyNextVStateSearchFilter()
  }
  _setNextVLastKnownState(nextState)
}

export function closeNextVStream() {
  if (!nextVEventSource) return
  nextVEventSource.close()
  _setNextVEventSource(null)
  _setNextVHasLiveRuntimeEvents(false)
  nextVRenderedEventKeys.clear()
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  MIN_LEFT_PANEL_SECTION_HEIGHT,
  _setActiveVerticalResize,
  _setIsFileTreeResizing,
  _setIsRemoteControlMode,
  _setIsRemoteMode,
  _setIsRemoteRuntimeConnected,
  _setIsResizing,
  _setNextVEventSource,
  _setNextVHasLiveRuntimeEvents,
  _setNextVLastKnownState,
  _setNextVManagedProcessRunning,
  _setNextVRuntimeRunning,
  _setNextVCandidatePromotable,
  _setNextVExecutionGroups,
  _setNextVExecutionCounter,
  _setNextVEventsLiveMode,
  _setNextVEventsPausedBuffer,
  _setRemoteTransport,
  activeVerticalResize,
  fileTreePane,
  fileTreeSplitter,
  isBusy,
  isFileTreeResizing,
  isRemoteControlMode,
  isRemoteMode,
  isRemoteRuntimeConnected,
  isResizing,
  logsSection,
  nextVEntrypointInput,
  nextVEventSource,
  nextVEventSourceInput,
  nextVEventTypeInput,
  nextVEventValueInput,
  nextVCallModeInput,
  nextVCallTargetKindInput,
  nextVCallTargetAgentInput,
  nextVCallTargetInput,
  nextVCallValidateInput,
  nextVCallRetryInput,
  nextVCallInstructionsInput,
  nextVCallPromptInput,
  nextVCallReturnsInput,
  nextVCallDecideInput,
  nextVCallToolsModeInput,
  nextVCallToolsMaxRoundsInput,
  nextVCallToolsTimeoutMsInput,
  nextVCallToolsDenyUnknownInput,
  nextVCallToolsExtraInput,
  nextVCallToolsList,
  nextVCallToolsSection,
  nextVCallTargetConfigLabel,
  nextVCallTargetConfigOutput,
  nextVCallResolvedLabel,
  nextVCallResolvedOutput,
  nextVCallGeneratedCode,
  nextVCallResultTabRaw,
  nextVCallResultTabActual,
  nextVCallResultTabParsed,
  nextVCallResultTabValidation,
  nextVCallResultTabTry,
  nextVCallResultTabMetadata,
  nextVCallResultRaw,
  nextVCallResultActual,
  nextVCallResultParsed,
  nextVCallResultValidation,
  nextVCallResultTry,
  nextVCallResultMetadata,
  nextVCallInspectorPanel,
  nextVGraphState,
  nextVHasLiveRuntimeEvents,
  nextVImageCount,
  nextVImageDropzone,
  nextVImageInput,
  nextVImageList,
  nextVIngressNameInput,
  nextVIngressValueInput,
  nextVInputImageState,
  nextVLastKnownState,
  nextVManagedProcessRunning,
  nextVPanelState,
  nextVRuntimeRunning,
  nextVCandidatePromotable,
  nextVCandidateStatusRow,
  nextVCandidateStatusBadge,
  nextVCandidateIssueCount,
  activePaneId,
  nextVAttachSessionState,
  nextVRuntimeTargetState,
  nextVWorkspaceDirInput,
  nextVExecutionGroups,
  nextVExecutionCounter,
  nextVEventsLiveMode,
  nextVEventsPausedBuffer,
  nextVEventsOutput,
  outputSection,
  remoteRuntimeEntrypointPath,
  remoteRuntimeWorkspaceDir,
  remoteTransport,
  scriptSection,
  scriptVSplit1,
  scriptVSplit2,
  splitter,
  storageKeys,
  workspace
} from './state.js'
import {
  isNextVMode,
  setNextVImagesOpen,
  buildNextVApiPath,
  getNextVAttachWsUrl,
  isNextVAttachStartOverrideEnabled,
  syncNextVAttachSessionUi,
  getSelectedNextVInputChannel,
  setNextVMode,
  updateRemoteRuntimeIdentity,
  updateRemoteModeBadge,
  setNextVRunControls,
  toggleNextVCallInspectorPanel,
  clearNextVEventsOutput,
  clearNextVConsoleOutput
} from './03_ui_controls.js'
import {
  buildExecutionGroup,
  renderExecutionGroups,
  setNextVEventsLiveMode
} from './02_user_output.js'
import {
  reconcileNextVGraphAgentTimersFromExecution,
  resolveNextVGraphHandlerNodeForSource,
  resetNextVGraphRuntimeState,
  beginNextVGraphExecutionTrail,
  flashNextVGraphExternalEvent,
  flashNextVGraphSignalDispatch,
  flashNextVGraphEventValue,
  flashNextVGraphTimerPulse,
  fadeNextVGraphActiveHighlights,
  applyNextVGraphRuntimeVisuals,
  updateNextVGraphRuntimeStep,
  inferNextVGraphFallbackHandler,
  handleNextVGraphRuntimeEvent,
  finalizeNextVGraphActiveAgentTimers,
  extractExecutionAgentElapsedMs
} from './06_graph_runtime.js'
import {
  refreshNextVGraph,
  appendNextVLogRow,
  getErrorMessageAndSource,
  appendNextVErrorLog
} from './07_graph_render.js'
import {
  normalizeRelativePath,
  normalizeNextVWorkspaceDir
} from './08_path_utils.js'
import {
  persistNextVConfig
} from './09_editor.js'
import {
  getPaneTextarea
} from './09_editor.js'
import {
  pathBasename,
  formatNextVStartLine,
  formatWorkspaceConfigStatus,
  formatCapabilityStatus,
  formatHostModulesStatus,
  summarizeExecutionAgentCalls,
  summarizeExecutionAgentCallDetails,
  buildStateDiff,
  clearNextVStateDiff
} from './10_file_tree.js'
import {
  appendNextVStateDiffEntry,
  appendTraceRows,
  clearTracePanel,
  renderCanonicalNextVEvents,
  renderNextVSnapshot,
  closeNextVStream
} from './11_state_panels.js'
import {
  setStatus,
  appendErrorRow,
  ensureNextVEntrypointVisible,
  saveNextVEntrypoint,
  openNextVWorkspace
} from './13_layout.js'

let bufferedRuntimeEventsForExecution = []
let pendingAgentCallCount = 0
const MAX_SEEN_EXECUTION_EVENT_KEYS = 20000
let seenExecutionEventKeys = new Set()
let seenExecutionEventKeyOrder = []
let executionSnapshotFallbackTimer = null

function formatPendingCallLabel(count) {
  return count === 1
    ? 'nextv waiting for model response...'
    : `nextv waiting for model responses (${count})...`
}

function toExecutionEventKey(event) {
  if (!event || typeof event !== 'object') return ''
  const type = String(event.type ?? '').trim()
  const timestamp = String(event.timestamp ?? '').trim()
  const tool = String(event.tool ?? '').trim()
  const agent = String(event.agent ?? '').trim()
  const sourcePath = String(event.sourcePath ?? '').trim()
  const sourceLine = Number.isFinite(Number(event.sourceLine)) ? String(Number(event.sourceLine)) : ''
  const line = Number.isFinite(Number(event.line)) ? String(Number(event.line)) : ''
  return [type, timestamp, tool, agent, sourcePath, sourceLine, line].join('|')
}

function resetSeenExecutionEventKeys() {
  seenExecutionEventKeys = new Set()
  seenExecutionEventKeyOrder = []
}

function rememberSeenExecutionEvent(event) {
  const key = toExecutionEventKey(event)
  if (!key || seenExecutionEventKeys.has(key)) return
  seenExecutionEventKeys.add(key)
  seenExecutionEventKeyOrder.push(key)
  if (seenExecutionEventKeyOrder.length > MAX_SEEN_EXECUTION_EVENT_KEYS) {
    const pruneCount = seenExecutionEventKeyOrder.length - MAX_SEEN_EXECUTION_EVENT_KEYS
    for (let i = 0; i < pruneCount; i++) {
      const staleKey = seenExecutionEventKeyOrder.shift()
      if (staleKey) seenExecutionEventKeys.delete(staleKey)
    }
  }
}

function filterFreshExecutionEvents(events) {
  const list = Array.isArray(events) ? events : []
  const fresh = []
  for (const event of list) {
    const key = toExecutionEventKey(event)
    if (!key) {
      fresh.push(event)
      continue
    }
    if (seenExecutionEventKeys.has(key)) continue
    rememberSeenExecutionEvent(event)
    fresh.push(event)
  }
  return fresh
}

function cancelExecutionSnapshotFallback() {
  if (executionSnapshotFallbackTimer !== null) {
    clearTimeout(executionSnapshotFallbackTimer)
    executionSnapshotFallbackTimer = null
  }
}

async function fetchAndRenderLatestSnapshot() {
  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/snapshot'))
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return
    if (data?.snapshot) {
      renderNextVSnapshot(data.snapshot)
    }
  } catch {
    // best-effort fallback only
  }
}

function scheduleExecutionSnapshotFallback() {
  cancelExecutionSnapshotFallback()
  executionSnapshotFallbackTimer = setTimeout(() => {
    executionSnapshotFallbackTimer = null
    void fetchAndRenderLatestSnapshot()
  }, 140)
}

function mergeExecutionEventsWithLiveRuntimeEvents(executionEvents, runtimeEvents) {
  const left = Array.isArray(executionEvents) ? executionEvents : []
  const right = Array.isArray(runtimeEvents) ? runtimeEvents : []
  if (right.length === 0) return left
  if (left.length === 0) return right

  const merged = []
  const seen = new Set()

  for (const event of [...left, ...right]) {
    const key = toExecutionEventKey(event)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    merged.push(event)
  }

  return merged
}

function buildNextVAttachApiPath(pathname) {
  const params = new URLSearchParams()
  params.set('runtimeTarget', 'attach')
  const attachWsUrl = getNextVAttachWsUrl()
  if (attachWsUrl) {
    params.set('attachWsUrl', attachWsUrl)
  }
  return `${pathname}?${params.toString()}`
}

function normalizeEntrypointForWorkspace(entrypointPathRaw, workspaceDirRaw) {
  const entrypointPath = normalizeRelativePath(entrypointPathRaw)
  if (!entrypointPath) return ''

  const workspaceDir = normalizeNextVWorkspaceDir(workspaceDirRaw)
  if (!workspaceDir) return entrypointPath
  if (entrypointPath === workspaceDir) return ''
  if (entrypointPath.startsWith(`${workspaceDir}/`)) {
    return entrypointPath.slice(workspaceDir.length + 1)
  }
  return entrypointPath
}

function getRemoteRuntimeIdentityFromPayload(data) {
  const workspaceDir = String(
    data?.remoteRuntimeWorkspaceDir
    ?? data?.workspaceDir
    ?? data?.remoteConnection?.workspaceDir
    ?? data?.snapshot?.workspaceDir
    ?? ''
  ).trim()
  const entrypointPathRaw = String(
    data?.remoteRuntimeEntrypointPath
    ?? data?.entrypointPath
    ?? data?.remoteConnection?.entrypointPath
    ?? data?.snapshot?.entrypointPath
    ?? ''
  ).trim()
  const entrypointPath = normalizeEntrypointForWorkspace(entrypointPathRaw, workspaceDir)
  return { workspaceDir, entrypointPath }
}

function shouldHydrateLocalConfigFromRemoteSnapshot(data) {
  if (data?.remoteMode !== true || data?.remoteControl !== true) return false
  if (nextVRuntimeTargetState.target !== 'attach') return true
  return !isNextVAttachStartOverrideEnabled()
}

function hydrateNextVInputsFromRemoteSnapshot(data, options = {}) {
  const { persistEntrypoint = false } = options
  const identity = getRemoteRuntimeIdentityFromPayload(data)
  const normalizedWorkspaceDir = identity.workspaceDir === '.' ? '' : identity.workspaceDir

  let workspaceChanged = false
  let entrypointChanged = false

  if (nextVWorkspaceDirInput && identity.workspaceDir) {
    const currentWorkspace = String(nextVWorkspaceDirInput.value ?? '').trim()
    if (currentWorkspace !== normalizedWorkspaceDir) {
      nextVWorkspaceDirInput.value = normalizedWorkspaceDir
      workspaceChanged = true
    }
  }

  if (nextVEntrypointInput && identity.entrypointPath) {
    const currentEntrypoint = normalizeRelativePath(nextVEntrypointInput.value ?? '')
    if (currentEntrypoint !== identity.entrypointPath) {
      nextVEntrypointInput.value = identity.entrypointPath
      entrypointChanged = true
      if (persistEntrypoint) {
        saveNextVEntrypoint()
      }
    }
  }

  return {
    workspaceDir: normalizedWorkspaceDir,
    entrypointPath: identity.entrypointPath,
    workspaceChanged,
    entrypointChanged,
  }
}

function readToolErrorMessageFromRuntimeEvent(runtimeEvent) {
  if (!runtimeEvent || typeof runtimeEvent !== 'object') return ''
  if (String(runtimeEvent?.type ?? '').trim() !== 'tool_result') return ''

  const toolName = String(runtimeEvent?.tool ?? '').trim()
  const result = runtimeEvent?.result
  if (!result || typeof result !== 'object') return ''

  const explicitError = typeof result.error === 'string'
    ? result.error
    : (result?.error && typeof result.error === 'object' && typeof result.error.message === 'string'
      ? result.error.message
      : '')
  const explicitMessage = typeof result.message === 'string' ? result.message : ''
  const didFail = result.ok === false || Boolean(explicitError) || Boolean(explicitMessage)
  if (!didFail) return ''

  const message = explicitError || explicitMessage || 'tool call failed'
  return toolName ? `tool("${toolName}") failed: ${message}` : message
}

export async function attachNextVRuntime() {
  if (nextVRuntimeTargetState.target !== 'attach') {
    setStatus('select attach WS runtime target first', 'responding')
    return
  }

  const attachWsUrl = getNextVAttachWsUrl()
  if (!attachWsUrl) {
    nextVAttachSessionState.lastError = 'attach ws url is required'
    syncNextVAttachSessionUi()
    setStatus('attach ws url required', 'responding')
    return
  }

  nextVAttachSessionState.connecting = true
  nextVAttachSessionState.attached = false
  nextVAttachSessionState.lastError = ''
  syncNextVAttachSessionUi()
  setStatus('attaching to remote runtime...')

  try {
    const res = await fetch(buildNextVAttachApiPath('/api/nextv/snapshot'))
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'attach failed')
    }

    const remoteIdentity = hydrateNextVInputsFromRemoteSnapshot(data, { persistEntrypoint: true })

    // Hydrate tree/editor/graph automatically from attached runtime identity.
    updateRemoteRuntimeIdentity(data)
    if (remoteIdentity.workspaceDir && isNextVMode()) {
      try {
        await openNextVWorkspace()
      } catch (workspaceErr) {
        appendNextVErrorLog(workspaceErr, '[nextv:attach:workspace:auto-open:error]')
      }
    }

    await refreshNextVCallInspectorAgents({ quiet: true })

    nextVAttachSessionState.attached = true
    nextVAttachSessionState.connecting = false
    nextVAttachSessionState.lastError = ''
    syncNextVAttachSessionUi()
    await syncNextVRuntimeState()
    setStatus('attached to remote runtime')
  } catch (err) {
    nextVAttachSessionState.connecting = false
    nextVAttachSessionState.attached = false
    nextVAttachSessionState.lastError = String(err?.message ?? err)
    syncNextVAttachSessionUi()
    _setIsRemoteMode(true)
    _setIsRemoteControlMode(true)
    _setRemoteTransport('ws')
    _setIsRemoteRuntimeConnected(false)
    _setNextVRuntimeRunning(false)
    updateRemoteRuntimeIdentity(null, { clear: true })
    updateRemoteModeBadge()
    closeNextVStream()
    setNextVRunControls()
    setStatus('attach failed', 'responding')
  }
}

export function detachNextVRuntime() {
  nextVAttachSessionState.connecting = false
  nextVAttachSessionState.attached = false
  nextVAttachSessionState.lastError = ''
  syncNextVAttachSessionUi()
  _setIsRemoteMode(true)
  _setIsRemoteControlMode(true)
  _setRemoteTransport('ws')
  _setIsRemoteRuntimeConnected(false)
  _setNextVRuntimeRunning(false)
  _setNextVManagedProcessRunning(false)
  updateRemoteRuntimeIdentity(null, { clear: true })
  updateRemoteModeBadge()
  closeNextVStream()
  setNextVRunControls()
  setStatus('detached from remote runtime')
}

export function openNextVStream() {
  closeNextVStream()
  _setNextVEventSource(new EventSource(buildNextVApiPath('/api/nextv/stream')))

  nextVEventSource.addEventListener('nextv_stream_open', () => {
    // no-op
  })

  nextVEventSource.addEventListener('nextv_snapshot', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      renderNextVSnapshot(payload.snapshot)
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_started', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      resetSeenExecutionEventKeys()
      bufferedRuntimeEventsForExecution = []
      _setNextVHasLiveRuntimeEvents(false)
      resetNextVGraphRuntimeState({ keepExternalNodes: false })
      applyNextVGraphRuntimeVisuals()
      _setNextVLastKnownState(null)
      clearNextVStateDiff()
      // Surface startup init in the graph immediately, even before the first queued external event.
      flashNextVGraphSignalDispatch('init')
      const runtimeStatePath = payload.runtimeStatePath ?? payload.statePath
      appendNextVLogRow(formatNextVStartLine(payload.entrypointPath, runtimeStatePath, payload.baselineStatePath), 'step')
      if (payload?.workspaceConfig && typeof payload.workspaceConfig === 'object') {
        appendNextVLogRow(formatWorkspaceConfigStatus(payload.workspaceConfig), 'result')
      }
      if (payload?.trace && typeof payload.trace === 'object') {
        appendNextVLogRow(`[nextv:trace] enabled=${payload.trace.enabled === true} state=${payload.trace.includeState === true}`, 'result')
      }
      if (payload?.capabilities && typeof payload.capabilities === 'object') {
        appendNextVLogRow(formatCapabilityStatus(payload.capabilities, payload.effects), 'result')
      }
      if (payload?.hostModules && typeof payload.hostModules === 'object') {
        appendNextVLogRow(formatHostModulesStatus(payload.hostModules), 'result')
      }
      const initState = payload?.snapshot?.state ?? {}
      appendNextVStateDiffEntry('init', buildStateDiff({}, initState))
      _setNextVLastKnownState(initState)
      renderNextVSnapshot(payload.snapshot)
      setStatus('nextv runtime started')
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_runtime_event', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const runtimeEvent = payload?.runtimeEvent
      if (!runtimeEvent || typeof runtimeEvent !== 'object') return

      bufferedRuntimeEventsForExecution.push(runtimeEvent)
      if (bufferedRuntimeEventsForExecution.length > 500) {
        bufferedRuntimeEventsForExecution = bufferedRuntimeEventsForExecution.slice(-500)
      }
      rememberSeenExecutionEvent(runtimeEvent)

      _setNextVHasLiveRuntimeEvents(true)
      handleNextVGraphRuntimeEvent(runtimeEvent)
      renderCanonicalNextVEvents([runtimeEvent])
      appendTraceRows([runtimeEvent])
        applyNextVGraphRuntimeVisuals()

      const runtimeEventType = String(runtimeEvent?.type ?? '').trim()
      if (runtimeEventType === 'agent_call') {
        pendingAgentCallCount += 1
        setStatus(formatPendingCallLabel(pendingAgentCallCount), 'thinking')
      } else if (runtimeEventType === 'agent_result' || runtimeEventType === 'agent_error') {
        pendingAgentCallCount = Math.max(0, pendingAgentCallCount - 1)
        if (pendingAgentCallCount > 0) {
          setStatus(formatPendingCallLabel(pendingAgentCallCount), 'thinking')
        } else {
          setStatus(runtimeEventType === 'agent_error' ? 'nextv model call failed' : 'nextv model response received')
        }
      }

      const toolFailureMessage = readToolErrorMessageFromRuntimeEvent(runtimeEvent)
      if (toolFailureMessage) {
        appendNextVErrorLog({ message: toolFailureMessage }, '[nextv:tool_error]')
        setStatus('nextv tool error', 'responding')
      }

      if (
        runtimeEventType === 'output'
        || runtimeEventType === 'agent_result'
        || runtimeEventType === 'agent_error'
        || runtimeEventType === 'state_update'
      ) {
        scheduleExecutionSnapshotFallback()
      }
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_execution', (evt) => {
    try {
      cancelExecutionSnapshotFallback()
      const payload = JSON.parse(evt.data)
      const eventType = String(payload?.event?.type ?? '')
      const source = String(payload?.event?.source ?? '')
      const executionSnapshot = payload?.snapshot && typeof payload.snapshot === 'object'
        ? payload.snapshot
        : null
      if (executionSnapshot) {
        renderNextVSnapshot(executionSnapshot)
      }
      const executionEvents = Array.isArray(payload?.events) ? payload.events : []
      const freshExecutionEvents = filterFreshExecutionEvents(executionEvents)
      const mergedExecutionEvents = mergeExecutionEventsWithLiveRuntimeEvents(
        freshExecutionEvents,
        bufferedRuntimeEventsForExecution,
      )
      const shouldRenderFromExecution = !nextVHasLiveRuntimeEvents
      const shouldUseTimerExecutionSupplement = false
      
      // Prefer live runtime events. Fall back to execution event replay only when live events were not observed.
      const runtimeEventsForGraph = shouldRenderFromExecution
        ? mergedExecutionEvents
        : []

      // Render only fresh execution events to avoid replaying historical payload items.
      renderCanonicalNextVEvents(freshExecutionEvents)
      
      const eventsForGraphProcessing = runtimeEventsForGraph

      if (eventType) {
        nextVGraphState.runtimeExternalNodes.add(eventType)
      }
      
      for (const runtimeEvent of eventsForGraphProcessing) {
        handleNextVGraphRuntimeEvent(runtimeEvent)
      }
      
      if (runtimeEventsForGraph.length > 0) {
        appendTraceRows(runtimeEventsForGraph)
      }

      const fallbackHandlerId = eventType
        ? (inferNextVGraphFallbackHandler(eventType) || `handler:${eventType}`)
        : ''
      if (fallbackHandlerId && !nextVGraphState.runtimeLastDispatchedNode) {
        updateNextVGraphRuntimeStep(fallbackHandlerId)
        nextVGraphState.runtimeLastDispatchedNode = fallbackHandlerId
        nextVGraphState.runtimeActiveNodes.add(eventType)
        nextVGraphState.runtimeActiveNodes.add(fallbackHandlerId)
      }

      const hasExecutionAgentCalls = Array.isArray(payload?.result?.agentCalls) && payload.result.agentCalls.length > 0
      const shouldUseExecutionTimerFallback = shouldRenderFromExecution
        && runtimeEventsForGraph.length === 0
        && hasExecutionAgentCalls
      if (shouldRenderFromExecution || shouldUseExecutionTimerFallback) {
        const fallbackNode = String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim() || fallbackHandlerId
        const agentCalls = Array.isArray(payload?.result?.agentCalls) ? payload.result.agentCalls : []
        const callsByNode = new Map()
        for (const call of agentCalls) {
          const callSourcePath = String(call?.sourcePath ?? '').trim()
          const callSourceLineRaw = Number(call?.sourceLine)
          const callSourceLine = Number.isFinite(callSourceLineRaw)
            ? callSourceLineRaw
            : Number(call?.line)
          const resolvedNodeId = resolveNextVGraphHandlerNodeForSource(callSourcePath, callSourceLine, fallbackNode)
          const nodeId = String(resolvedNodeId ?? '').trim() || fallbackNode
          if (!nodeId) continue
          if (!callsByNode.has(nodeId)) {
            callsByNode.set(nodeId, [])
          }
          callsByNode.get(nodeId).push(call)
        }

        if (callsByNode.size > 0) {
          for (const [nodeId, calls] of callsByNode.entries()) {
            reconcileNextVGraphAgentTimersFromExecution(nodeId, { agentCalls: calls })
            nextVGraphState.runtimeLastDispatchedNode = nodeId
          }
        } else if (fallbackNode) {
          reconcileNextVGraphAgentTimersFromExecution(fallbackNode, payload?.result)
        }
        const fallbackFinalizedCount = finalizeNextVGraphActiveAgentTimers({ elapsedMs: extractExecutionAgentElapsedMs(payload?.result) })
        if (fallbackFinalizedCount > 0) {
          appendNextVLogRow(`[nextv:agent_timer] fallback finalizer closed ${fallbackFinalizedCount} active timer${fallbackFinalizedCount === 1 ? '' : 's'}`, 'step')
        }
      }

      for (const runtimeEvent of runtimeEventsForGraph) {
        const toolFailureMessage = readToolErrorMessageFromRuntimeEvent(runtimeEvent)
        if (!toolFailureMessage) continue
        appendNextVErrorLog({ message: toolFailureMessage }, '[nextv:tool_error]')
        setStatus('nextv tool error', 'responding')
      }

      applyNextVGraphRuntimeVisuals()
      fadeNextVGraphActiveHighlights(760)

      // Build and render execution group (newest-first)
      _setNextVExecutionCounter(nextVExecutionCounter + 1)
      const group = buildExecutionGroup({
        ...payload,
        events: mergedExecutionEvents,
      }, nextVExecutionCounter)

      if (nextVEventsLiveMode) {
        // Live mode: prepend to groups and render
        const updated = [group, ...nextVExecutionGroups]
        const capped = updated.slice(0, 50)
        _setNextVExecutionGroups(capped)
        renderExecutionGroups()
      } else {
        // Paused mode: buffer the group
        const buffered = [group, ...nextVEventsPausedBuffer]
        const cappedBuffer = buffered.slice(0, 50)
        _setNextVEventsPausedBuffer(cappedBuffer)

        // Update badge
        const badge = document.getElementById('nextv-events-buffer-count')
        if (badge) {
          badge.textContent = `${cappedBuffer.length} new`
          badge.hidden = false
        }
      }

      const diffBefore = nextVLastKnownState ?? {}
      const diffAfter = executionSnapshot?.state ?? {}
      appendNextVStateDiffEntry(eventType, buildStateDiff(diffBefore, diffAfter))
      _setNextVLastKnownState(diffAfter)
      if (!executionSnapshot) {
        scheduleExecutionSnapshotFallback()
      }
      bufferedRuntimeEventsForExecution = []
      _setNextVHasLiveRuntimeEvents(false)
      pendingAgentCallCount = 0
      setStatus('nextv execution complete')
    } catch (err) {
      appendNextVErrorLog({ message: String(err?.message ?? err) }, '[nextv:execution_handler_error]')
    }
  })

  nextVEventSource.addEventListener('nextv_warning', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const warningCode = String(payload?.code ?? '').trim().toUpperCase()
      if (warningCode !== 'SLOW_AGENT_CALL') return

      const agent = String(payload?.agent ?? '').trim() || 'unknown'
      const model = String(payload?.model ?? '').trim() || 'unknown'
      const elapsedMs = Number(payload?.elapsedMs)
      const thresholdMs = Number(payload?.thresholdMs)
      const elapsedLabel = Number.isFinite(elapsedMs) ? `${Math.max(0, Math.round(elapsedMs))}ms` : 'unknown time'
      const thresholdLabel = Number.isFinite(thresholdMs) ? `${Math.max(0, Math.round(thresholdMs))}ms` : 'threshold'

      appendNextVLogRow(`[nextv:warning] slow agent call agent=${agent} model=${model} elapsed=${elapsedLabel} threshold=${thresholdLabel}`, 'step')
      setStatus(`nextv waiting: ${agent} on ${model} exceeded ${thresholdLabel}`, 'thinking')
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_preload_start', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const model = String(payload?.modelId ?? payload?.model ?? '').trim() || 'model'
      appendNextVLogRow(`[nextv:preload] loading ${model}`, 'step')
      setStatus(`nextv preload: loading ${model}`, 'thinking')
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_preload_success', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const model = String(payload?.modelId ?? payload?.model ?? '').trim() || 'model'
      const durationMs = Number(payload?.durationMs)
      const durationLabel = Number.isFinite(durationMs) ? `${Math.max(0, Math.round(durationMs))}ms` : 'n/a'
      appendNextVLogRow(`[nextv:preload] loaded ${model} duration=${durationLabel}`, 'result')
      setStatus(`nextv preload ready: ${model}`)
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_preload_error', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const model = String(payload?.modelId ?? payload?.model ?? '').trim() || 'model'
      appendNextVErrorLog({ message: `preload failed for ${model}: ${String(payload?.error ?? 'unknown error')}` }, '[nextv:preload_error]')
      setStatus(`nextv preload warning: ${model}`, 'responding')
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_event_queued', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const eventType = String(payload?.event?.type ?? '')
      const source = String(payload?.event?.source ?? '')
      const rawValue = payload?.event?.value
      const valueStr = rawValue == null ? '' : (typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue))
      const valueSuffix = valueStr ? ` value=${valueStr.length > 80 ? valueStr.slice(0, 80) + '\u2026' : valueStr}` : ''
      beginNextVGraphExecutionTrail()
      flashNextVGraphExternalEvent(eventType)
      flashNextVGraphEventValue(eventType, payload?.event?.value, { nodeId: eventType })
      appendNextVLogRow(`[nextv:event] queued type=${eventType} source=${source}${valueSuffix}`, 'step')
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_timer_pulse', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const eventType = String(payload?.event?.type ?? '').trim()
      if (eventType) {
        flashNextVGraphTimerPulse(eventType)
      }
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_error', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const errorEvents = Array.isArray(payload?.events) ? payload.events : []
      if (errorEvents.length > 0) {
        for (const runtimeEvent of errorEvents) {
          handleNextVGraphRuntimeEvent(runtimeEvent)
        }
        renderCanonicalNextVEvents(errorEvents)
        appendTraceRows(errorEvents)
      }

      const sourceLabelFallback = String(payload?.sourcePath ?? '').trim()
      const lineFallback = Number.isFinite(Number(payload?.sourceLine))
        ? Number(payload.sourceLine)
        : Number(payload?.line)
      const fallbackHandlerId = sourceLabelFallback
        ? resolveNextVGraphHandlerNodeForSource(sourceLabelFallback, lineFallback, String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim())
        : String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
      const errorAgentCalls = Array.isArray(payload?.result?.agentCalls) ? payload.result.agentCalls : []
      if (errorAgentCalls.length > 0) {
        const callsByNode = new Map()
        for (const call of errorAgentCalls) {
          const callSourcePath = String(call?.sourcePath ?? '').trim()
          const callSourceLineRaw = Number(call?.sourceLine)
          const callSourceLine = Number.isFinite(callSourceLineRaw)
            ? callSourceLineRaw
            : Number(call?.line)
          const resolvedNodeId = resolveNextVGraphHandlerNodeForSource(callSourcePath, callSourceLine, fallbackHandlerId)
          const nodeId = String(resolvedNodeId ?? '').trim() || fallbackHandlerId
          if (!nodeId) continue
          if (!callsByNode.has(nodeId)) {
            callsByNode.set(nodeId, [])
          }
          callsByNode.get(nodeId).push(call)
        }
        if (callsByNode.size > 0) {
          for (const [nodeId, calls] of callsByNode.entries()) {
            reconcileNextVGraphAgentTimersFromExecution(nodeId, { agentCalls: calls })
            nextVGraphState.runtimeLastDispatchedNode = nodeId
          }
        } else if (fallbackHandlerId) {
          reconcileNextVGraphAgentTimersFromExecution(fallbackHandlerId, { agentCalls: errorAgentCalls })
        }
      }

      finalizeNextVGraphActiveAgentTimers()
      applyNextVGraphRuntimeVisuals()
      pendingAgentCallCount = 0
      appendNextVErrorLog(payload)
      if (payload?.snapshot) renderNextVSnapshot(payload.snapshot)
      const { line, sourcePath } = getErrorMessageAndSource(payload)
      const sourceLabel = sourcePath ? pathBasename(sourcePath) : ''
      if (sourceLabel && line > 0) {
        setStatus(`nextv runtime error (${sourceLabel}:${line})`, 'responding')
      } else if (line > 0) {
        setStatus(`nextv runtime error (line ${line})`, 'responding')
      } else if (sourceLabel) {
        setStatus(`nextv runtime error (${sourceLabel})`, 'responding')
      } else {
        setStatus('nextv runtime error', 'responding')
      }
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_stopped', (evt) => {
    try {
      cancelExecutionSnapshotFallback()
      const payload = JSON.parse(evt.data)
      resetSeenExecutionEventKeys()
      if (payload?.snapshot) renderNextVSnapshot(payload.snapshot)
      resetNextVGraphRuntimeState({ keepExternalNodes: true })
      applyNextVGraphRuntimeVisuals()
      _setNextVRuntimeRunning(false)
      setNextVRunControls()
      pendingAgentCallCount = 0
      appendNextVLogRow('[nextv:stop] runtime stopped', 'step')
      setStatus('nextv runtime stopped')
    } catch {
      _setNextVRuntimeRunning(false)
      setNextVRunControls()
    }
  })
}

export async function refreshNextVSnapshot() {
  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/snapshot'))
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'unable to load nextv snapshot')
    }
    if (data?.remoteMode === true) {
      updateRemoteRuntimeIdentity(data)
      updateRemoteModeBadge()
    }
    renderNextVSnapshot(data.snapshot, { log: true })
    setStatus('nextv snapshot updated')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv snapshot failed', 'responding')
  }
}

export async function syncNextVRuntimeState() {
  if (nextVRuntimeTargetState.target === 'attach' && nextVAttachSessionState.attached !== true) {
    _setIsRemoteMode(true)
    _setIsRemoteControlMode(true)
    _setRemoteTransport('ws')
    _setIsRemoteRuntimeConnected(false)
    _setNextVRuntimeRunning(false)
    updateRemoteRuntimeIdentity(null, { clear: true })
    updateRemoteModeBadge()
    closeNextVStream()
    setNextVRunControls()
    syncNextVAttachSessionUi()
    return
  }

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/snapshot'))
    const data = await res.json().catch(() => ({}))

    _setIsRemoteMode(data?.remoteMode === true)
    _setIsRemoteControlMode(data?.remoteControl === true)
    _setRemoteTransport(String(data?.remoteTransport ?? (isRemoteControlMode ? 'ws' : (isRemoteMode ? 'mqtt' : 'local'))))
    const attachConnected = nextVRuntimeTargetState.target === 'attach' && nextVAttachSessionState.attached === true
    _setIsRemoteRuntimeConnected(
      attachConnected
        ? true
        : (isRemoteControlMode
          ? (data?.remoteConnection?.connected === true)
          : true),
    )
    let hydratedRemoteIdentity = {
      workspaceDir: '',
      workspaceChanged: false,
    }

    if (isRemoteMode) {
      updateRemoteRuntimeIdentity(data)
      if (shouldHydrateLocalConfigFromRemoteSnapshot(data)) {
        hydratedRemoteIdentity = hydrateNextVInputsFromRemoteSnapshot(data)
      }
    } else {
      updateRemoteRuntimeIdentity(null, { clear: true })
    }

    if (!res.ok) {
      _setNextVRuntimeRunning(false)
      updateRemoteModeBadge()
      closeNextVStream()
      setNextVRunControls()
      return
    }
    updateRemoteModeBadge()
    renderNextVSnapshot(data.snapshot, { skipControlUpdate: true })
    if (isRemoteMode || data?.snapshot?.running === true) {
      openNextVStream()
    } else {
      closeNextVStream()
    }
    const resolvedRunning = (
      data?.running === true
      || data?.snapshot?.running === true
      || data?.remoteConnection?.remoteActive === true
    )
    _setNextVRuntimeRunning(resolvedRunning)
    if (nextVRuntimeRunning) {
      _setNextVManagedProcessRunning(true)
      appendNextVLogRow('[nextv:reconnect] reattached to running workflow', 'step')
      setStatus('reconnected to running workflow')
    }
    if (nextVRuntimeTargetState.target === 'attach') {
      nextVAttachSessionState.lastError = ''
      syncNextVAttachSessionUi()
    }
    setNextVRunControls()

    if (hydratedRemoteIdentity.workspaceChanged && hydratedRemoteIdentity.workspaceDir && isNextVMode()) {
      try {
        await openNextVWorkspace()
      } catch (workspaceErr) {
        appendNextVErrorLog(workspaceErr, '[nextv:remote:workspace:auto-open:error]')
      }
    }
  } catch (err) {
    _setNextVRuntimeRunning(false)
    if (isRemoteControlMode) {
      _setIsRemoteRuntimeConnected(false)
    }
    if (nextVRuntimeTargetState.target === 'attach') {
      nextVAttachSessionState.lastError = String(err?.message ?? 'remote runtime websocket is not connected')
      syncNextVAttachSessionUi()
    }
    updateRemoteModeBadge()
    closeNextVStream()
    setNextVRunControls()
  }
}

export async function runNextVRuntime() {
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const entrypointPath = normalizeEntrypointForWorkspace(nextVEntrypointInput?.value ?? '', workspaceDir)
  if (!entrypointPath) {
    setStatus('nextv entrypoint required', 'responding')
    return
  }

  if (isBusy) {
    setStatus('busy: wait for current task', 'responding')
    return
  }

  try {
    setNextVMode({ ensureEntrypoint: false, refreshGraph: false })
    const res = await fetch(buildNextVApiPath('/api/nextv/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceDir, entrypointPath }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to start runtime process')
    }

    _setNextVManagedProcessRunning(true)
    setNextVRunControls()
    setStatus('nextv runtime process started; click start to begin workflow')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv run failed', 'responding')
  }
}

export async function killNextVRuntime() {
  if (isBusy) return

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/kill'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to kill runtime process')
    }

    _setNextVManagedProcessRunning(false)
    _setNextVRuntimeRunning(false)
    closeNextVStream()
    setNextVRunControls()
    setStatus('nextv runtime process stopped')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv kill failed', 'responding')
  }
}

export async function startNextVRuntime() {
  const isAttachLockedToRuntime = nextVRuntimeTargetState.target === 'attach' && !isNextVAttachStartOverrideEnabled()
  const localWorkspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const localEntrypointPath = normalizeEntrypointForWorkspace(nextVEntrypointInput?.value ?? '', localWorkspaceDir)
  const runtimeWorkspaceDir = normalizeNextVWorkspaceDir(remoteRuntimeWorkspaceDir ?? '')
  const runtimeEntrypointPath = normalizeEntrypointForWorkspace(remoteRuntimeEntrypointPath ?? '', runtimeWorkspaceDir)
  const workspaceDir = isAttachLockedToRuntime ? (runtimeWorkspaceDir || localWorkspaceDir) : localWorkspaceDir
  const entrypointPath = isAttachLockedToRuntime ? (runtimeEntrypointPath || localEntrypointPath) : localEntrypointPath
  const emitTrace = true
  const emitTraceState = true
  if (!entrypointPath) {
    setStatus('nextv entrypoint required', 'responding')
    return
  }

  if (isBusy) {
    setStatus('busy: wait for current task', 'responding')
    return
  }

  try {
    setNextVMode({ ensureEntrypoint: false, refreshGraph: false })
    clearTracePanel({ silent: true })
    clearNextVEventsOutput()
    clearNextVConsoleOutput()
    if (!isAttachLockedToRuntime) {
      await ensureNextVEntrypointVisible({ logLoaded: true, warnOnDirty: true })
    }
    const res = await fetch(buildNextVApiPath('/api/nextv/start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceDir,
        entrypointPath,
        emitTrace,
        emitTraceState,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to start nextv runtime')
    }

    _setNextVRuntimeRunning(true)
    setNextVRunControls()
    openNextVStream()
    if (!nextVEventSource) {
      const runtimePath = data.runtimeStatePath ?? data.statePath
      appendNextVLogRow(formatNextVStartLine(data.entrypointPath, runtimePath, data.baselineStatePath), 'step')
    }

    if (nextVWorkspaceDirInput) {
      const responseWorkspaceDir = String(data.workspaceDir ?? '')
      nextVWorkspaceDirInput.value = responseWorkspaceDir === '.' ? '' : responseWorkspaceDir
    }

    if (data?.remoteMode === true) {
      updateRemoteRuntimeIdentity(data)
      updateRemoteModeBadge()
    }

    if (data?.workspaceConfig && typeof data.workspaceConfig === 'object') {
      appendNextVLogRow(formatWorkspaceConfigStatus(data.workspaceConfig), 'result')
    }

    if (data?.trace && typeof data.trace === 'object') {
      appendNextVLogRow(`[nextv:trace] enabled=${data.trace.enabled === true} state=${data.trace.includeState === true}`, 'result')
    }
    if (data?.capabilities && typeof data.capabilities === 'object') {
      appendNextVLogRow(formatCapabilityStatus(data.capabilities, data.effects), 'result')
    }
    if (data?.hostModules && typeof data.hostModules === 'object') {
      appendNextVLogRow(formatHostModulesStatus(data.hostModules), 'result')
    }

    persistNextVConfig()

    await refreshNextVGraph({ silent: true, preserveViewport: true })
    beginNextVGraphExecutionTrail()
    flashNextVGraphSignalDispatch('init', 1000)
    _setNextVLastKnownState(null)
    clearNextVStateDiff()
    const initState = data?.snapshot?.state ?? {}
    appendNextVStateDiffEntry('init', buildStateDiff({}, initState))
    _setNextVLastKnownState(initState)
    renderNextVSnapshot(data.snapshot)
    setStatus('nextv runtime started')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv start failed', 'responding')
  }
}

export async function stopNextVRuntime() {
  try {
    const hadStream = Boolean(nextVEventSource)
    const res = await fetch(buildNextVApiPath('/api/nextv/stop'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to stop nextv runtime')
    }

    _setNextVRuntimeRunning(false)
    // In external mode, stopping the workflow does not kill the process
    if (nextVRuntimeTargetState.target !== 'external') {
      _setNextVManagedProcessRunning(false)
    }
    setNextVRunControls()
    closeNextVStream()
    if (data?.remoteMode === true) {
      updateRemoteRuntimeIdentity(data)
      updateRemoteModeBadge()
    }
    if (!hadStream) {
      appendNextVLogRow('[nextv:stop] runtime stopped', 'step')
    }
    renderNextVSnapshot(data.snapshot)
    setStatus('nextv runtime stopped')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv stop failed', 'responding')
  }
}

export async function reloadNextVRuntimeConfig() {
  if (!nextVRuntimeRunning) {
    setStatus('nextv runtime not running', 'responding')
    return
  }

  if (isBusy) {
    setStatus('busy: wait for current task', 'responding')
    return
  }

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/reload-config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to reload nextv config')
    }

    if (data?.workspaceConfig && typeof data.workspaceConfig === 'object') {
      appendNextVLogRow(`[nextv:config] reloaded`, 'step')
      appendNextVLogRow(formatWorkspaceConfigStatus(data.workspaceConfig), 'result')
    }
    setStatus('nextv config reloaded')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv config reload failed', 'responding')
  }
}

export async function submitNextVCandidate() {
  if (!nextVRuntimeRunning) {
    setStatus('nextv runtime not running', 'responding')
    return
  }

  if (isBusy) {
    setStatus('busy: wait for current task', 'responding')
    return
  }

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/submit-candidate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to submit candidate')
    }

    const candidate = data.candidate ?? {}
    const status = candidate.status ?? 'unknown'
    const issues = Array.isArray(candidate.issues) ? candidate.issues : []
    const isPromotable = status === 'promotable'

    _setNextVCandidatePromotable(isPromotable)
    if (nextVCandidateStatusRow) nextVCandidateStatusRow.hidden = false
    if (nextVCandidateStatusBadge) nextVCandidateStatusBadge.textContent = status
    if (nextVCandidateIssueCount) {
      nextVCandidateIssueCount.textContent = issues.length > 0 ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''
    }

    appendNextVLogRow(`[nextv:candidate] ${status}`, isPromotable ? 'step' : 'warn')
    if (candidate.workspaceConfig && typeof candidate.workspaceConfig === 'object') {
      appendNextVLogRow(formatWorkspaceConfigStatus(candidate.workspaceConfig), 'result')
    }
    if (issues.length > 0) {
      for (const issue of issues) {
        appendNextVLogRow(`  issue: ${issue}`, 'warn')
      }
    }
    setNextVRunControls()
    setStatus(`candidate: ${status}`)
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('candidate validation failed', 'responding')
  }
}

export async function promoteNextVCandidate() {
  if (!nextVRuntimeRunning) {
    setStatus('nextv runtime not running', 'responding')
    return
  }

  if (!nextVCandidatePromotable) {
    setStatus('no promotable candidate', 'responding')
    return
  }

  if (isBusy) {
    setStatus('busy: wait for current task', 'responding')
    return
  }

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/promote-candidate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to promote candidate')
    }

    _setNextVCandidatePromotable(false)
    if (nextVCandidateStatusRow) nextVCandidateStatusRow.hidden = true
    if (nextVCandidateStatusBadge) nextVCandidateStatusBadge.textContent = ''
    if (nextVCandidateIssueCount) nextVCandidateIssueCount.textContent = ''

    appendNextVLogRow(`[nextv:candidate] promoted`, 'step')
    if (data?.workspaceConfig && typeof data.workspaceConfig === 'object') {
      appendNextVLogRow(formatWorkspaceConfigStatus(data.workspaceConfig), 'result')
    }
    setNextVRunControls()
    setStatus('candidate promoted')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('candidate promotion failed', 'responding')
  }
}

export async function sendNextVEvent() {
  const value = String(nextVEventValueInput?.value ?? '')
  const selectedChannel = getSelectedNextVInputChannel()
  const eventType = selectedChannel || String(nextVEventTypeInput?.value ?? '').trim()
  const source = String(nextVEventSourceInput?.value ?? '').trim()
  const attachedImages = nextVInputImageState.entries.map((entry) => entry.base64).filter(Boolean)

  if (!nextVRuntimeRunning) {
    setStatus('nextv runtime not running', 'responding')
    return
  }

  try {
    const requestBody = { value, eventType, source }
    if (attachedImages.length > 0) {
      requestBody.payload = { images: attachedImages }
    }

    const res = await fetch(buildNextVApiPath('/api/nextv/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to enqueue nextv event')
    }

    if (!nextVEventSource) {
      const valueSnippet = value ? (value.length > 80 ? value.slice(0, 80) + '\u2026' : value) : ''
      const valueSuffix = valueSnippet ? ` value=${valueSnippet}` : ''
      appendNextVLogRow(`[nextv:event] queued type=${eventType} source=${source}${valueSuffix}`, 'step')
      renderNextVSnapshot(data.snapshot)
    }
    if (attachedImages.length > 0) {
      setStatus(`nextv event queued (${attachedImages.length} image${attachedImages.length === 1 ? '' : 's'})`)
      clearNextVEventImages({ silent: true })
    } else {
      setStatus('nextv event queued')
    }
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv event failed', 'responding')
  }
}

export async function sendNextVIngress() {
  const name = String(nextVIngressNameInput?.value ?? '').trim()
  const value = String(nextVIngressValueInput?.value ?? '')

  if (!name) {
    setStatus('ingress dispatch requires a connector name', 'responding')
    return
  }

  if (!nextVRuntimeRunning) {
    setStatus('nextv runtime not running', 'responding')
    return
  }

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/ingress'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to dispatch ingress')
    }
    const count = Number(data.dispatchedCount ?? 0)
    appendNextVLogRow(`[nextv:ingress] dispatched name=${name} events=${count}`, 'step')
    setStatus(`ingress dispatched: ${name} (${count} event${count === 1 ? '' : 's'})`)
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('ingress dispatch failed', 'responding')
  }
}

export async function executeNextVCallInspector() {
  const targetKindRaw = String(nextVCallTargetKindInput?.value ?? 'agent').trim().toLowerCase()
  const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
  const modeRaw = String(nextVCallModeInput?.value ?? 'call').trim().toLowerCase()
  const mode = modeRaw === 'try' ? 'try' : 'call'
  await refreshNextVCallInspectorAgents({ quiet: true })
  const target = getNextVCallInspectorTargetValue(targetKind)
  const instructions = String(nextVCallInstructionsInput?.value ?? '')
  const prompt = String(nextVCallPromptInput?.value ?? '')
  const returnsText = String(nextVCallReturnsInput?.value ?? '').trim()
  const decideText = String(nextVCallDecideInput?.value ?? '').trim()
  const validateRaw = String(nextVCallValidateInput?.value ?? 'coerce').trim().toLowerCase()
  const validate = ['strict', 'coerce', 'none'].includes(validateRaw) ? validateRaw : 'coerce'
  const retryRaw = Number(nextVCallRetryInput?.value)
  const retryCount = Number.isInteger(retryRaw) ? Math.max(0, Math.min(8, retryRaw)) : 0
  const toolsPolicyResult = buildNextVCallInspectorToolsPolicy()
  const toolsPolicy = toolsPolicyResult.ok ? toolsPolicyResult.policy : null

  function failInspectorValidation(message) {
    renderNextVCallInspectorResolvedCall({ status: 'call inspector validation failed before runtime invocation' })
    renderNextVCallInspectorResult({ error: message })
    setStatus(message, 'responding')
  }

  if (!target) {
    failInspectorValidation('call inspector target is required')
    return
  }
  if (!prompt.trim()) {
    failInspectorValidation('call inspector prompt is required')
    return
  }
  if (returnsText && decideText) {
    failInspectorValidation('use either returns or decide, not both')
    return
  }
  if (!toolsPolicyResult.ok) {
    failInspectorValidation(toolsPolicyResult.error)
    return
  }

  const requestBody = {
    workspaceDir: normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? ''),
    targetKind,
    mode,
    instructions,
    prompt,
    validate,
    retry_on_contract_violation: retryCount,
  }
  if (targetKind === 'agent') {
    requestBody.agent = target
  } else {
    requestBody.model = target
  }

  if (returnsText) {
    try {
      requestBody.returns = JSON.parse(returnsText)
    } catch {
      failInspectorValidation('returns contract must be valid JSON')
      return
    }
  }
  if (decideText) {
    requestBody.decide = decideText
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  if (toolsPolicyResult.policy) {
    requestBody.tools = toolsPolicyResult.policy
  }

  renderNextVCallInspectorResolvedCall({ status: 'resolving runtime invocation...' })
  renderNextVCallInspectorResult({ status: 'running call inspector request...' })
  setStatus('executing call inspector...', 'responding')

  try {
    const res = await fetch(buildNextVApiPath('/api/nextv/call-inspector/execute'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'call inspector execution failed')
    }

    renderNextVCallInspectorResolvedCall(data?.resolvedCall ?? { status: 'resolved call unavailable' })
    renderNextVCallInspectorResult(data)

    const targetLabel = targetKind === 'agent'
      ? `agent=${requestBody.agent}`
      : `model=${requestBody.model}`
    appendNextVLogRow(`[nextv:call-inspector] executed ${targetLabel}`, 'step')
    setStatus('call inspector completed')
  } catch (err) {
    appendNextVErrorLog(err)
    renderNextVCallInspectorResolvedCall({ error: 'execution failed before resolved call was available' })
    renderNextVCallInspectorResult({ error: String(err?.message ?? err) })
    setStatus('call inspector failed', 'responding')
  }
}

function stringifyInspectorPane(value) {
  if (value == null) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const nextVCallInspectorToolsState = {
  checked: new Set(),
}

function normalizeNextVCallInspectorToolsMode(modeRaw) {
  return String(modeRaw ?? '').trim().toLowerCase() === 'governed' ? 'governed' : 'disabled'
}

function parseNextVCallInspectorToolsCsv(text) {
  return [...new Set(
    String(text ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )]
}

function getStoredNextVCallInspectorCheckedTools() {
  const raw = String(localStorage.getItem(storageKeys.nextVCallInspectorToolsChecked) ?? '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((value) => String(value ?? '').trim()).filter(Boolean))]
      : []
  } catch {
    return []
  }
}

function persistNextVCallInspectorInputs() {
  const targetKind = String(nextVCallTargetKindInput?.value ?? '').trim()
  if (targetKind) localStorage.setItem(storageKeys.nextVCallInspectorTargetKind, targetKind)

  const modeRaw = String(nextVCallModeInput?.value ?? '').trim().toLowerCase()
  const mode = modeRaw === 'try' ? 'try' : 'call'
  localStorage.setItem(storageKeys.nextVCallInspectorMode, mode)

  const targetAgent = String(nextVCallTargetAgentInput?.value ?? '').trim()
  if (targetAgent) localStorage.setItem(storageKeys.nextVCallInspectorTargetAgent, targetAgent)

  const targetModel = String(nextVCallTargetInput?.value ?? '').trim()
  if (targetModel) localStorage.setItem(storageKeys.nextVCallInspectorTargetModel, targetModel)

  const validate = String(nextVCallValidateInput?.value ?? '').trim()
  if (validate) localStorage.setItem(storageKeys.nextVCallInspectorValidate, validate)

  const retry = String(nextVCallRetryInput?.value ?? '').trim()
  if (retry !== '') localStorage.setItem(storageKeys.nextVCallInspectorRetry, retry)

  localStorage.setItem(storageKeys.nextVCallInspectorInstructions, String(nextVCallInstructionsInput?.value ?? ''))
  localStorage.setItem(storageKeys.nextVCallInspectorPrompt, String(nextVCallPromptInput?.value ?? ''))
  localStorage.setItem(storageKeys.nextVCallInspectorReturns, String(nextVCallReturnsInput?.value ?? ''))
  localStorage.setItem(storageKeys.nextVCallInspectorDecide, String(nextVCallDecideInput?.value ?? ''))

  const toolsMode = normalizeNextVCallInspectorToolsMode(nextVCallToolsModeInput?.value ?? 'disabled')
  localStorage.setItem(storageKeys.nextVCallInspectorToolsMode, toolsMode)

  const toolsMaxRounds = String(nextVCallToolsMaxRoundsInput?.value ?? '').trim()
  if (toolsMaxRounds !== '') {
    localStorage.setItem(storageKeys.nextVCallInspectorToolsMaxRounds, toolsMaxRounds)
  }

  const toolsTimeoutMs = String(nextVCallToolsTimeoutMsInput?.value ?? '').trim()
  if (toolsTimeoutMs !== '') {
    localStorage.setItem(storageKeys.nextVCallInspectorToolsTimeoutMs, toolsTimeoutMs)
  }

  localStorage.setItem(
    storageKeys.nextVCallInspectorToolsDenyUnknown,
    nextVCallToolsDenyUnknownInput?.checked === false ? '0' : '1'
  )
  localStorage.setItem(storageKeys.nextVCallInspectorToolsExtra, String(nextVCallToolsExtraInput?.value ?? ''))
  localStorage.setItem(
    storageKeys.nextVCallInspectorToolsChecked,
    JSON.stringify([...nextVCallInspectorToolsState.checked].sort((left, right) => left.localeCompare(right)))
  )
}

function restoreNextVCallInspectorInputs() {
  const targetKind = String(localStorage.getItem(storageKeys.nextVCallInspectorTargetKind) ?? '').trim()
  if (targetKind && nextVCallTargetKindInput) nextVCallTargetKindInput.value = targetKind

  const storedMode = String(localStorage.getItem(storageKeys.nextVCallInspectorMode) ?? '').trim().toLowerCase()
  if (nextVCallModeInput) {
    nextVCallModeInput.value = storedMode === 'try' ? 'try' : 'call'
  }

  const validate = String(localStorage.getItem(storageKeys.nextVCallInspectorValidate) ?? '').trim()
  if (validate && nextVCallValidateInput) nextVCallValidateInput.value = validate

  const retry = String(localStorage.getItem(storageKeys.nextVCallInspectorRetry) ?? '').trim()
  if (retry !== '' && nextVCallRetryInput) nextVCallRetryInput.value = retry

  const instructions = localStorage.getItem(storageKeys.nextVCallInspectorInstructions)
  if (instructions !== null && nextVCallInstructionsInput) nextVCallInstructionsInput.value = instructions

  const prompt = localStorage.getItem(storageKeys.nextVCallInspectorPrompt)
  if (prompt !== null && nextVCallPromptInput) nextVCallPromptInput.value = prompt

  const returns = localStorage.getItem(storageKeys.nextVCallInspectorReturns)
  if (returns !== null && nextVCallReturnsInput) nextVCallReturnsInput.value = returns

  const decide = localStorage.getItem(storageKeys.nextVCallInspectorDecide)
  if (decide !== null && nextVCallDecideInput) nextVCallDecideInput.value = decide

  const toolsMode = normalizeNextVCallInspectorToolsMode(localStorage.getItem(storageKeys.nextVCallInspectorToolsMode) ?? 'disabled')
  if (nextVCallToolsModeInput) {
    nextVCallToolsModeInput.value = toolsMode
  }

  const toolsMaxRounds = String(localStorage.getItem(storageKeys.nextVCallInspectorToolsMaxRounds) ?? '').trim()
  if (toolsMaxRounds !== '' && nextVCallToolsMaxRoundsInput) {
    nextVCallToolsMaxRoundsInput.value = toolsMaxRounds
  }

  const toolsTimeoutMs = String(localStorage.getItem(storageKeys.nextVCallInspectorToolsTimeoutMs) ?? '').trim()
  if (toolsTimeoutMs !== '' && nextVCallToolsTimeoutMsInput) {
    nextVCallToolsTimeoutMsInput.value = toolsTimeoutMs
  }

  const denyUnknownStored = String(localStorage.getItem(storageKeys.nextVCallInspectorToolsDenyUnknown) ?? '').trim()
  if (nextVCallToolsDenyUnknownInput) {
    nextVCallToolsDenyUnknownInput.checked = denyUnknownStored === '' ? true : denyUnknownStored !== '0'
  }

  const toolsExtra = localStorage.getItem(storageKeys.nextVCallInspectorToolsExtra)
  if (toolsExtra !== null && nextVCallToolsExtraInput) {
    nextVCallToolsExtraInput.value = toolsExtra
  }

  nextVCallInspectorToolsState.checked = new Set(getStoredNextVCallInspectorCheckedTools())
}

const nextVCallInspectorProjectConfig = {
  agentsByName: {},
  modelsByName: {},
  transportProvidersByName: {},
  allowedTools: [],
  toolAliases: {},
  agentDeclaredTools: {},
}

function setNextVCallInspectorProjectConfig(payload = {}) {
  const agentsByName = payload?.agentsByName
  const modelsByName = payload?.modelsByName
  const transportProvidersByName = payload?.transportProvidersByName
  const allowedTools = payload?.allowedTools
  const toolAliases = payload?.toolAliases
  const agentDeclaredTools = payload?.agentDeclaredTools

  nextVCallInspectorProjectConfig.agentsByName = agentsByName && typeof agentsByName === 'object' && !Array.isArray(agentsByName)
    ? agentsByName
    : {}
  nextVCallInspectorProjectConfig.modelsByName = modelsByName && typeof modelsByName === 'object' && !Array.isArray(modelsByName)
    ? modelsByName
    : {}
  nextVCallInspectorProjectConfig.transportProvidersByName = transportProvidersByName && typeof transportProvidersByName === 'object' && !Array.isArray(transportProvidersByName)
    ? transportProvidersByName
    : {}
  nextVCallInspectorProjectConfig.allowedTools = Array.isArray(allowedTools)
    ? [...new Set(allowedTools.map((value) => String(value ?? '').trim()).filter(Boolean))]
    : []
  nextVCallInspectorProjectConfig.toolAliases = toolAliases && typeof toolAliases === 'object' && !Array.isArray(toolAliases)
    ? toolAliases
    : {}
  nextVCallInspectorProjectConfig.agentDeclaredTools = agentDeclaredTools && typeof agentDeclaredTools === 'object' && !Array.isArray(agentDeclaredTools)
    ? agentDeclaredTools
    : {}
}

function getNextVCallInspectorAvailableTools() {
  const targetKindRaw = String(nextVCallTargetKindInput?.value ?? 'agent').trim().toLowerCase()
  const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
  if (targetKind === 'agent') {
    const agentName = String(nextVCallTargetAgentInput?.value ?? '').trim()
    const profile = nextVCallInspectorProjectConfig.agentsByName[agentName]
    const profileTools = Array.isArray(profile?.tools)
      ? profile.tools
      : nextVCallInspectorProjectConfig.agentDeclaredTools[agentName]
    if (Array.isArray(profileTools) && profileTools.length > 0) {
      return [...new Set(profileTools.map((value) => String(value ?? '').trim()).filter(Boolean))]
    }
  }
  return [...nextVCallInspectorProjectConfig.allowedTools]
}

function syncNextVCallInspectorToolsModeUi() {
  if (!nextVCallToolsModeInput || !nextVCallToolsSection) return
  const mode = normalizeNextVCallInspectorToolsMode(nextVCallToolsModeInput.value)
  const governed = mode === 'governed'

  if (nextVCallToolsList) {
    nextVCallToolsList.style.opacity = governed ? '1' : '0.6'
  }
  if (nextVCallToolsMaxRoundsInput) {
    nextVCallToolsMaxRoundsInput.disabled = !governed
  }
  if (nextVCallToolsTimeoutMsInput) {
    nextVCallToolsTimeoutMsInput.disabled = !governed
  }
  if (nextVCallToolsDenyUnknownInput) {
    nextVCallToolsDenyUnknownInput.disabled = !governed
  }
  if (nextVCallToolsExtraInput) {
    nextVCallToolsExtraInput.disabled = !governed
  }
}

function renderNextVCallInspectorToolsChecklist() {
  if (!nextVCallToolsList) return
  const availableTools = getNextVCallInspectorAvailableTools()
  const validChecked = [...nextVCallInspectorToolsState.checked].filter((name) => availableTools.includes(name))
  nextVCallInspectorToolsState.checked = new Set(validChecked)
  nextVCallToolsList.innerHTML = ''

  if (availableTools.length === 0) {
    nextVCallToolsList.textContent = '(no configured tools available for this target)'
    return
  }

  const aliasEntries = Object.entries(nextVCallInspectorProjectConfig.toolAliases)
  for (const toolName of availableTools) {
    const wrapper = document.createElement('label')
    wrapper.className = 'check-label'
    wrapper.style.display = 'block'
    wrapper.style.marginBottom = '4px'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'nextv-call-tool-checkbox'
    input.value = toolName
    input.checked = nextVCallInspectorToolsState.checked.has(toolName)
    input.addEventListener('change', () => {
      if (input.checked) {
        nextVCallInspectorToolsState.checked.add(toolName)
      } else {
        nextVCallInspectorToolsState.checked.delete(toolName)
      }
      persistNextVCallInspectorInputs()
      renderNextVCallInspectorSnippet()
    })

    const labelText = document.createElement('span')
    const aliases = aliasEntries
      .filter(([, target]) => String(target ?? '').trim() === toolName)
      .map(([alias]) => String(alias ?? '').trim())
      .filter(Boolean)
    labelText.textContent = aliases.length > 0
      ? `${toolName} (aliases: ${aliases.join(', ')})`
      : toolName

    wrapper.appendChild(input)
    wrapper.appendChild(labelText)
    nextVCallToolsList.appendChild(wrapper)
  }
}

function buildNextVCallInspectorToolsPolicy() {
  const mode = normalizeNextVCallInspectorToolsMode(nextVCallToolsModeInput?.value ?? 'disabled')
  if (mode === 'disabled') {
    return { ok: true, policy: null }
  }

  const availableTools = getNextVCallInspectorAvailableTools()
  const checkedTools = [...nextVCallInspectorToolsState.checked].filter((name) => availableTools.includes(name))
  const extraTools = parseNextVCallInspectorToolsCsv(nextVCallToolsExtraInput?.value ?? '')
  const allow = [...new Set([...checkedTools, ...extraTools])]
  if (allow.length === 0) {
    return {
      ok: false,
      error: 'select at least one governed tool or provide extra tools before running the call',
      policy: null,
    }
  }

  const maxRoundsRaw = Number(nextVCallToolsMaxRoundsInput?.value)
  const timeoutMsRaw = Number(nextVCallToolsTimeoutMsInput?.value)
  if (!Number.isInteger(maxRoundsRaw) || maxRoundsRaw < 0) {
    return { ok: false, error: 'tools max rounds must be a non-negative integer', policy: null }
  }
  if (!Number.isInteger(timeoutMsRaw) || timeoutMsRaw < 0) {
    return { ok: false, error: 'tools timeout ms must be a non-negative integer', policy: null }
  }

  return {
    ok: true,
    policy: {
      mode: 'governed',
      allow,
      maxRounds: maxRoundsRaw,
      timeoutMs: timeoutMsRaw,
      denyOnUnknownTool: nextVCallToolsDenyUnknownInput?.checked === false ? false : true,
    },
  }
}

function renderNextVCallInspectorTargetConfig() {
  if (!nextVCallTargetConfigOutput || !nextVCallTargetConfigLabel) return

  const targetKindRaw = String(nextVCallTargetKindInput?.value ?? 'agent').trim().toLowerCase()
  const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
  const targetName = getNextVCallInspectorTargetValue(targetKind)

  if (!targetName) {
    nextVCallTargetConfigLabel.textContent = 'project config'
    nextVCallTargetConfigOutput.textContent = '(select a configured target)'
    return
  }

  if (targetKind === 'agent') {
    const profile = nextVCallInspectorProjectConfig.agentsByName[targetName]
    nextVCallTargetConfigLabel.textContent = `project config · agent.${targetName}`
    if (!profile || typeof profile !== 'object') {
      nextVCallTargetConfigOutput.textContent = stringifyInspectorPane({ status: 'agent not found in workspace config' })
      return
    }

    const modelName = String(profile?.model ?? profile?.modelId ?? '').trim()
    const model = modelName ? nextVCallInspectorProjectConfig.modelsByName[modelName] : null
    const transportName = String(model?.transport ?? '').trim()
    const provider = transportName
      ? String(nextVCallInspectorProjectConfig.transportProvidersByName[transportName] ?? '').trim()
      : ''

    nextVCallTargetConfigOutput.textContent = stringifyInspectorPane({
      agent: profile,
      model: model
        ? {
            name: modelName,
            ...model,
            transportProvider: provider || undefined,
          }
        : (modelName
          ? {
              name: modelName,
              status: 'model referenced by agent not found in workspace config',
            }
          : {
              status: 'agent does not declare a model',
            }),
      availableTools: getNextVCallInspectorAvailableTools(),
      toolAliases: nextVCallInspectorProjectConfig.toolAliases,
    })
    return
  }

  const model = nextVCallInspectorProjectConfig.modelsByName[targetName]
  const transportName = String(model?.transport ?? '').trim()
  const provider = transportName
    ? String(nextVCallInspectorProjectConfig.transportProvidersByName[transportName] ?? '').trim()
    : ''
  nextVCallTargetConfigLabel.textContent = `project config · model.${targetName}`
  nextVCallTargetConfigOutput.textContent = stringifyInspectorPane(model
    ? {
        ...model,
        transportProvider: provider || undefined,
        availableTools: getNextVCallInspectorAvailableTools(),
        toolAliases: nextVCallInspectorProjectConfig.toolAliases,
      }
    : { status: 'model not found in workspace config' })
}

function renderNextVCallInspectorResolvedCall(resolvedCall = null) {
  if (!nextVCallResolvedOutput || !nextVCallResolvedLabel) return

  nextVCallResolvedLabel.textContent = 'resolved call · final model-facing request'
  if (!resolvedCall) {
    nextVCallResolvedOutput.textContent = '(run call to inspect resolved invocation)'
    return
  }

  const compact = {
    ...resolvedCall,
    finalRequest: resolvedCall?.finalRequest ?? {
      model: String(resolvedCall?.resolvedModel ?? '').trim(),
      messageCount: Number(resolvedCall?.messageCount ?? 0),
      messages: Array.isArray(resolvedCall?.finalMessages) ? resolvedCall.finalMessages : [],
    },
  }

  nextVCallResolvedOutput.textContent = stringifyInspectorPane(compact)
}

function getNextVCallInspectorTargetValue(targetKind) {
  const normalizedTargetKind = String(targetKind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  if (normalizedTargetKind === 'agent') {
    return String(nextVCallTargetAgentInput?.value ?? '').trim()
  }
  return String(nextVCallTargetInput?.value ?? '').trim()
}

function syncNextVCallInspectorTargetMode() {
  const targetKindRaw = String(nextVCallTargetKindInput?.value ?? 'agent').trim().toLowerCase()
  const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
  const isAgentMode = targetKind === 'agent'

  if (nextVCallTargetAgentInput) {
    nextVCallTargetAgentInput.hidden = !isAgentMode
    nextVCallTargetAgentInput.disabled = !isAgentMode
  }
  if (nextVCallTargetInput) {
    nextVCallTargetInput.hidden = isAgentMode
    nextVCallTargetInput.disabled = isAgentMode
  }
  syncNextVCallInspectorToolsModeUi()
  renderNextVCallInspectorToolsChecklist()
}

function setNextVCallInspectorAgentOptions(agentNames, options = {}) {
  if (!nextVCallTargetAgentInput) return
  const emptyLabel = String(options?.emptyLabel ?? '(no configured agents)')

  const names = Array.isArray(agentNames) ? agentNames.filter(Boolean).map((value) => String(value).trim()).filter(Boolean) : []
  const currentValue = String(nextVCallTargetAgentInput.value ?? '').trim()
  nextVCallTargetAgentInput.innerHTML = ''

  if (names.length === 0) {
    const emptyOption = document.createElement('option')
    emptyOption.value = ''
    emptyOption.textContent = emptyLabel
    nextVCallTargetAgentInput.appendChild(emptyOption)
    return
  }

  for (const name of names) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    nextVCallTargetAgentInput.appendChild(option)
  }

  if (currentValue && names.includes(currentValue)) {
    nextVCallTargetAgentInput.value = currentValue
  } else {
    nextVCallTargetAgentInput.value = names[0]
  }
}

function setNextVCallInspectorModelOptions(modelNames, options = {}) {
  if (!nextVCallTargetInput) return
  const emptyLabel = String(options?.emptyLabel ?? '(no configured models)')

  const names = Array.isArray(modelNames) ? modelNames.filter(Boolean).map((value) => String(value).trim()).filter(Boolean) : []
  const currentValue = String(nextVCallTargetInput.value ?? '').trim()
  nextVCallTargetInput.innerHTML = ''

  if (names.length === 0) {
    const emptyOption = document.createElement('option')
    emptyOption.value = ''
    emptyOption.textContent = emptyLabel
    nextVCallTargetInput.appendChild(emptyOption)
    return
  }

  for (const name of names) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    nextVCallTargetInput.appendChild(option)
  }

  if (currentValue && names.includes(currentValue)) {
    nextVCallTargetInput.value = currentValue
  } else {
    nextVCallTargetInput.value = names[0]
  }
}

export async function refreshNextVCallInspectorAgents(options = {}) {
  const quiet = options?.quiet === true
  const localWorkspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const remoteWorkspaceDir = normalizeNextVWorkspaceDir(remoteRuntimeWorkspaceDir ?? '')
  const workspaceDir = isRemoteMode && isRemoteControlMode
    ? remoteWorkspaceDir
    : localWorkspaceDir
  const noAgentsLabel = workspaceDir
    ? '(no configured agents)'
    : '(set workspace folder to load agents)'
  const noModelsLabel = workspaceDir
    ? '(no configured models)'
    : '(set workspace folder to load models)'

  try {
    const query = workspaceDir ? `?workspaceDir=${encodeURIComponent(workspaceDir)}` : ''
    const res = await fetch(buildNextVApiPath(`/api/nextv/workspace-config${query}`))
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to load workspace config')
    }

    const configuredAgents = Array.isArray(data?.configuredAgents) ? data.configuredAgents : []
    const configuredModels = Array.isArray(data?.configuredModels) ? data.configuredModels : []
    setNextVCallInspectorProjectConfig({
      agentsByName: data?.configuredAgentProfiles,
      modelsByName: data?.configuredModelConfigs,
      transportProvidersByName: data?.configuredTransportProviders,
      allowedTools: data?.configuredAllowedTools,
      toolAliases: data?.configuredToolAliases,
      agentDeclaredTools: data?.configuredAgentDeclaredTools,
    })
    setNextVCallInspectorAgentOptions(configuredAgents, { emptyLabel: noAgentsLabel })
    setNextVCallInspectorModelOptions(configuredModels, { emptyLabel: noModelsLabel })

    const storedAgent = String(localStorage.getItem(storageKeys.nextVCallInspectorTargetAgent) ?? '').trim()
    if (storedAgent && nextVCallTargetAgentInput) {
      const agentOptions = [...nextVCallTargetAgentInput.options].map((o) => o.value)
      if (agentOptions.includes(storedAgent)) nextVCallTargetAgentInput.value = storedAgent
    }
    const storedModel = String(localStorage.getItem(storageKeys.nextVCallInspectorTargetModel) ?? '').trim()
    if (storedModel && nextVCallTargetInput) {
      const modelOptions = [...nextVCallTargetInput.options].map((o) => o.value)
      if (modelOptions.includes(storedModel)) nextVCallTargetInput.value = storedModel
    }

    syncNextVCallInspectorTargetMode()
    renderNextVCallInspectorTargetConfig()
    renderNextVCallInspectorSnippet()
  } catch (err) {
    setNextVCallInspectorProjectConfig({})
    setNextVCallInspectorAgentOptions([], {
      emptyLabel: workspaceDir ? '(workspace config unavailable)' : noAgentsLabel,
    })
    setNextVCallInspectorModelOptions([], {
      emptyLabel: workspaceDir ? '(workspace config unavailable)' : noModelsLabel,
    })
    syncNextVCallInspectorTargetMode()
    renderNextVCallInspectorTargetConfig()
    if (!quiet) {
      appendNextVErrorLog(err)
      setStatus('could not load configured agents', 'responding')
    }
  }
}

function ensureNextVCallInspectorOption(selectEl, value) {
  if (!selectEl) return false
  const targetValue = String(value ?? '').trim()
  if (!targetValue) return false

  const existingOption = [...selectEl.options].find((option) => String(option.value ?? '').trim() === targetValue)
  if (existingOption) {
    selectEl.value = targetValue
    return true
  }

  const option = document.createElement('option')
  option.value = targetValue
  option.textContent = targetValue
  selectEl.appendChild(option)
  selectEl.value = targetValue
  return true
}

function applyNextVCallInspectorPrefill(prefill = {}) {
  if (!prefill || typeof prefill !== 'object') return

  const instructions = String(prefill.instructions ?? '').trim()
  if (instructions && nextVCallInstructionsInput) {
    nextVCallInstructionsInput.value = instructions
  }

  const prompt = String(prefill.prompt ?? '').trim()
  if (prompt && nextVCallPromptInput) {
    nextVCallPromptInput.value = prompt
  }

  const returnsText = String(prefill.returnsText ?? '').trim()
  if (returnsText && nextVCallReturnsInput) {
    nextVCallReturnsInput.value = returnsText
  }

  let decideText = ''
  if (Array.isArray(prefill.decide)) {
    decideText = prefill.decide.map((value) => String(value ?? '').trim()).filter(Boolean).join(', ')
  } else {
    decideText = String(prefill.decideText ?? '').trim()
  }
  if (decideText && nextVCallDecideInput) {
    nextVCallDecideInput.value = decideText
  }

  const validateRaw = String(prefill.validate ?? '').trim().toLowerCase()
  if (['strict', 'coerce', 'none'].includes(validateRaw) && nextVCallValidateInput) {
    nextVCallValidateInput.value = validateRaw
  }

  const retryNumeric = Number(prefill.retry)
  if (Number.isInteger(retryNumeric) && nextVCallRetryInput) {
    nextVCallRetryInput.value = String(Math.max(0, Math.min(8, retryNumeric)))
  }
}

export async function openNextVCallInspectorForToken(kind, value, options = {}) {
  const targetKind = String(kind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  const targetValue = String(value ?? '').trim()

  if (nextVCallInspectorPanel?.hidden) {
    toggleNextVCallInspectorPanel()
  }

  await refreshNextVCallInspectorAgents({ quiet: true })

  if (nextVCallTargetKindInput) {
    nextVCallTargetKindInput.value = targetKind
  }
  syncNextVCallInspectorTargetMode()

  if (targetKind === 'model') {
    if (targetValue) {
      ensureNextVCallInspectorOption(nextVCallTargetInput, targetValue)
    }
  } else {
    if (targetValue) {
      ensureNextVCallInspectorOption(nextVCallTargetAgentInput, targetValue)
    }
  }

  applyNextVCallInspectorPrefill(options?.prefill)

  persistNextVCallInspectorInputs()
  renderNextVCallInspectorTargetConfig()
  renderNextVCallInspectorSnippet()

  if (options?.focusPrompt !== false && nextVCallPromptInput) {
    nextVCallPromptInput.focus()
  }

  setStatus(
    targetValue
      ? `call inspector target set to ${targetKind}.${targetValue}`
      : `call inspector opened for ${targetKind} target`
  )
  return true
}

export function setNextVCallInspectorResultTab(tab) {
  const rawTab = String(tab ?? '').trim()
  const normalizedTab = rawTab === 'result'
    ? 'parsed'
    : (rawTab === 'retry' ? 'try' : rawTab)
  const nextTab = ['raw', 'actual', 'parsed', 'validation', 'try', 'metadata'].includes(normalizedTab)
    ? normalizedTab
    : 'raw'

  const buttons = {
    raw: nextVCallResultTabRaw,
    actual: nextVCallResultTabActual,
    parsed: nextVCallResultTabParsed,
    validation: nextVCallResultTabValidation,
    try: nextVCallResultTabTry,
    metadata: nextVCallResultTabMetadata,
  }
  const panes = {
    raw: nextVCallResultRaw,
    actual: nextVCallResultActual,
    parsed: nextVCallResultParsed,
    validation: nextVCallResultValidation,
    try: nextVCallResultTry,
    metadata: nextVCallResultMetadata,
  }

  for (const key of Object.keys(buttons)) {
    const button = buttons[key]
    const active = key === nextTab
    if (button) {
      button.classList.toggle('active', active)
      button.setAttribute('aria-selected', active ? 'true' : 'false')
    }
    const pane = panes[key]
    if (pane) {
      pane.hidden = !active
    }
  }

  localStorage.setItem(storageKeys.nextVCallInspectorResultTab, nextTab)
}

function getStoredNextVCallInspectorResultTab() {
  const storedRaw = String(localStorage.getItem(storageKeys.nextVCallInspectorResultTab) ?? '').trim()
  const stored = storedRaw === 'result'
    ? 'parsed'
    : (storedRaw === 'retry' ? 'try' : storedRaw)
  return ['raw', 'actual', 'parsed', 'validation', 'try', 'metadata'].includes(stored)
    ? stored
    : 'raw'
}

export function renderNextVCallInspectorResult(data, options = {}) {
  const response = data && typeof data === 'object' ? data : { value: data }
  const call = response?.call ?? null
  const result = response?.result ?? null
  const metadata = result?.metadata ?? null
  const modeRaw = String(call?.mode ?? nextVCallModeInput?.value ?? 'call').trim().toLowerCase()
  const mode = modeRaw === 'try' ? 'try' : 'call'
  const outputCandidates = [
    result?.actual,
    result?.output,
    result?.outputText,
    typeof result?.value === 'string' ? result.value : '',
    typeof result?.violation?.actual === 'string' ? result.violation.actual : '',
  ]
  const outputText = outputCandidates
    .map((value) => String(value ?? '').trim())
    .find((value) => value.length > 0) ?? ''
  const parsedValue = Object.prototype.hasOwnProperty.call(result ?? {}, 'parsed')
    ? result?.parsed
    : result?.value

  if (nextVCallResultRaw) {
    nextVCallResultRaw.textContent = stringifyInspectorPane(response)
  }
  if (nextVCallResultActual) {
    nextVCallResultActual.textContent = outputText || '(no output text captured)'
  }
  if (nextVCallResultParsed) {
    const parsedDisplayValue = mode === 'try'
      ? (parsedValue ?? result)
      : parsedValue
    nextVCallResultParsed.textContent = stringifyInspectorPane(parsedDisplayValue)
  }
  if (nextVCallResultValidation) {
    nextVCallResultValidation.textContent = stringifyInspectorPane({
      hadContractViolation: result?.hadContractViolation === true,
      violation: result?.violation ?? null,
      validate: call?.validate ?? null,
    })
  }
  if (nextVCallResultTry) {
    const finalRequest = response?.resolvedCall?.finalRequest ?? null
    const finalMessages = Array.isArray(finalRequest?.messages)
      ? finalRequest.messages
      : (Array.isArray(metadata?.request?.messages) ? metadata.request.messages : [])
    const retryGuidanceInjected = finalMessages.length > 0
      ? /the previous response/i.test(String([...finalMessages].reverse().find((entry) => String(entry?.role ?? '').trim() === 'user')?.content ?? ''))
      : false
    nextVCallResultTry.textContent = stringifyInspectorPane({
      configuredRetries: Number(call?.retry_on_contract_violation ?? 0),
      attempt: Number(metadata?.request?.attempt ?? 1),
      retryLimit: Number(metadata?.request?.retryLimit ?? call?.retry_on_contract_violation ?? 0),
      retryGuidanceInjected,
      finalMessages,
      finalRequest,
    })
  }
  if (nextVCallResultMetadata) {
    nextVCallResultMetadata.textContent = stringifyInspectorPane(metadata)
  }

  const forceTab = String(options?.forceTab ?? '').trim()
  setNextVCallInspectorResultTab(forceTab || getStoredNextVCallInspectorResultTab())
}

export function buildNextVCallInspectorSnippet() {
  const targetKindRaw = String(nextVCallTargetKindInput?.value ?? 'agent').trim().toLowerCase()
  const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
  const modeRaw = String(nextVCallModeInput?.value ?? 'call').trim().toLowerCase()
  const mode = modeRaw === 'try' ? 'try' : 'call'
  const target = getNextVCallInspectorTargetValue(targetKind)
  const instructions = String(nextVCallInstructionsInput?.value ?? '').trim()
  const prompt = String(nextVCallPromptInput?.value ?? '').trim()
  const returnsText = String(nextVCallReturnsInput?.value ?? '').trim()
  const decideText = String(nextVCallDecideInput?.value ?? '').trim()
  const validateRaw = String(nextVCallValidateInput?.value ?? 'coerce').trim().toLowerCase()
  const validate = ['strict', 'coerce', 'none'].includes(validateRaw) ? validateRaw : 'coerce'
  const retryRaw = Number(nextVCallRetryInput?.value)
  const retryCount = Number.isInteger(retryRaw) ? Math.max(0, Math.min(8, retryRaw)) : 0
  const toolsPolicyResult = buildNextVCallInspectorToolsPolicy()
  const toolsPolicy = toolsPolicyResult.ok ? toolsPolicyResult.policy : null

  const lines = []
  const head = target || (targetKind === 'agent' ? 'router' : 'model-id')
  lines.push(`result = ${mode === 'try' ? 'try ' : ''}${targetKind}(`)
  lines.push(`  ${JSON.stringify(head)},`)
  lines.push(`  ${JSON.stringify(prompt || 'prompt')},`)
  if (instructions) {
    lines.push(`  instructions=${JSON.stringify(instructions)},`)
  }
  if (returnsText) {
    lines.push(`  returns=${returnsText},`)
  }
  if (decideText) {
    const decideList = decideText
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => JSON.stringify(value))
      .join(',')
    lines.push(`  decide=[${decideList}],`)
  }
  if (validate !== 'coerce') {
    lines.push(`  validate=${JSON.stringify(validate)},`)
  }
  if (retryCount > 0) {
    lines.push(`  retry_on_contract_violation=${retryCount},`)
  }
  if (toolsPolicy && typeof toolsPolicy === 'object') {
    lines.push(`  tools=${JSON.stringify(toolsPolicy)},`)
  }
  lines.push(')')
  return lines.join('\n')
}

export function renderNextVCallInspectorSnippet() {
  renderNextVCallInspectorTargetConfig()
  if (!nextVCallGeneratedCode) return
  nextVCallGeneratedCode.textContent = buildNextVCallInspectorSnippet()
}

export function insertNextVCallInspectorSnippet() {
  const textarea = getPaneTextarea(activePaneId)
  if (!textarea) {
    setStatus('open an editor pane before inserting code', 'responding')
    return
  }

  const snippet = buildNextVCallInspectorSnippet()
  const start = Number(textarea.selectionStart ?? 0)
  const end = Number(textarea.selectionEnd ?? start)
  const original = String(textarea.value ?? '')
  const prefix = start > 0 && !original.slice(0, start).endsWith('\n') ? '\n' : ''
  const suffix = end < original.length && !original.slice(end).startsWith('\n') ? '\n' : ''
  const insertion = `${prefix}${snippet}${suffix}`
  textarea.value = `${original.slice(0, start)}${insertion}${original.slice(end)}`
  const caret = start + insertion.length
  textarea.setSelectionRange(caret, caret)
  textarea.focus()
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  appendNextVLogRow('[nextv:call-inspector] inserted generated code into active editor pane', 'step')
  setStatus('call inspector code inserted')
}

export function initNextVCallInspector() {
  const controls = [
    nextVCallModeInput,
    nextVCallTargetKindInput,
    nextVCallTargetAgentInput,
    nextVCallTargetInput,
    nextVCallValidateInput,
    nextVCallRetryInput,
    nextVCallInstructionsInput,
    nextVCallPromptInput,
    nextVCallReturnsInput,
    nextVCallDecideInput,
    nextVCallToolsModeInput,
    nextVCallToolsMaxRoundsInput,
    nextVCallToolsTimeoutMsInput,
    nextVCallToolsDenyUnknownInput,
    nextVCallToolsExtraInput,
  ]
  for (const control of controls) {
    if (!control || control.dataset.callInspectorBound === '1') continue
    control.dataset.callInspectorBound = '1'
    const rerender = () => {
      if (control === nextVCallTargetKindInput) {
        syncNextVCallInspectorTargetMode()
        if (String(nextVCallTargetKindInput?.value ?? '').trim().toLowerCase() !== 'model') {
          refreshNextVCallInspectorAgents({ quiet: true })
        }
      }
      if (control === nextVCallTargetAgentInput || control === nextVCallTargetInput) {
        renderNextVCallInspectorToolsChecklist()
      }
      if (control === nextVCallToolsModeInput) {
        syncNextVCallInspectorToolsModeUi()
      }
      persistNextVCallInspectorInputs()
      renderNextVCallInspectorSnippet()
    }
    control.addEventListener('input', rerender)
    control.addEventListener('change', rerender)
  }

  if (nextVCallToolsList && nextVCallToolsList.dataset.callInspectorBound !== '1') {
    nextVCallToolsList.dataset.callInspectorBound = '1'
    nextVCallToolsList.addEventListener('change', () => {
      persistNextVCallInspectorInputs()
      renderNextVCallInspectorSnippet()
    })
  }

  if (nextVWorkspaceDirInput && nextVWorkspaceDirInput.dataset.callInspectorWorkspaceBound !== '1') {
    nextVWorkspaceDirInput.dataset.callInspectorWorkspaceBound = '1'
    const refresh = () => {
      refreshNextVCallInspectorAgents({ quiet: true })
    }
    nextVWorkspaceDirInput.addEventListener('change', refresh)
    nextVWorkspaceDirInput.addEventListener('blur', refresh)
  }

  if (workspace && workspace.dataset.callInspectorRuntimeIdentityBound !== '1') {
    workspace.dataset.callInspectorRuntimeIdentityBound = '1'
    workspace.addEventListener('nextv:remote-workspace-identity', () => {
      refreshNextVCallInspectorAgents({ quiet: true })
    })
  }

  const tabButtons = [
    ['raw', nextVCallResultTabRaw],
    ['actual', nextVCallResultTabActual],
    ['parsed', nextVCallResultTabParsed],
    ['validation', nextVCallResultTabValidation],
    ['try', nextVCallResultTabTry],
    ['metadata', nextVCallResultTabMetadata],
  ]
  for (const [tabId, button] of tabButtons) {
    if (!button || button.dataset.callInspectorTabBound === '1') continue
    button.dataset.callInspectorTabBound = '1'
    button.addEventListener('click', () => {
      setNextVCallInspectorResultTab(tabId)
    })
  }

  restoreNextVCallInspectorInputs()
  syncNextVCallInspectorTargetMode()
  syncNextVCallInspectorToolsModeUi()
  refreshNextVCallInspectorAgents({ quiet: true })
  renderNextVCallInspectorSnippet()
  renderNextVCallInspectorResolvedCall(null)
  renderNextVCallInspectorResult({ status: 'call inspector ready' }, { forceTab: getStoredNextVCallInspectorResultTab() })
}

export function updateNextVEventImageUI() {
  if (nextVImageCount) {
    const count = nextVInputImageState.entries.length
    nextVImageCount.textContent = `${count} attached`
  }
  if (nextVImageList) {
    if (nextVInputImageState.entries.length === 0) {
      nextVImageList.textContent = ''
    } else {
      nextVImageList.textContent = nextVInputImageState.entries.map((entry) => entry.name).join(' | ')
    }
  }
  setNextVImagesOpen(nextVInputImageState.open, { persist: false })
}

export function readImageFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = (event) => {
      const dataUrl = String(event?.target?.result ?? '')
      const [, base64 = ''] = dataUrl.split(',')
      if (!base64) {
        reject(new Error(`Could not decode ${file.name}`))
        return
      }
      resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

export async function addNextVEventImages(filesLike) {
  const files = Array.from(filesLike ?? []).filter((file) => String(file?.type ?? '').startsWith('image/'))
  if (files.length === 0) {
    setStatus('no image files selected', 'responding')
    return
  }

  try {
    const loaded = []
    for (const file of files) {
      const base64 = await readImageFileAsBase64(file)
      loaded.push({
        name: String(file.name ?? 'image'),
        base64,
      })
    }

    nextVInputImageState.entries.push(...loaded)
    setNextVImagesOpen(true)
    updateNextVEventImageUI()
    setStatus(`${loaded.length} image${loaded.length === 1 ? '' : 's'} attached to nextv input`)
  } catch (err) {
    appendErrorRow(String(err?.message ?? err))
  }
}

export function clearNextVEventImages(options = {}) {
  nextVInputImageState.entries = []
  if (nextVImageInput) nextVImageInput.value = ''
  updateNextVEventImageUI()
  if (!options.silent) {
    setStatus('nextv input images cleared')
  }
}

export async function handleNextVImageInput(input) {
  const files = input?.files
  if (input) input.value = ''
  if (!files || files.length === 0) return
  await addNextVEventImages(files)
}

export function setupNextVImageDropzone() {
  if (!nextVImageDropzone) return

  const activate = () => nextVImageDropzone.classList.add('is-dragging')
  const deactivate = () => nextVImageDropzone.classList.remove('is-dragging')

  nextVImageDropzone.addEventListener('click', () => {
    nextVImageInput?.click()
  })

  nextVImageDropzone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    nextVImageInput?.click()
  })

  nextVImageDropzone.addEventListener('dragover', (event) => {
    event.preventDefault()
    activate()
  })

  nextVImageDropzone.addEventListener('dragenter', (event) => {
    event.preventDefault()
    activate()
  })

  nextVImageDropzone.addEventListener('dragleave', () => {
    deactivate()
  })

  nextVImageDropzone.addEventListener('drop', async (event) => {
    event.preventDefault()
    deactivate()
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return
    await addNextVEventImages(files)
  })
}

export function setLeftPanelWidth(percent) {
  const clamped = Math.max(25, Math.min(70, percent))
  document.documentElement.style.setProperty('--left-panel-width', `${clamped}%`)
  localStorage.setItem(storageKeys.leftWidth, String(clamped))
}

export function setupSplitter() {
  if (!splitter || !workspace) return

  splitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode() || window.innerWidth <= 760) return
    _setIsResizing(true)
    document.body.classList.add('is-resizing')
    event.preventDefault()
  })

  window.addEventListener('mousemove', (event) => {
    if (!isResizing) return
    const rect = workspace.getBoundingClientRect()
    const percent = ((event.clientX - rect.left) / rect.width) * 100
    setLeftPanelWidth(percent)
  })

  window.addEventListener('mouseup', () => {
    if (!isResizing) return
    _setIsResizing(false)
    document.body.classList.remove('is-resizing')
  })
}

export function setupFileTreeSplitter() {
  if (!fileTreeSplitter || !fileTreePane || !scriptSection) return

  const applyTreeWidth = (pixels) => {
    const sectionRect = scriptSection.getBoundingClientRect()
    const clamped = Math.max(180, Math.min(sectionRect.width * 0.55, pixels))
    fileTreePane.style.flex = `0 0 ${clamped}px`
    localStorage.setItem(storageKeys.nextVTreeWidth, String(clamped))
  }

  fileTreeSplitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode()) return
    _setIsFileTreeResizing(true)
    document.body.classList.add('is-resizing-filetree')
    event.preventDefault()
  })

  window.addEventListener('mousemove', (event) => {
    if (!isFileTreeResizing) return
    const sectionRect = scriptSection.getBoundingClientRect()
    applyTreeWidth(event.clientX - sectionRect.left)
  })

  window.addEventListener('mouseup', () => {
    if (!isFileTreeResizing) return
    _setIsFileTreeResizing(false)
    document.body.classList.remove('is-resizing-filetree')
  })

  const storedWidth = Number(localStorage.getItem(storageKeys.nextVTreeWidth))
  if (Number.isFinite(storedWidth) && storedWidth > 0) {
    applyTreeWidth(storedWidth)
  }
}

export function beginVerticalResize(event, topEl, bottomEl) {
  if (!topEl || !bottomEl) return
  const topRect = topEl.getBoundingClientRect()
  const bottomRect = bottomEl.getBoundingClientRect()
  _setActiveVerticalResize({
    topEl,
    bottomEl,
    startY: event.clientY,
    startTop: topRect.height,
    startBottom: bottomRect.height,
  })
  document.body.classList.add('is-vresizing')
  event.preventDefault()
}

export function getLeftPanelSections() {
  if (isNextVMode()) {
    if (!nextVPanelState.devConsoleOpen) {
      return [scriptSection]
    }
    return [scriptSection, outputSection]
  }
  return [scriptSection, logsSection, outputSection]
}

export function getLeftPanelSplitters() {
  if (isNextVMode()) {
    if (!nextVPanelState.devConsoleOpen) {
      return []
    }
    return [scriptVSplit1]
  }
  return [scriptVSplit1, scriptVSplit2]
}

export function normalizeSectionRatios(values, expectedLength = getLeftPanelSections().length) {
  if (!Array.isArray(values) || values.length !== expectedLength) return null
  const numeric = values.map((value) => Number(value))
  if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) return null
  const total = numeric.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  return numeric.map((value) => value / total)
}

export function readStoredLeftPanelHeights() {
  try {
    const raw = localStorage.getItem(storageKeys.leftHeights)
    if (!raw) return null
    return normalizeSectionRatios(JSON.parse(raw))
  } catch {
    return null
  }
}

export function getCurrentLeftPanelHeights() {
  return getLeftPanelSections().map((section) => section?.getBoundingClientRect().height ?? 0)
}

export function getAvailableLeftPanelSectionHeight() {
  const scriptPanel = document.getElementById('script-panel')
  if (!scriptPanel) return 0

  const controls = scriptPanel.querySelector('.script-controls')
  const controlsHeight = controls?.getBoundingClientRect().height ?? 0
  const splitters = getLeftPanelSplitters()
  const splitterHeightTotal = splitters.reduce((sum, splitterEl) => {
    return sum + (splitterEl?.getBoundingClientRect().height ?? 0)
  }, 0)
  const available = scriptPanel.getBoundingClientRect().height - controlsHeight - splitterHeightTotal

  return Number.isFinite(available) ? Math.max(0, available) : 0
}

export function getLeftPanelHeightRatios() {
  const heights = getCurrentLeftPanelHeights()
  return normalizeSectionRatios(heights)
}

export function persistLeftPanelHeights() {
  const ratios = getLeftPanelHeightRatios()
  if (!ratios) return
  localStorage.setItem(storageKeys.leftHeights, JSON.stringify(ratios))
}

export function resolveSectionHeights(totalHeight, ratios, minHeight) {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) return null
  const sectionCount = getLeftPanelSections().length
  if (totalHeight < minHeight * sectionCount) return null

  const normalized = normalizeSectionRatios(ratios, sectionCount)
  if (!normalized) return null

  const heights = Array.from({ length: sectionCount }, () => 0)
  const remaining = Array.from({ length: sectionCount }, (_, index) => index)
  let remainingTotal = totalHeight

  while (remaining.length > 0) {
    const ratioTotal = remaining.reduce((sum, index) => sum + normalized[index], 0)
    if (ratioTotal <= 0) return null

    const forced = remaining.filter((index) => ((normalized[index] / ratioTotal) * remainingTotal) < minHeight)
    if (forced.length === 0) {
      for (const index of remaining) {
        heights[index] = (normalized[index] / ratioTotal) * remainingTotal
      }
      break
    }

    if (remainingTotal < forced.length * minHeight) return null

    for (const index of forced) {
      heights[index] = minHeight
      remainingTotal -= minHeight
      remaining.splice(remaining.indexOf(index), 1)
    }
  }

  const used = heights.reduce((sum, value) => sum + value, 0)
  const delta = totalHeight - used
  if (Math.abs(delta) > 0.0001) {
    heights[heights.length - 1] += delta
  }

  return heights
}

export function applyLeftPanelHeights(ratios) {
  const normalized = normalizeSectionRatios(ratios)
  if (!normalized) return false

  const totalHeight = getAvailableLeftPanelSectionHeight()
  const nextHeights = resolveSectionHeights(totalHeight, normalized, MIN_LEFT_PANEL_SECTION_HEIGHT)
  if (!nextHeights) return false

  const sections = getLeftPanelSections()
  for (let i = 0; i < sections.length; i++) {
    sections[i].style.flex = `0 0 ${nextHeights[i]}px`
  }
  return true
}

export function applyStoredLeftPanelHeights() {
  const stored = readStoredLeftPanelHeights()
  if (!stored) return false
  return applyLeftPanelHeights(stored)
}

export function setupVerticalSplitters() {
  const bindSplitter = (splitterEl) => {
    if (!splitterEl) return
    splitterEl.addEventListener('mousedown', (event) => {
      const splitters = getLeftPanelSplitters()
      const sections = getLeftPanelSections()
      const index = splitters.indexOf(splitterEl)
      if (index < 0) return
      beginVerticalResize(event, sections[index], sections[index + 1])
    })
  }

  bindSplitter(scriptVSplit1)
  bindSplitter(scriptVSplit2)

  window.addEventListener('mousemove', (event) => {
    if (!activeVerticalResize) return

    const { topEl, bottomEl, startY, startTop, startBottom } = activeVerticalResize
    const delta = event.clientY - startY
    const total = startTop + startBottom
    const minHeight = MIN_LEFT_PANEL_SECTION_HEIGHT
    const nextTop = Math.max(minHeight, Math.min(total - minHeight, startTop + delta))
    const nextBottom = total - nextTop

    topEl.style.flex = `0 0 ${nextTop}px`
    bottomEl.style.flex = `0 0 ${nextBottom}px`
  })

  window.addEventListener('mouseup', () => {
    if (!activeVerticalResize) return
    _setActiveVerticalResize(null)
    document.body.classList.remove('is-vresizing')
    persistLeftPanelHeights()
  })

  window.addEventListener('resize', () => {
    if (activeVerticalResize) return
    applyStoredLeftPanelHeights()
  })
}

// Insert or append status bar just above footer
export function ensureStatusBar() {
  let bar = document.getElementById('status-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'status-bar'
    document.getElementById('workspace').before(bar)
  }
  return bar
}


// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  SCRIPT_FILE_CALL_REGEX,
  SCRIPT_FILE_REF_REGEX,
  _setActiveScriptAbortController,
  _setActiveScriptLine,
  _setIsBusy,
  activePaneId,
  activeScriptAbortController,
  activeScriptLine,
  activeScriptRunId,
  dirtyEditsCache,
  editorLayoutState,
  isBusy,
  isRemoteMode,
  nextVAutoSaveInput,
  nextVEntrypointInput,
  nextVFileState,
  nextVWorkspaceDirInput,
  paneAssignments,
  scriptCache,
  scriptDirtyBadge,
  scriptEditorState,
  scriptInputs,
  scriptLogs,
  scriptOutput,
  scriptPathInput,
  scriptView,
  tracePanelState,
  remoteRuntimeEntrypointPath,
  userInputText,
  workspace
} from './state.js'
import {
  updateScriptRunControls,
  normalizeDeclaredEffectChannels,
  setDeclaredEffectChannels,
  sendNextVUserText
} from './02_user_output.js'
import {
  isNextVMode,
  setActiveScriptRunId,
  normalizeDeclaredExternalChannels,
  setDeclaredExternalChannels,
  setNextVRunControls,
  clearNextVEventsOutput,
  clearNextVConsoleOutput
} from './03_ui_controls.js'
import {
  updateFloatingGraphCodePanelMeta,
  bindFloatingGraphCodePanelEvents
} from './04_floating_panels.js'
import {
  refreshNextVGraph,
  appendNextVLogRow
} from './07_graph_render.js'
import {
  normalizeRelativePath,
  normalizeNextVWorkspaceDir,
  resolveNextVPath,
  normalizePathSegments,
  pathDirname,
  joinRelativePath
} from './08_path_utils.js'
import {
  updateOpenFileLabel,
  renderOpenFileTabs,
  getStoredNextVOpenFile,
  clearNextVAutoSaveTimer,
  rememberExpandedPath,
  clearDeleteConfirmTimers,
  loadWorkspaceTree,
  saveCurrentEditorFile,
  saveAllNextVFiles,
  getPaneIds,
  getPaneState,
  getPaneElements,
  getPaneTextarea,
  getPaneMirror,
  getPaneGutter,
  getPanePath,
  clearEditorPane,
  focusEditorPane,
  setupEditorGridCenterHandle,
  setEditorLayout,
  renderPaneTitles,
  renderScriptMirrorForPane,
  onPaneDragOver,
  onPaneDragLeave,
  onPaneDrop,
  restorePaneAssignments,
  scheduleNextVAutoSave,
  openWorkspaceEditorFile,
  persistNextVConfig,
  getCurrentNextVEditorTabSize
} from './09_editor.js'
import {
  pathBasename
} from './10_file_tree.js'
import {
  clearTracePanel,
  closeNextVStream
} from './11_state_panels.js'
import {
  ensureStatusBar,
  openNextVCallInspectorForToken
} from './12_stream.js'

const SCRIPT_CALL_TARGET_REGEX = /\b(agent|model)\s*\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g
const SCRIPT_TOOL_KIND_REGEX = /\btool\s*\(\s*("agent"|'agent'|"model"|'model')/g
const SCRIPT_CALL_KIND_WORD_REGEX = /\b(agent|model)\b/g

export function setStatus(text, cls = '') {
  const bar = ensureStatusBar()
  bar.textContent = text
  bar.className = cls
}

// --- Session init ---
export async function loadSession() {
  try {
    const res = await fetch('/api/session')
    if (!res.ok) return {}
    return await res.json().catch(() => ({}))
  } catch {
    // best-effort
    return {}
  }
}

export function appendConfirmBlock(id, description, container = scriptLogs) {
  if (!container) return
  const block = document.createElement('div')
  block.className = 'confirm-block'
  block.id = `confirm-${id}`
  block.innerHTML = `
    <div class="confirm-desc">Allow tool: ${escapeHtml(description)}</div>
    <div class="confirm-buttons">
      <button class="allow-btn" onclick="resolveConfirm('${escapeHtml(id)}', true, this)">allow</button>
      <button class="deny-btn" onclick="resolveConfirm('${escapeHtml(id)}', false, this)">deny</button>
    </div>`
  container.appendChild(block)
  container.scrollTop = container.scrollHeight
}

export async function submitScriptInputResponse(scriptRunId, value, meta = {}) {
  const runId = String(scriptRunId ?? '').trim()
  if (!runId) {
    throw new Error('missing script run id')
  }

  const body = {
    scriptRunId: runId,
    value: String(value ?? ''),
    eventType: String(meta.eventType ?? 'external_event'),
    source: String(meta.source ?? 'external'),
  }

  if (meta.variable) body.variable = String(meta.variable)

  const res = await fetch('/api/script/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? 'failed to send script input')
  }
}

export function appendInputRequestNotice(payload) {
  const runId = String(payload?.scriptRunId ?? activeScriptRunId ?? '').trim()
  const promptText = String(payload?.prompt ?? 'Enter value:')
  const variable = String(payload?.variable ?? '').trim()

  const parts = []
  parts.push(`[script:input] requested${variable ? ` var=${variable}` : ''}`)
  parts.push(`prompt=${JSON.stringify(promptText)}`)
  if (runId) {
    parts.push(`scriptRunId=${runId}`)
  }
  appendScriptLogRow(parts.join(' '), 'step')
  appendScriptLogRow('[script:input] Send value via POST /api/script/event while the script is waiting on input().', 'result')
}

export function appendErrorRow(message) {
  appendScriptLogRow(`[error] ${String(message ?? 'unknown error')}`, 'error')
}

export async function resolveConfirm(id, allow, btn) {
  const container = btn?.closest('.confirm-block')
  container?.querySelectorAll('button')?.forEach((b) => { b.disabled = true })
  try {
    await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, allow }),
    })
    const label = container?.querySelector('.confirm-desc')
    if (label) label.textContent += allow ? ' -> allowed' : ' -> denied'
    setStatus(allow ? 'confirmation sent: allowed' : 'confirmation sent: denied')
  } catch (err) {
    appendErrorRow(`Confirm failed: ${err.message}`)
  }
}

export function appendScriptLogRow(line, cls = '') {
  const row = document.createElement('div')
  row.className = `script-log-row${cls ? ` ${cls}` : ''}`
  row.textContent = line
  scriptLogs.appendChild(row)
  scriptLogs.scrollTop = scriptLogs.scrollHeight
}

export function clearScriptLogs() {
  scriptLogs.innerHTML = ''
}

export function clearScriptLogsPanel() {
  if (isBusy) {
    const pending = scriptLogs.querySelector('.confirm-block')
    if (pending) {
      pending.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setStatus('confirmation required before clearing logs', 'responding')
    } else {
      setStatus('cannot clear logs while script is running', 'responding')
    }
    return
  }
  clearScriptLogs()
  setStatus('script logs cleared')
}

export function appendScriptOutputLine(line = '') {
  scriptOutput.textContent += `${line}\n`
  scriptOutput.scrollTop = scriptOutput.scrollHeight
}

export function clearScriptOutput() {
  scriptOutput.textContent = ''
}

export function clearScriptOutputPanel() {
  clearScriptOutput()
  setStatus('script output cleared')
}

export function clearOutputPanel() {
  if (!isNextVMode()) {
    clearScriptOutputPanel()
    return
  }

  if (tracePanelState.currentTab === 'events') {
    clearNextVEventsOutput()
    setStatus('events cleared')
    return
  }

  if (tracePanelState.currentTab === 'trace') {
    clearTracePanel()
    return
  }

  if (tracePanelState.currentTab === 'console') {
    clearNextVConsoleOutput()
    setStatus('console cleared')
    return
  }

  clearScriptOutputPanel()
}

export function setScriptBadgeState(text, cls = '') {
  if (!scriptDirtyBadge) return
  scriptDirtyBadge.textContent = text
  scriptDirtyBadge.classList.remove('saved', 'dirty')
  if (cls) scriptDirtyBadge.classList.add(cls)
}

export function syncScriptBadgeState() {
  const state = getPaneState(activePaneId)
  const content = getScriptEditorText()
  if (!content && !state.path) {
    setScriptBadgeState('empty')
    return
  }
  if (state.dirty) {
    setScriptBadgeState('dirty', 'dirty')
    return
  }
  setScriptBadgeState('saved', 'saved')
}

export function cancelScriptRun() {
  if (!activeScriptAbortController) {
    setStatus('no active script run', 'responding')
    return
  }

  activeScriptAbortController.abort()
  appendScriptLogRow('[script:cancel] Cancellation requested.', 'error')
  setStatus('cancelling script…', 'responding')
}

export function clearScriptView() {
  clearNextVAutoSaveTimer()
  for (const paneId of getPaneIds()) {
    clearEditorPane(paneId)
  }
  _setActiveScriptLine(null)
  nextVFileState.openFilePath = ''
  nextVFileState.openTabs = []
  dirtyEditsCache.clear()
  paneAssignments.clear()
  updateOpenFileLabel('')
  renderScriptMirror('')
  syncScriptBadgeState()
  renderPaneTitles()
  renderOpenFileTabs()
}

export function normalizeNewlines(textValue) {
  return String(textValue ?? '').replace(/\r\n/g, '\n')
}

function getApproximateTextareaOffsetAtPoint(textarea, clientX, clientY) {
  if (!textarea) return null
  const rect = textarea.getBoundingClientRect()
  if (
    clientX < rect.left
    || clientX > rect.right
    || clientY < rect.top
    || clientY > rect.bottom
  ) {
    return null
  }

  const text = normalizeNewlines(textarea.value)
  const lines = text.split('\n')
  const style = window.getComputedStyle(textarea)
  const lineHeight = Math.max(1, Number.parseFloat(style.lineHeight) || 20)
  const fontSize = Math.max(1, Number.parseFloat(style.fontSize) || 13)
  const charWidth = Math.max(6, fontSize * 0.62)
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0

  const contentY = clientY - rect.top + textarea.scrollTop - paddingTop
  const contentX = clientX - rect.left + textarea.scrollLeft - paddingLeft
  const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor(contentY / lineHeight)))
  const lineText = lines[lineIndex] ?? ''
  const column = Math.max(0, Math.min(lineText.length, Math.floor(contentX / charWidth)))

  let offset = 0
  for (let i = 0; i < lineIndex; i += 1) {
    offset += (lines[i]?.length ?? 0) + 1
  }
  offset += column
  return Math.max(0, Math.min(text.length, offset))
}

export function getTextareaOffsetAtPoint(textarea, clientX, clientY) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(clientX, clientY)
    const offset = Number(pos?.offset)
    if (Number.isFinite(offset)) return offset
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(clientX, clientY)
    const offset = Number(range?.startOffset)
    if (Number.isFinite(offset)) return offset
  }
  return getApproximateTextareaOffsetAtPoint(textarea, clientX, clientY)
}

export function bindTextareaFileRefCursor(textarea, getTextFn) {
  textarea.addEventListener('mousemove', (ev) => {
    const offset = getTextareaOffsetAtPoint(textarea, ev.clientX, ev.clientY)
    if (offset === null) { textarea.style.cursor = ''; return }
    const text = normalizeNewlines(getTextFn())
    const candidates = [offset, Math.max(0, offset - 1)]
    const hit = candidates.some((candidateOffset) => findEditorClickTargetAtOffset(text, candidateOffset) !== null)
    textarea.style.cursor = hit ? 'pointer' : ''
  })
  textarea.addEventListener('mouseleave', () => { textarea.style.cursor = '' })
}

export function inferEditorKindFromContext(lineText, tokenStart, marker) {
  if (marker === '!') return 'instruction'
  if (marker === '?') return 'prompt'

  const prior = String(lineText ?? '').slice(0, tokenStart).toLowerCase()
  const lastInstructions = prior.lastIndexOf('instructions=')
  const lastPrompt = prior.lastIndexOf('prompt=')
  if (lastPrompt > lastInstructions) return 'prompt'
  return 'instruction'
}

export function findScriptReferenceAtOffset(textValue, offset) {
  const text = normalizeNewlines(textValue)
  if (!text) return null

  const safeOffset = Math.max(0, Math.min(text.length, Number(offset) || 0))
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1
  const nextNewline = text.indexOf('\n', safeOffset)
  const lineEnd = nextNewline === -1 ? text.length : nextNewline
  const line = text.slice(lineStart, lineEnd)
  const lineOffset = safeOffset - lineStart

  SCRIPT_FILE_REF_REGEX.lastIndex = 0
  let match
  while ((match = SCRIPT_FILE_REF_REGEX.exec(line)) !== null) {
    const marker = match[1] || ''
    const filePath = match[2]
    const start = match.index
    const end = start + match[0].length
    if (lineOffset < start || lineOffset > end) continue

    return {
      filePath,
      kind: inferEditorKindFromContext(line, start, marker),
    }
  }

  SCRIPT_FILE_CALL_REGEX.lastIndex = 0
  while ((match = SCRIPT_FILE_CALL_REGEX.exec(line)) !== null) {
    const filePath = match[1]
    const start = match.index
    const end = start + match[0].length
    if (lineOffset < start || lineOffset > end) continue
    return { filePath, kind: 'file' }
  }

  return null
}

function decodeCallTargetLiteral(literal) {
  const rawLiteral = String(literal ?? '').trim()
  if (!rawLiteral) return ''
  if (rawLiteral.startsWith('"')) {
    try {
      return String(JSON.parse(rawLiteral))
    } catch {
      return rawLiteral.slice(1, -1)
    }
  }
  if (rawLiteral.startsWith("'")) {
    return rawLiteral
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
  }
  return rawLiteral
}

function extractFirstStringLiteral(value) {
  const source = String(value ?? '')
  const match = /(\"([^\"\\]|\\.)*\"|'([^'\\]|\\.)*')/.exec(source)
  if (!match) return ''
  return decodeCallTargetLiteral(match[1])
}

function findMatchingParen(text, openParenIndex) {
  const source = String(text ?? '')
  const start = Number(openParenIndex)
  if (!Number.isInteger(start) || start < 0 || start >= source.length || source[start] !== '(') return -1

  let depth = 0
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function findCallSegmentAtOffset(textValue, kind, offset) {
  const text = normalizeNewlines(textValue)
  const normalizedKind = String(kind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  const safeOffset = Math.max(0, Math.min(text.length, Number(offset) || 0))

  const directRegex = /\b(agent|model)\s*\(/g
  let match
  while ((match = directRegex.exec(text)) !== null) {
    const callKind = String(match[1] ?? '').trim().toLowerCase()
    if (callKind !== normalizedKind) continue
    const openParenIndex = text.indexOf('(', match.index)
    if (openParenIndex < 0) continue
    const closeParenIndex = findMatchingParen(text, openParenIndex)
    if (closeParenIndex < 0) continue
    if (safeOffset < match.index || safeOffset > closeParenIndex) continue
    return text.slice(match.index, closeParenIndex + 1)
  }

  const toolRegex = /\btool\s*\(/g
  while ((match = toolRegex.exec(text)) !== null) {
    const openParenIndex = text.indexOf('(', match.index)
    if (openParenIndex < 0) continue
    const closeParenIndex = findMatchingParen(text, openParenIndex)
    if (closeParenIndex < 0) continue
    if (safeOffset < match.index || safeOffset > closeParenIndex) continue

    const segment = text.slice(match.index, closeParenIndex + 1)
    const toolKindMatch = /\btool\s*\(\s*(\"agent\"|'agent'|\"model\"|'model')/s.exec(segment)
    if (!toolKindMatch) continue
    const callKind = decodeCallTargetLiteral(toolKindMatch[1]).toLowerCase() === 'model' ? 'model' : 'agent'
    if (callKind !== normalizedKind) continue
    return segment
  }

  return ''
}

function inferCallInspectorPrefillFromDocument(textValue, kind, offset) {
  const segment = findCallSegmentAtOffset(textValue, kind, offset)
  if (!segment) return null

  const prefill = {}

  const directPromptMatch = /^\s*(agent|model)\s*\(\s*(\"([^\"\\]|\\.)*\"|'([^'\\]|\\.)*')\s*,\s*(\"([^\"\\]|\\.)*\"|'([^'\\]|\\.)*')/s.exec(segment)
  if (directPromptMatch) {
    const prompt = decodeCallTargetLiteral(directPromptMatch[6])
    if (prompt) prefill.prompt = prompt
  }

  const instructionsMatch = /\binstructions\s*[:=]\s*(\"([^\"\\]|\\.)*\"|'([^'\\]|\\.)*')/s.exec(segment)
  if (instructionsMatch) {
    prefill.instructions = decodeCallTargetLiteral(instructionsMatch[1])
  }

  const validateMatch = /\bvalidate\s*[:=]\s*(strict|coerce|none|\"strict\"|\"coerce\"|\"none\"|'strict'|'coerce'|'none')/s.exec(segment)
  if (validateMatch) {
    const validate = decodeCallTargetLiteral(validateMatch[1]).toLowerCase()
    if (['strict', 'coerce', 'none'].includes(validate)) {
      prefill.validate = validate
    }
  }

  const retryMatch = /\bretry_on_contract_violation\s*[:=]\s*(\d+)/s.exec(segment)
  if (retryMatch) {
    prefill.retry = Number(retryMatch[1])
  }

  const decideMatch = /\bdecide\s*[:=]\s*\[([\s\S]*?)\]/s.exec(segment)
  if (decideMatch) {
    const decideRaw = decideMatch[1]
    const options = []
    const literalRegex = /(\"([^\"\\]|\\.)*\"|'([^'\\]|\\.)*')/g
    let literal
    while ((literal = literalRegex.exec(decideRaw)) !== null) {
      const value = decodeCallTargetLiteral(literal[1])
      if (value) options.push(value)
    }
    if (options.length > 0) {
      prefill.decide = options
    }
  }

  const returnsMatch = /\breturns\s*[:=]\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/s.exec(segment)
  if (returnsMatch) {
    prefill.returnsText = String(returnsMatch[1] ?? '').trim()
  }

  return Object.keys(prefill).length > 0 ? prefill : null
}

function inferToolCallTargetValue(line, kind, searchStart = 0) {
  const source = String(line ?? '')
  const normalizedKind = String(kind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  const valuePattern = normalizedKind === 'model'
    ? /\b(model|name|target|id)\b\s*[:=]\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/
    : /\b(agent|name|target|id)\b\s*[:=]\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/

  const match = valuePattern.exec(source.slice(Math.max(0, Number(searchStart) || 0)))
  if (!match) return ''
  return decodeCallTargetLiteral(match[2])
}

function inferCallTargetValueFromLine(line, kind, searchStart = 0) {
  const source = String(line ?? '')
  const normalizedKind = String(kind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  const directPattern = normalizedKind === 'model'
    ? /\bmodel\s*\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/
    : /\bagent\s*\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/
  const directMatch = directPattern.exec(source.slice(Math.max(0, Number(searchStart) || 0)))
  if (directMatch) {
    return decodeCallTargetLiteral(directMatch[1])
  }

  return inferToolCallTargetValue(source, normalizedKind, searchStart)
}

function inferCallTargetValueFromDocument(textValue, kind, offset) {
  const text = normalizeNewlines(textValue)
  const normalizedKind = String(kind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  const safeOffset = Math.max(0, Math.min(text.length, Number(offset) || 0))
  const sliceStart = Math.max(0, safeOffset - 80)
  const sliceEnd = Math.min(text.length, safeOffset + 1200)
  const scope = text.slice(sliceStart, sliceEnd)
  const localOffset = safeOffset - sliceStart

  const directPattern = normalizedKind === 'model'
    ? /\bmodel\s*\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/s
    : /\bagent\s*\(\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/s
  const directMatch = directPattern.exec(scope.slice(Math.max(0, localOffset - 16)))
  if (directMatch) {
    return decodeCallTargetLiteral(directMatch[1])
  }

  const toolPattern = normalizedKind === 'model'
    ? /\btool\s*\(\s*("model"|'model')[\s\S]{0,800}?\b(model|name|target|id)\b\s*[:=]\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/s
    : /\btool\s*\(\s*("agent"|'agent')[\s\S]{0,800}?\b(agent|name|target|id)\b\s*[:=]\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/s
  const toolMatch = toolPattern.exec(scope.slice(Math.max(0, localOffset - 32)))
  if (toolMatch) {
    return decodeCallTargetLiteral(toolMatch[3])
  }

  return ''
}

function collectCallInspectorTargetsInLine(line) {
  const text = String(line ?? '')
  const matches = []
  SCRIPT_CALL_TARGET_REGEX.lastIndex = 0
  let match
  while ((match = SCRIPT_CALL_TARGET_REGEX.exec(text)) !== null) {
    const kind = String(match[1] ?? '').trim().toLowerCase()
    const literal = String(match[2] ?? '')
    const literalIndex = String(match[0] ?? '').indexOf(literal)
    if (literalIndex < 0) continue

    const start = Number(match.index) + literalIndex
    const end = start + literal.length
    matches.push({
      start,
      end,
      text: literal,
      kind,
      value: decodeCallTargetLiteral(literal),
    })
  }

  SCRIPT_TOOL_KIND_REGEX.lastIndex = 0
  while ((match = SCRIPT_TOOL_KIND_REGEX.exec(text)) !== null) {
    const kind = decodeCallTargetLiteral(match[1]).toLowerCase() === 'model' ? 'model' : 'agent'
    const literal = String(match[1] ?? '')
    const literalIndex = String(match[0] ?? '').indexOf(literal)
    if (literalIndex < 0) continue

    const start = Number(match.index) + literalIndex
    const end = start + literal.length
    matches.push({
      start,
      end,
      text: literal,
      kind,
      value: inferToolCallTargetValue(text, kind, end),
    })
  }

  return matches
}

export function findCallInspectorTargetAtOffset(textValue, offset) {
  const text = normalizeNewlines(textValue)
  if (!text) return null

  const safeOffset = Math.max(0, Math.min(text.length, Number(offset) || 0))
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1
  const nextNewline = text.indexOf('\n', safeOffset)
  const lineEnd = nextNewline === -1 ? text.length : nextNewline
  const line = text.slice(lineStart, lineEnd)
  const lineOffset = safeOffset - lineStart

  const matches = collectCallInspectorTargetsInLine(line)
  for (const match of matches) {
    if (lineOffset < match.start || lineOffset > match.end) continue
    if (match.kind !== 'agent' && match.kind !== 'model') continue
    return {
      kind: match.kind,
      value: String(match.value ?? '').trim(),
      prefill: inferCallInspectorPrefillFromDocument(text, match.kind, safeOffset),
    }
  }

  SCRIPT_CALL_KIND_WORD_REGEX.lastIndex = 0
  let keywordMatch
  while ((keywordMatch = SCRIPT_CALL_KIND_WORD_REGEX.exec(line)) !== null) {
    const start = keywordMatch.index
    const end = start + String(keywordMatch[0] ?? '').length
    if (lineOffset < start || lineOffset > end) continue
    const kind = String(keywordMatch[1] ?? '').trim().toLowerCase()
    if (kind !== 'agent' && kind !== 'model') continue
    return {
      kind,
      value: inferCallTargetValueFromLine(line, kind, start) || inferCallTargetValueFromDocument(text, kind, safeOffset),
      prefill: inferCallInspectorPrefillFromDocument(text, kind, safeOffset),
    }
  }

  const contextualKindMatch = /\b(agent|model)\b/i.exec(line)
  if (contextualKindMatch) {
    const kind = String(contextualKindMatch[1] ?? '').trim().toLowerCase()
    if (kind === 'agent' || kind === 'model') {
      const value = inferCallTargetValueFromDocument(text, kind, safeOffset)
      if (value) {
        return {
          kind,
          value,
          prefill: inferCallInspectorPrefillFromDocument(text, kind, safeOffset),
        }
      }
    }
  }

  return null
}

export function findEditorClickTargetAtOffset(textValue, offset) {
  const callTarget = findCallInspectorTargetAtOffset(textValue, offset)
  if (callTarget) {
    return {
      type: 'call-target',
      value: callTarget,
    }
  }

  const fileReference = findScriptReferenceAtOffset(textValue, offset)
  if (fileReference) {
    return {
      type: 'file-reference',
      value: fileReference,
    }
  }

  return null
}

export function buildScriptMirrorLine(textValue) {
  const row = document.createElement('div')
  row.className = 'script-editor-line'

  const textWrap = document.createElement('span')
  textWrap.className = 'script-editor-line-text'

  const line = String(textValue ?? '')
  const tokens = []
  let match

  SCRIPT_FILE_REF_REGEX.lastIndex = 0
  while ((match = SCRIPT_FILE_REF_REGEX.exec(line)) !== null) {
    const marker = match[1] || ''
    tokens.push({ start: match.index, end: match.index + match[0].length, text: match[0], filePath: match[2], kind: inferEditorKindFromContext(line, match.index, marker) })
  }

  SCRIPT_FILE_CALL_REGEX.lastIndex = 0
  while ((match = SCRIPT_FILE_CALL_REGEX.exec(line)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length, text: match[0], filePath: match[1], kind: 'file' })
  }

  const callTargets = collectCallInspectorTargetsInLine(line)
  for (const target of callTargets) {
    tokens.push({
      start: target.start,
      end: target.end,
      text: target.text,
      kind: target.kind,
      callTarget: target.value,
    })
  }

  SCRIPT_CALL_KIND_WORD_REGEX.lastIndex = 0
  while ((match = SCRIPT_CALL_KIND_WORD_REGEX.exec(line)) !== null) {
    const kind = String(match[1] ?? '').trim().toLowerCase()
    if (kind !== 'agent' && kind !== 'model') continue
    tokens.push({
      start: match.index,
      end: match.index + String(match[0] ?? '').length,
      text: match[0],
      kind,
      callTarget: inferCallTargetValueFromLine(line, kind, match.index),
    })
  }

  tokens.sort((a, b) => a.start - b.start)

  let lastIndex = 0
  for (const tok of tokens) {
    if (tok.start < lastIndex) continue
    if (tok.start > lastIndex) {
      textWrap.appendChild(document.createTextNode(line.slice(lastIndex, tok.start)))
    }
    const token = document.createElement('span')
    token.className = `script-ref-token ${tok.kind}`
    token.textContent = tok.text
    token.title = tok.kind === 'agent' || tok.kind === 'model'
      ? `${tok.kind}: ${tok.callTarget}`
      : `${tok.kind}: ${tok.filePath}`
    textWrap.appendChild(token)
    lastIndex = tok.end
  }

  if (lastIndex < line.length) {
    textWrap.appendChild(document.createTextNode(line.slice(lastIndex)))
  }

  if (!line) {
    textWrap.appendChild(document.createTextNode(' '))
  }

  row.appendChild(textWrap)

  return row
}

export function syncScriptMirrorScrollForPane(paneId) {
  const textarea = getPaneTextarea(paneId)
  const mirror = getPaneMirror(paneId)
  const gutter = getPaneGutter(paneId)
  if (!textarea) return
  if (!mirror && !gutter) return
  if (mirror) {
    mirror.scrollTop = textarea.scrollTop
    mirror.scrollLeft = textarea.scrollLeft
  }
  if (gutter) {
    gutter.scrollTop = textarea.scrollTop
  }
}

export function syncScriptMirrorScroll() {
  syncScriptMirrorScrollForPane('A')
}

export function renderScriptMirror(textValue = getScriptEditorText()) {
  renderScriptMirrorForPane('A', textValue)
}

export async function openEditorReference(filePath) {
  const targetPath = String(filePath ?? '').trim()
  if (!targetPath) return

  if (!isNextVMode()) {
    setStatus(`file reference selected: ${targetPath}`)
    return
  }

  const currentDir = pathDirname(getPaneState(activePaneId).path)
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const resolvedPath = (
    targetPath.startsWith('workspaces/')
    || (workspaceDir && (targetPath === workspaceDir || targetPath.startsWith(`${workspaceDir}/`)))
  )
    ? normalizePathSegments(targetPath)
    : joinRelativePath(currentDir || workspaceDir, targetPath)

  try {
    await openWorkspaceEditorFile(resolvedPath)
    setStatus(`opened ${resolvedPath}`)
  } catch (err) {
    appendScriptLogRow(`[file:error] ${err.message}`, 'error')
    setStatus('file open error', 'responding')
  }
}

export async function openEditorCallInspectorTarget(target) {
  const kind = String(target?.kind ?? '').trim().toLowerCase() === 'model' ? 'model' : 'agent'
  const value = String(target?.value ?? '').trim()

  const opened = await openNextVCallInspectorForToken(kind, value, {
    focusPrompt: true,
    prefill: target?.prefill ?? null,
  })
  if (!opened) {
    const label = value ? `${kind}.${value}` : `${kind}`
    setStatus(`unable to open call inspector target ${label}`, 'responding')
  }
}

export async function openEditorClickTargetAtOffset(textValue, offset) {
  const target = findEditorClickTargetAtOffset(textValue, offset)
  if (!target) return false

  if (target.type === 'call-target') {
    await openEditorCallInspectorTarget(target.value)
    return true
  }

  if (target.type === 'file-reference') {
    await openEditorReference(target.value.filePath)
    return true
  }

  return false
}

export function getScriptEditorText() {
  return normalizeNewlines(getPaneTextarea(activePaneId)?.value ?? '')
}

export function renderScriptView(lines, filePath = '') {
  const text = normalizeNewlines(Array.isArray(lines) ? lines.join('\n') : '')
  const paneState = getPaneState('A')
  if (scriptView) scriptView.value = text
  paneState.path = filePath
  paneState.loadedText = text
  paneState.dirty = false
  _setActiveScriptLine(null)
  updateOpenFileLabel(filePath)
  renderScriptMirror(text)
  if (scriptPathInput && filePath) {
    scriptPathInput.value = filePath
  }
  syncScriptBadgeState()
}

export function highlightScriptLine(lineNumber) {
  const line = Number(lineNumber)
  if (!Number.isFinite(line) || line < 1) return

  const lines = getScriptEditorText().split('\n')
  if (line > lines.length) return

  let start = 0
  for (let i = 0; i < line - 1; i++) {
    start += lines[i].length + 1
  }

  const end = start + (lines[line - 1]?.length ?? 0)
  scriptView.focus({ preventScroll: true })
  scriptView.setSelectionRange(start, end)

  const lineHeight = Number.parseFloat(window.getComputedStyle(scriptView).lineHeight) || 18
  scriptView.scrollTop = Math.max(0, (line - 2) * lineHeight)
  _setActiveScriptLine(line)
  renderScriptMirror()
}

export function parseScriptStepLine(line) {
  const match = String(line ?? '').match(/^\[script:step\]\s+line=(\d+)\b/)
  if (!match) return null
  return Number(match[1])
}

export function isScriptMetaLine(line) {
  return /^\[script:/.test(String(line ?? ''))
}

export async function loadScriptContent(filePath) {
  const key = String(filePath ?? '').trim()
  if (!key) return

  const cached = scriptCache.get(key)
  if (cached) {
    renderScriptView(cached, key)
    return
  }

  const url = `/api/script/content?filePath=${encodeURIComponent(key)}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data.error ?? 'Unable to load script content.')
  }

  const lines = Array.isArray(data.lines) ? data.lines : []
  scriptCache.set(key, lines)
  renderScriptView(lines, data.filePath ?? key)
}

export async function ensureNextVEntrypointVisible(options = {}) {
  if (!isNextVMode()) return

  const capabilities = nextVFileState?.capabilities
  const canOpenWorkspaceFiles = capabilities && typeof capabilities === 'object'
    ? capabilities.workspaceFileRead === true
    : (isRemoteMode !== true)
  if (!canOpenWorkspaceFiles) return

  const { logLoaded = false, warnOnDirty = true } = options
  const entrypointPath = resolveNextVPath(nextVEntrypointInput?.value)
  if (!entrypointPath) return

  const activePaneState = getPaneState(activePaneId)
  const editorPath = String(activePaneState.path ?? '').trim()
  const hasUnsaved = activePaneState.dirty === true
  if (warnOnDirty && hasUnsaved && editorPath && editorPath !== entrypointPath) {
    appendScriptLogRow(`[nextv:entrypoint] unsaved edits in ${editorPath}; keeping current editor buffer`, 'error')
    return
  }

  if (editorPath === entrypointPath && !hasUnsaved) return

  try {
    await openWorkspaceEditorFile(entrypointPath)
    if (logLoaded) {
      appendScriptLogRow(`[nextv:entrypoint] loaded ${pathBasename(entrypointPath)}`, 'step')
    }
  } catch (err) {
    appendScriptLogRow(`[nextv:entrypoint:error] ${err.message}`, 'error')
  }
}

export async function openNextVWorkspace() {
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!workspaceDir) {
    setStatus('nextv workspace required', 'responding')
    return
  }

  if (nextVWorkspaceDirInput) {
    nextVWorkspaceDirInput.value = workspaceDir
  }

  // 1. Try to read entrypoint from nextv.json workspace config
  let configEntrypoint = ''
  let configDeclaredExternals = []
  let configDeclaredEffects = []
  let workspaceConfigCapabilities = null
  let workspaceConfigRuntimeOwned = false
  try {
    const cfgRes = await fetch(`/api/nextv/workspace-config?workspaceDir=${encodeURIComponent(workspaceDir)}`)
    if (cfgRes.ok) {
      const cfg = await cfgRes.json()
      configEntrypoint = String(cfg.entrypointPath ?? '').trim()
      configDeclaredExternals = normalizeDeclaredExternalChannels(cfg.declaredExternals)
      configDeclaredEffects = normalizeDeclaredEffectChannels(cfg.declaredEffects)
      workspaceConfigCapabilities = cfg?.capabilities && typeof cfg.capabilities === 'object'
        ? { ...cfg.capabilities }
        : null
      workspaceConfigRuntimeOwned = cfg?.runtimeOwned === true
    }
  } catch {
    configDeclaredExternals = []
    configDeclaredEffects = []
  }

  if (workspaceConfigCapabilities) {
    nextVFileState.capabilities = workspaceConfigCapabilities
  }

  // 2. Determine candidate entrypoint: config first, then active/runtime hints, then common defaults.
  const currentEntrypoint = normalizeRelativePath(nextVEntrypointInput?.value ?? '')
  const runtimeEntrypoint = normalizeRelativePath(remoteRuntimeEntrypointPath ?? '')
  const fallbackEntrypoints = [...new Set([
    currentEntrypoint,
    runtimeEntrypoint,
    'workflow.nrv',
    'workflow.wfs',
    'step.nrv',
    'step.wfs',
  ].filter(Boolean))]
  const candidateEntrypoints = configEntrypoint
    ? [configEntrypoint, ...fallbackEntrypoints.filter((entry) => entry !== configEntrypoint)]
    : fallbackEntrypoints
  let candidateEntrypoint = candidateEntrypoints[0] || ''
  let candidateEntrypointPath = candidateEntrypoint ? `${workspaceDir}/${candidateEntrypoint}` : ''
  const canOpenWorkspaceFiles = workspaceConfigCapabilities && typeof workspaceConfigCapabilities === 'object'
    ? workspaceConfigCapabilities.workspaceFileRead === true
    : (isRemoteMode !== true)

  let loadedEntrypoint = false
  if (!canOpenWorkspaceFiles || workspaceConfigRuntimeOwned) {
    if (nextVEntrypointInput) {
      nextVEntrypointInput.value = candidateEntrypoint
    }
    appendNextVLogRow('[nextv:workspace] runtime-owned workspace detected; file editor is disabled in observability-only mode', 'result')
    if (candidateEntrypoint) {
      appendNextVLogRow(`[nextv:workspace] using runtime entrypoint ${candidateEntrypoint}`, 'result')
    }
    loadedEntrypoint = Boolean(candidateEntrypoint)
  } else {
  try {
    await loadWorkspaceTree(workspaceDir)
    const storedOpenFile = getStoredNextVOpenFile()
    const preferredOpenFile = storedOpenFile && storedOpenFile.startsWith(`${workspaceDir}/`)
      ? storedOpenFile
      : ''

    const restoredPanes = await restorePaneAssignments({ workspaceDir, preferredOpenFile })

    let openedPath = ''
    if (restoredPanes.restoredCount > 0) {
      openedPath = restoredPanes.focusedPath || preferredOpenFile || restoredPanes.firstPath
    } else {
      const openAttempts = []
      if (preferredOpenFile) openAttempts.push(preferredOpenFile)
      for (const relPath of candidateEntrypoints) {
        const fullPath = `${workspaceDir}/${relPath}`
        if (!openAttempts.includes(fullPath)) {
          openAttempts.push(fullPath)
        }
      }

      for (const attemptPath of openAttempts) {
        try {
          await openWorkspaceEditorFile(attemptPath)
          openedPath = attemptPath
          break
        } catch {
          // try next candidate
        }
      }
    }

    if (!openedPath) {
      throw new Error('No entrypoint candidates found')
    }

    if (!configEntrypoint) {
      candidateEntrypointPath = openedPath
      const trimmedWorkspacePrefix = `${workspaceDir}/`
      candidateEntrypoint = openedPath.startsWith(trimmedWorkspacePrefix)
        ? openedPath.slice(trimmedWorkspacePrefix.length)
        : openedPath
    }

    rememberExpandedPath(candidateEntrypointPath)
    loadedEntrypoint = true
    if (nextVEntrypointInput) {
      nextVEntrypointInput.value = candidateEntrypoint
    }
    appendNextVLogRow(`[nextv:workspace] loaded ${getPanePath(activePaneId) || normalizeRelativePath(openedPath)}`, 'step')
    if (configEntrypoint) {
      appendNextVLogRow(`[nextv:workspace] entrypoint from nextv.json: ${configEntrypoint}`, 'result')
    }
  } catch (err) {
    if (nextVEntrypointInput) {
      nextVEntrypointInput.value = ''
    }
    appendNextVLogRow(`[nextv:workspace] ${candidateEntrypointPath} not found — select an entrypoint to enable start`, 'result')
  }
  }

  persistNextVConfig()
  setDeclaredExternalChannels(configDeclaredExternals, { preserveSelection: true })
  setDeclaredEffectChannels(configDeclaredEffects, { preserveSelection: true })
  setNextVRunControls()
  await refreshNextVGraph({ silent: true })
  if (loadedEntrypoint) {
    setStatus('workspace opened')
  } else {
    setStatus('no entrypoint found', 'responding')
  }
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- SSE stream parser ---
// Parses complete SSE events from a growing string buffer.
// Returns {events: [{event, data}], remaining: string}
export function parseSSEBuffer(buffer) {
  const events = []
  let pos = 0
  while (true) {
    const end = buffer.indexOf('\n\n', pos)
    if (end === -1) break
    const block = buffer.slice(pos, end)
    pos = end + 2
    let eventType = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim()
      else if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (data) events.push({ event: eventType, data })
  }
  return { events, remaining: buffer.slice(pos) }
}

export function isValidScriptInputKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key ?? ''))
}

export function addScriptInputRow(key = '', value = '') {
  if (!scriptInputs) return

  const row = document.createElement('div')
  row.className = 'script-input-item'

  const keyInput = document.createElement('input')
  keyInput.type = 'text'
  keyInput.className = 'script-input-key'
  keyInput.placeholder = 'key'
  keyInput.autocomplete = 'off'
  keyInput.spellcheck = false
  keyInput.value = String(key ?? '')

  const valueInput = document.createElement('input')
  valueInput.type = 'text'
  valueInput.className = 'script-input-value'
  valueInput.placeholder = 'value'
  valueInput.autocomplete = 'off'
  valueInput.spellcheck = false
  valueInput.value = String(value ?? '')

  const removeBtn = document.createElement('button')
  removeBtn.type = 'button'
  removeBtn.className = 'script-input-remove'
  removeBtn.textContent = 'remove'
  removeBtn.addEventListener('click', () => {
    row.remove()
  })

  row.appendChild(keyInput)
  row.appendChild(valueInput)
  row.appendChild(removeBtn)
  scriptInputs.appendChild(row)
}

export function collectScriptInputVars() {
  if (!scriptInputs) return {}

  const vars = {}
  const rows = scriptInputs.querySelectorAll('.script-input-item')

  for (const row of rows) {
    const keyEl = row.querySelector('.script-input-key')
    const valueEl = row.querySelector('.script-input-value')
    const key = String(keyEl?.value ?? '').trim()
    if (!key) continue
    if (!isValidScriptInputKey(key)) {
      throw new Error(`Invalid script input key "${key}". Use [A-Za-z_][A-Za-z0-9_]*.`)
    }
    vars[key] = String(valueEl?.value ?? '')
  }

  return vars
}

export async function loadScriptPreview() {
  const filePath = scriptPathInput.value.trim()
  if (!filePath) {
    setStatus('script path required', 'responding')
    return
  }

  if (isBusy) {
    setStatus('wait for current task', 'responding')
    return
  }

  setStatus('loading script…', 'thinking')

  try {
    await loadScriptContent(filePath)
    appendScriptLogRow(`[script:load] path=${filePath}`)
    setStatus('script loaded')
  } catch (err) {
    clearScriptView()
    appendScriptLogRow(`[script:error] ${err.message}`, 'error')
    setStatus('script load error', 'responding')
  }
}

export async function saveScriptBuffer() {
  if (isNextVMode()) {
    try {
      await saveCurrentEditorFile()
    } catch (err) {
      appendScriptLogRow(`[file:error] ${err.message}`, 'error')
      setStatus('file save error', 'responding')
    }
    return
  }

  const filePath = scriptPathInput.value.trim()
  if (!filePath) {
    setStatus('script path required to save', 'responding')
    return
  }

  const content = getScriptEditorText()
  try {
    const res = await fetch('/api/file/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'script',
        filePath,
        content,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'Unable to save script')
    }

    const savedPath = String(data.filePath ?? filePath)
    scriptEditorState.path = savedPath
    scriptEditorState.loadedText = content
    scriptEditorState.dirty = false

    const workspaceDir = normalizeRelativePath(nextVWorkspaceDirInput?.value ?? '')
    if (nextVEntrypointInput) {
      let relativeSavedPath = normalizeRelativePath(savedPath)
      if (workspaceDir && relativeSavedPath.startsWith(`${workspaceDir}/`)) {
        relativeSavedPath = relativeSavedPath.slice(workspaceDir.length + 1)
      }
      nextVEntrypointInput.value = relativeSavedPath
    }

    if (scriptPathInput) {
      scriptPathInput.value = savedPath
    }

    scriptCache.set(savedPath, content.split('\n'))
    scriptCache.set(filePath, content.split('\n'))
    syncScriptBadgeState()

    appendScriptLogRow(`[script:save] path=${savedPath} bytes=${data.bytes ?? 0}`)
    setStatus('script saved')
  } catch (err) {
    appendScriptLogRow(`[script:error] ${err.message}`, 'error')
    setStatus('script save error', 'responding')
  }
}

export async function saveNextVEntrypoint() {
  try {
    const filePath = getPanePath(activePaneId)
    if (!filePath) {
      setStatus('open a file first to save', 'responding')
      return
    }

    await saveCurrentEditorFile({ explicitPath: filePath })
    persistNextVConfig()
  } catch (err) {
    appendScriptLogRow(`[file:error] ${err.message}`, 'error')
    setStatus('nextv save failed', 'responding')
  }
}

// --- Script runner ---
export async function runScript(runOptions = {}) {
  const filePath = String(runOptions.filePath ?? scriptPathInput.value.trim())
  let scriptText = String(runOptions.inlineScriptText ?? getScriptEditorText())
  const forceMode = String(runOptions.forceMode ?? '')
  if (!filePath && !scriptText.trim()) {
    setStatus('script path or script text required', 'responding')
    return
  }
  const autoAllow = document.getElementById('script-autoallow').checked
  let inputVars = {}

  try {
    inputVars = collectScriptInputVars()
  } catch (err) {
    appendScriptLogRow(`[script:error] ${err.message}`, 'error')
    setStatus('script inputs invalid', 'responding')
    return
  }

  if (isBusy) {
    const pending = scriptLogs.querySelector('.confirm-block')
    if (pending) {
      pending.scrollIntoView({ block: 'center', behavior: 'smooth' })
      appendScriptLogRow('[script:info] Waiting for confirmation. Approve/deny the highlighted tool prompt.', 'error')
      setStatus('awaiting confirmation', 'responding')
    } else {
      appendScriptLogRow('[script:info] Agent is busy. Wait for current task to complete.', 'error')
      setStatus('busy: wait for current task', 'responding')
    }
    return
  }

  try {
    _setIsBusy(true)
    setNextVRunControls()
    _setActiveScriptAbortController(new AbortController())
    setActiveScriptRunId('')
    updateScriptRunControls()
    clearScriptLogs()
    _setActiveScriptLine(null)

    setStatus('running script…', 'thinking')

    appendScriptLogRow(`[script] path=${filePath || '(inline)'}`)
    clearScriptOutput()

    if (!scriptText.trim() && filePath) {
      try {
        await loadScriptContent(filePath)
        scriptText = getScriptEditorText()
      } catch (err) {
        clearScriptView()
        appendScriptLogRow(`[script:error] ${err.message}`, 'error')
      }
    }

    if (!scriptText.trim()) {
      throw new Error('No script content to run')
    }

    const activePaneState = getPaneState(activePaneId)
    const normalizedPath = normalizeNewlines(filePath)
    const runningEditedBuffer =
      activePaneState.dirty ||
      activePaneState.path !== normalizedPath ||
      scriptText !== activePaneState.loadedText
    if (runningEditedBuffer) {
      appendScriptLogRow('[script:info] Running editable script buffer (unsaved).', 'result')
    }

    let buffer = ''
    const inputTimeoutMs = 120000
    const res = await fetch('/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, scriptText, autoAllow, inputVars, inputTimeoutMs }),
      signal: activeScriptAbortController.signal,
    })

    if (!res.ok || !res.body) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error ?? 'script request failed')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { events, remaining } = parseSSEBuffer(buffer)
      buffer = remaining
      for (const { event, data } of events) {
        let payload
        try { payload = JSON.parse(data) } catch { continue }
        if (event === 'script_line') {
          const line = String(payload.line ?? '')
          if (isScriptMetaLine(line)) {
            let cls = ''
            if (line.startsWith('[script:step]')) cls = 'step'
            if (line.startsWith('[script:result]')) cls = 'result'
            if (line.startsWith('[script:error]')) cls = 'error'

            appendScriptLogRow(line, cls)

            const stepLine = parseScriptStepLine(line)
            if (stepLine) highlightScriptLine(stepLine)
          } else {
            appendScriptOutputLine(line)
          }
        } else if (event === 'script_session') {
          setActiveScriptRunId(String(payload.scriptRunId ?? '').trim())
          if (activeScriptRunId) {
            appendScriptLogRow(`[script:session] id=${activeScriptRunId}`)
          }
        } else if (event === 'input_request') {
          appendInputRequestNotice(payload)
          setStatus('awaiting external event input', 'responding')
        } else if (event === 'confirm_request') {
          appendConfirmBlock(payload.id, payload.description, scriptLogs)
          setStatus('awaiting confirmation', 'responding')
        } else if (event === 'done') {
          appendScriptLogRow('[script:done] Script completed.')
          setStatus(payload.message ?? 'script done')
        } else if (event === 'error') {
          appendScriptLogRow(payload.message ?? 'script error', 'error')
          appendErrorRow(payload.message ?? 'script error')
          setStatus('script error', 'responding')
        }
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      appendScriptLogRow('[script:cancelled] Script run aborted.', 'error')
      setStatus('script cancelled', 'responding')
    } else {
      appendScriptLogRow(`[script:error] ${err.message}`, 'error')
      appendErrorRow(`Script failed: ${err.message}`)
      setStatus('script error', 'responding')
    }
  } finally {
    setActiveScriptRunId('')
    _setActiveScriptAbortController(null)
    updateScriptRunControls()
    _setIsBusy(false)
    setNextVRunControls()
  }
}

if (userInputText) {
  userInputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      sendNextVUserText()
    }
  })
}

export function toggleCommentInTextarea(textarea) {
  if (!textarea) return

  const value = textarea.value
  const start = Number(textarea.selectionStart)
  const end = Number(textarea.selectionEnd)
  const hasSelection = start !== end

  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const endLineSearchIndex = hasSelection ? end : start
  const lineEndMatch = value.indexOf('\n', endLineSearchIndex)
  const lineEnd = lineEndMatch === -1 ? value.length : lineEndMatch
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')

  const nonEmptyLines = lines.filter((line) => line.trim() !== '')
  const shouldUncomment = nonEmptyLines.length > 0
    && nonEmptyLines.every((line) => /^\s*#/.test(line))

  const transformedLines = lines.map((line) => {
    if (line.trim() === '') return line
    if (shouldUncomment) {
      return line.replace(/^(\s*)#\s?/, '$1')
    }
    return line.replace(/^(\s*)/, '$1# ')
  })

  const transformedBlock = transformedLines.join('\n')
  textarea.value = `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`

  if (hasSelection) {
    textarea.setSelectionRange(lineStart, lineStart + transformedBlock.length)
  } else {
    const originalLine = lines[0] ?? ''
    const transformedLine = transformedLines[0] ?? ''
    const delta = transformedLine.length - originalLine.length
    const nextCaret = Math.max(lineStart, start + delta)
    textarea.setSelectionRange(nextCaret, nextCaret)
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

export function toggleScriptCommentBlockForPane(paneId) {
  toggleCommentInTextarea(getPaneTextarea(paneId))
}

export function initEditorPanes() {
  setEditorLayout(editorLayoutState.layoutMode, { persist: false })
  for (const paneId of editorLayoutState.allPanes) {
    const els = getPaneElements(paneId)
    if (!els) continue
    const pane = els.pane
    if (!pane || pane.dataset.paneInit === '1') continue
    pane.dataset.paneInit = '1'
    pane.addEventListener('click', (e) => {
      if (e.target === pane || pane.contains(e.target)) focusEditorPane(paneId)
    })
    pane.addEventListener('dragover', (e) => onPaneDragOver(e, paneId))
    pane.addEventListener('dragleave', (e) => onPaneDragLeave(e, paneId))
    pane.addEventListener('drop', (e) => onPaneDrop(e, paneId))
  }
}

export function bindEditorPaneEvents(paneId) {
  const textarea = getPaneTextarea(paneId)
  if (!textarea || textarea.dataset.paneBound === '1') return
  textarea.dataset.paneBound = '1'

  textarea.addEventListener('keydown', (e) => {
    const isCommentToggleShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '/' || e.code === 'Slash')
    if (isCommentToggleShortcut) {
      e.preventDefault()
      toggleScriptCommentBlockForPane(paneId)
      return
    }

    if (e.key !== 'Tab') return

    e.preventDefault()
    const indentWidth = getCurrentNextVEditorTabSize()
    const indentSpaces = ' '.repeat(indentWidth)

    const value = textarea.value
    const start = Number(textarea.selectionStart)
    const end = Number(textarea.selectionEnd)
    const hasSelection = start !== end

    if (!hasSelection && !e.shiftKey) {
      const inserted = '\t'
      textarea.value = `${value.slice(0, start)}${inserted}${value.slice(end)}`
      textarea.setSelectionRange(start + inserted.length, start + inserted.length)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }

    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const endLineSearchIndex = hasSelection ? end : start
    const lineEndMatch = value.indexOf('\n', endLineSearchIndex)
    const lineEnd = lineEndMatch === -1 ? value.length : lineEndMatch
    const block = value.slice(lineStart, lineEnd)
    const lines = block.split('\n')

    let transformedLines = lines
    let removedBeforeCaret = 0

    if (e.shiftKey) {
      transformedLines = lines.map((line, index) => {
        if (line.startsWith('\t')) {
          if (index === 0 && start > lineStart) removedBeforeCaret = 1
          return line.slice(1)
        }
        if (line.startsWith(indentSpaces)) {
          if (index === 0 && start > lineStart) removedBeforeCaret = Math.min(indentWidth, start - lineStart)
          return line.slice(indentWidth)
        }
        return line
      })
    } else {
      transformedLines = lines.map((line) => `\t${line}`)
    }

    const transformedBlock = transformedLines.join('\n')
    textarea.value = `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`

    if (hasSelection) {
      textarea.setSelectionRange(lineStart, lineStart + transformedBlock.length)
    } else if (e.shiftKey) {
      const nextCaret = Math.max(lineStart, start - removedBeforeCaret)
      textarea.setSelectionRange(nextCaret, nextCaret)
    } else {
      textarea.setSelectionRange(start + 1, start + 1)
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })

  textarea.addEventListener('input', () => {
    _setActiveScriptLine(null)
    const paneState = getPaneState(paneId)
    paneState.dirty = normalizeNewlines(textarea.value) !== paneState.loadedText
    renderScriptMirrorForPane(paneId, textarea.value)
    if (activePaneId === paneId) syncScriptBadgeState()
    renderOpenFileTabs()
    scheduleNextVAutoSave()
  })

  textarea.addEventListener('scroll', () => {
    syncScriptMirrorScrollForPane(paneId)
  })

  textarea.addEventListener('focus', () => {
    focusEditorPane(paneId)
  })

  bindTextareaFileRefCursor(textarea, () => textarea.value)

  textarea.addEventListener('click', async () => {
    if (textarea.selectionStart !== textarea.selectionEnd) return

    const text = normalizeNewlines(textarea.value)
    const primaryOffset = Number(textarea.selectionStart)
    const candidateOffsets = [primaryOffset, Math.max(0, primaryOffset - 1)]

    for (const offset of candidateOffsets) {
      const opened = await openEditorClickTargetAtOffset(text, offset)
      if (opened) return
    }
  })
}

for (const paneId of editorLayoutState.allPanes) {
  bindEditorPaneEvents(paneId)
}
setupEditorGridCenterHandle()
initEditorPanes()
bindFloatingGraphCodePanelEvents()
updateFloatingGraphCodePanelMeta()

if (scriptView) {
  renderPaneTitles()
  focusEditorPane(activePaneId)
}

if (scriptPathInput) {
  scriptPathInput.addEventListener('input', () => {
    const nextPath = scriptPathInput.value.trim()
    const paneState = getPaneState(activePaneId)
    paneState.dirty = nextPath !== paneState.path || getScriptEditorText() !== paneState.loadedText
    syncScriptBadgeState()
  })
}

if (nextVWorkspaceDirInput) {
  nextVWorkspaceDirInput.addEventListener('input', () => {
    persistNextVConfig()
    if (tracePanelState.currentTab === 'graph') {
      refreshNextVGraph({ silent: true })
    }
  })

  nextVWorkspaceDirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      openNextVWorkspace()
    }
  })
}

if (nextVEntrypointInput) {
  nextVEntrypointInput.addEventListener('input', () => {
    persistNextVConfig()
    setNextVRunControls()
    if (tracePanelState.currentTab === 'graph') {
      refreshNextVGraph({ silent: true })
    }
  })
}

if (nextVAutoSaveInput) {
  nextVAutoSaveInput.addEventListener('change', () => {
    persistNextVConfig()
    if (nextVAutoSaveInput.checked) {
      scheduleNextVAutoSave()
    } else {
      clearNextVAutoSaveTimer()
    }
  })
}

document.addEventListener('keydown', (e) => {
  const key = String(e.key ?? '').toLowerCase()
  if (key !== 's' || (!e.ctrlKey && !e.metaKey)) return
  if (!isNextVMode()) return
  e.preventDefault()
  if (isNextVMode()) {
    if (e.shiftKey) {
      saveAllNextVFiles()
      return
    }
    saveNextVEntrypoint()
    return
  }
})

window.addEventListener('beforeunload', () => {
  closeNextVStream()
  clearDeleteConfirmTimers()
})

// --- Init ---

// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  storageKeys,
  editorLayoutState,
  tracePanelState,
  nextVViewState,
  nextVPanelState,
  inputPanelState,
  nextVRuntimeTargetState,
  userOutputFilterState,
  scriptInputs,
  settingsMenu,
  nextVWorkspaceDirInput,
  nextVEntrypointInput,
  workspace
} from './state.js'
import {
  updateScriptRunControls,
  getAvailableUserOutputChannels,
  normalizeUserOutputChannels,
  setDeclaredEffectChannels,
  renderUserOutputChannelFilters,
  applyUserOutputChannelVisibility,
  clearUserOutputPanel
} from './02_user_output.js'
import {
  isNextVMode,
  setActiveScriptRunId,
  setNextVFileDrawerOpen,
  setNextVPrimaryView,
  setNextVDevTab,
  setNextVDevConsoleOpen,
  setNextVImagesOpen,
  setNextVIngressControlsVisible,
  setNextVRuntimeTarget,
  setNextVAttachWsUrl,
  setNextVAttachStartOverrideEnabled,
  setNextVThemeMode,
  normalizeNextVThemeMode,
  toggleNextVIngressControlsSetting,
  setDeclaredExternalChannels,
  setNextVInputTab,
  setAppMode,
  setNextVRunControls,
  setNextVStateDiffTab,
  setUserIOPanelOpen,
  toggleNextVDevConsole,
  initNextVCallInspectorPanelChrome,
  toggleNextVCallInspectorPanel,
  toggleNextVFileDrawer,
  toggleNextVImagesOpen,
  toggleUserIOPanel
} from './03_ui_controls.js'
import {
  appendNextVErrorLog
} from './07_graph_render.js'
import {
  setNextVEventsLiveMode
} from './02_user_output.js'
import {
  closeFloatingGraphCodePanel,
  saveFloatingGraphCodePanel
} from './04_floating_panels.js'
import {
  normalizeNextVWorkspaceDir
} from './08_path_utils.js'
import {
  updateOpenFileLabel,
  initFileTreeCtxMenu,
  setEditorLayout,
  setNextVEditorTabSize,
  restoreNextVConfig,
  ctxMenuDelete,
  ctxMenuNewFile,
  ctxMenuNewFolder,
  ctxMenuRename,
  onDeleteConfirmApprove,
  onDeleteConfirmCancel,
  refreshNextVWorkspaceTree,
  saveAllNextVFiles
} from './09_editor.js'
import {
  initNextVStatePanelTools,
  initNextVStateDiffPanel,
  setupNextVStateDiffSplitter,
  clearNextVStateDiff,
  setNextVStateCollapseAll,
  toggleNextVStateDiff
} from './10_file_tree.js'
import {
  initNextVUserIOPanel,
  setupNextVUserIOSplitter,
  clearTracePanel,
  renderNextVSnapshot
} from './11_state_panels.js'
import {
  syncNextVRuntimeState,
  updateNextVEventImageUI,
  setupNextVImageDropzone,
  setLeftPanelWidth,
  setupSplitter,
  setupFileTreeSplitter,
  setupVerticalSplitters,
  startNextVRuntime,
  stopNextVRuntime,
  runNextVRuntime,
  attachNextVRuntime,
  detachNextVRuntime,
  sendNextVEvent,
  sendNextVIngress,
  clearNextVEventImages,
  refreshNextVSnapshot,
  handleNextVImageInput,
  reloadNextVRuntimeConfig,
  submitNextVCandidate,
  promoteNextVCandidate,
  executeNextVCallInspector,
  insertNextVCallInspectorSnippet,
  initNextVCallInspector,
} from './12_stream.js'
import {
  initNextVEditorSurfaceBeta,
  setNextVEditorSurfaceBetaEnabled,
  setNextVEditorSurfaceTelemetryVisible,
} from './15_surface_beta.js'
import {
  initNextVTokenClickPlugin,
} from './16_token_click_plugin.js'
import {
  loadSession,
  clearScriptOutput,
  clearScriptView,
  renderScriptMirror,
  openNextVWorkspace,
  addScriptInputRow,
  cancelScriptRun,
  resolveConfirm,
  clearOutputPanel,
  clearScriptLogsPanel,
  loadScriptPreview,
  runScript,
  saveNextVEntrypoint,
  saveScriptBuffer,
} from './13_layout.js'

export function initLayoutState() {
  return (async () => {
    const session = await loadSession()
    const sessionRemoteMode = session?.remoteMode === true
    const sessionRemoteControl = session?.remoteControl === true
    const sessionRemoteWsUrl = String(session?.remoteWsUrl ?? '').trim()

  setAppMode('nextv')

  const savedWidth = Number(localStorage.getItem(storageKeys.leftWidth))
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    setLeftPanelWidth(savedWidth)
  }

  restoreNextVConfig()
  setEditorLayout(editorLayoutState.layoutMode, { persist: false })
  initNextVEditorSurfaceBeta()

  const queryWorkspaceDir = normalizeNextVWorkspaceDir(
    new URLSearchParams(window.location.search).get('workspaceDir') ?? ''
  )
  if (queryWorkspaceDir && nextVWorkspaceDirInput) {
    nextVWorkspaceDirInput.value = queryWorkspaceDir
  }

  setNextVDevConsoleOpen(nextVPanelState.devConsoleOpen, { persist: false })
  setNextVPrimaryView(nextVViewState.currentView, { persist: false })
  setNextVDevTab(tracePanelState.currentTab, { persist: false })
  setDeclaredExternalChannels([], { preserveSelection: true })
  setDeclaredEffectChannels([], { preserveSelection: false, persist: false })
  setNextVInputTab(inputPanelState.currentTab, { persist: false })
  const imagesStored = localStorage.getItem(storageKeys.nextVImagesOpen) === '1'
  setNextVImagesOpen(imagesStored, { persist: false })
  setNextVIngressControlsVisible(false, { persist: false })
  setNextVRuntimeTarget(nextVRuntimeTargetState.target, { persist: false, sync: false })
  setNextVAttachWsUrl(nextVRuntimeTargetState.attachWsUrl, { persist: false, sync: false })
  const storedThemeMode = normalizeNextVThemeMode(localStorage.getItem(storageKeys.nextVThemeMode) ?? 'night')
  setNextVThemeMode(storedThemeMode, { persist: false })

  if (sessionRemoteControl) {
    // PATCH: Allow 'attach' mode even when remoteControl is true.
    // Only force 'embedded' if attach is not the only allowed mode.
    // If the current runtime target is 'attach', do not override.
    if (nextVRuntimeTargetState.target !== 'attach') {
      setNextVRuntimeTarget('embedded', { persist: false, sync: false })
    }
    if (sessionRemoteWsUrl) {
      setNextVAttachWsUrl(sessionRemoteWsUrl, { persist: false, sync: false })
    }
  }

  if (sessionRemoteMode) {
    if (nextVWorkspaceDirInput) nextVWorkspaceDirInput.value = ''
    if (nextVEntrypointInput) nextVEntrypointInput.value = ''
  }

  const attachOverrideStored = localStorage.getItem(storageKeys.nextVAttachStartOverride) === '1'
  setNextVAttachStartOverrideEnabled(attachOverrideStored, { persist: false })
  const drawerStored = localStorage.getItem(storageKeys.nextVTreeDrawerOpen)
  setNextVFileDrawerOpen(drawerStored !== '0', { persist: false })

  clearScriptView()
  clearScriptOutput()
  clearUserOutputPanel()
  clearTracePanel({ silent: true })
  initNextVStateDiffPanel()
  initNextVStatePanelTools()
  initNextVUserIOPanel()
  updateOpenFileLabel('')
  renderScriptMirror()
  if (scriptInputs && scriptInputs.children.length === 0) {
    addScriptInputRow()
  }
  setNextVRunControls()
  setActiveScriptRunId('')

  const storedChannels = String(localStorage.getItem(storageKeys.nextVUserOutputChannels) ?? '').trim()
  const parsedStoredChannels = storedChannels
    ? normalizeUserOutputChannels(storedChannels.split(','), getAvailableUserOutputChannels())
    : []
  userOutputFilterState.channels = parsedStoredChannels.length > 0
    ? new Set(parsedStoredChannels)
    : new Set(getAvailableUserOutputChannels())
  renderUserOutputChannelFilters()
  applyUserOutputChannelVisibility()

  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const shouldAutoOpenWorkspace = workspaceDir
    && isNextVMode()
    && nextVRuntimeTargetState.target !== 'attach'
    && !sessionRemoteMode
  if (shouldAutoOpenWorkspace) {
    openNextVWorkspace().catch((err) => {
      appendNextVErrorLog(err, '[nextv:workspace:auto-open:error]')
    })
  }

  // Auto-attach to remote runtime if in attach mode and ws url is present.
  if (
    nextVRuntimeTargetState.target === 'attach' &&
    String(nextVRuntimeTargetState.attachWsUrl ?? '').trim()
  ) {
    // Defer to next tick so initial UI/render state is fully applied first.
    setTimeout(() => {
      void attachNextVRuntime()
    }, 0)
  }
  })()
}

export function setupNextVEventsScrollListener() {
  const nextVEventsOutput = document.getElementById('nextv-events-output')
  if (!nextVEventsOutput) return

  let scrollTimeout = null
  nextVEventsOutput.addEventListener('scroll', () => {
    if (scrollTimeout) clearTimeout(scrollTimeout)

    scrollTimeout = setTimeout(() => {
      // Import state directly at call time
      import('./state.js').then(({ nextVEventsLiveMode }) => {
        if (nextVEventsLiveMode === false) return

        const firstGroup = nextVEventsOutput.querySelector('.exec-group')
        if (!firstGroup) return

        const firstGroupBottom = firstGroup.offsetHeight
        if (nextVEventsOutput.scrollTop > firstGroupBottom) {
          setNextVEventsLiveMode(false)
        }
      })
    }, 50)
  })
}

function setupSettingsMenuDismiss() {
  if (!settingsMenu) return
  document.addEventListener('pointerdown', (event) => {
    if (!settingsMenu.hasAttribute('open')) return
    if (settingsMenu.contains(event.target)) return
    settingsMenu.removeAttribute('open')
  })
}

setupSplitter()
setupFileTreeSplitter()
setupNextVStateDiffSplitter()
setupNextVUserIOSplitter()
setupNextVImageDropzone()
updateNextVEventImageUI()
setupVerticalSplitters()
initNextVCallInspectorPanelChrome()
initNextVCallInspector()
initNextVTokenClickPlugin()
setupNextVEventsScrollListener()
setupSettingsMenuDismiss()
initLayoutState()
initFileTreeCtxMenu()
updateScriptRunControls()
syncNextVRuntimeState()

// ---------------------------------------------------------------------------
// Expose onclick handlers to global scope.
// HTML inline onclick="fn()" requires global access; ES module scope is not
// global, so we assign each handler explicitly to window here.
// ---------------------------------------------------------------------------
Object.assign(window, {
  // 02_user_output.js
  clearUserOutputPanel,
  setNextVEventsLiveMode,
  // 03_ui_controls.js
  setNextVPrimaryView,
  setNextVDevTab,
  setNextVStateDiffTab,
  setNextVRuntimeTarget,
  setNextVAttachWsUrl,
  setNextVAttachStartOverrideEnabled,
  setNextVThemeMode,
  attachNextVRuntime,
  detachNextVRuntime,
  setUserIOPanelOpen,
  toggleNextVDevConsole,
  toggleNextVCallInspectorPanel,
  toggleNextVFileDrawer,
  toggleNextVImagesOpen,
  toggleNextVIngressControlsSetting,
  toggleUserIOPanel,
  // 04_floating_panels.js
  closeFloatingGraphCodePanel,
  saveFloatingGraphCodePanel,
  // 09_editor.js
  ctxMenuDelete,
  ctxMenuNewFile,
  ctxMenuNewFolder,
  ctxMenuRename,
  onDeleteConfirmApprove,
  onDeleteConfirmCancel,
  refreshNextVWorkspaceTree,
  saveAllNextVFiles,
  setEditorLayout,
  setNextVEditorTabSize,
  setNextVEditorSurfaceBetaEnabled,
  setNextVEditorSurfaceTelemetryVisible,
  // 10_file_tree.js
  clearNextVStateDiff,
  setNextVStateCollapseAll,
  toggleNextVStateDiff,
  // 11_state_panels.js
  renderNextVSnapshot,
  // 12_stream.js
  clearNextVEventImages,
  handleNextVImageInput,
  refreshNextVSnapshot,
  runNextVRuntime,
  reloadNextVRuntimeConfig,
  submitNextVCandidate,
  promoteNextVCandidate,
  sendNextVEvent,
  sendNextVIngress,
  startNextVRuntime,
  stopNextVRuntime,
  executeNextVCallInspector,
  insertNextVCallInspectorSnippet,
  // 13_layout.js
  addScriptInputRow,
  cancelScriptRun,
  resolveConfirm,
  clearOutputPanel,
  clearScriptLogsPanel,
  loadScriptPreview,
  openNextVWorkspace,
  runScript,
  saveNextVEntrypoint,
  saveScriptBuffer,
})

// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  storageKeys,
  nextVEditorSurfaceBetaToggle,
  nextVEditorSurfaceTelemetryToggle,
  nextVGraphState,
} from './state.js'
import {
  getPaneEditorShell,
  getPaneEl,
  getPaneState,
  getPaneTextarea,
} from './09_editor.js'
import {
  openEditorClickTargetAtOffset,
} from './13_layout.js'
import {
  Surface,
  Renderer,
  DiagnosticsChannel,
  createMarkdownPlugin,
  createJsonPlugin,
  tokenizeJson,
} from '../editor-core/index.js'

const SURFACE_BETA_EDITOR_PANE_IDS = ['A', 'B', 'C', 'D']
const SURFACE_BETA_FLOAT_PANE_IDS = ['FLOAT1', 'FLOAT2']
const SURFACE_BETA_PANE_IDS = [...SURFACE_BETA_EDITOR_PANE_IDS, ...SURFACE_BETA_FLOAT_PANE_IDS]
let surfaceBetaEnabled = false
let surfaceTelemetryVisible = true
const paneBindings = new Map()
const paneSurfaceSwitchState = new Map()
const paneSwitchButtons = new Map()
let surfacePaneSwitchPollTimer = null

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])
const NERVE_EXTENSIONS = new Set(['.nrv', '.wfs'])
const JSON_EXTENSIONS = new Set(['.json', '.jsonc', '.json5'])

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function inferModeFromPath(filePath) {
  const value = String(filePath ?? '').trim().toLowerCase()
  if (!value) return ''
  const lastDot = value.lastIndexOf('.')
  if (lastDot < 0) return ''
  const ext = value.slice(lastDot)
  if (NERVE_EXTENSIONS.has(ext)) return 'nerve'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (JSON_EXTENSIONS.has(ext)) return 'json'
  return ''
}

function inferModeFromContent(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json'
  }
  return 'markdown'
}

function parseJsonStringTokenValue(value) {
  try {
    return JSON.parse(value)
  } catch {
    return String(value ?? '').replace(/^"|"$/g, '')
  }
}

function buildLineOffsets(text) {
  const value = String(text ?? '')
  const offsets = [0]
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\n') {
      offsets.push(i + 1)
    }
  }
  return offsets
}

function buildTokenEntries(text) {
  const lineOffsets = buildLineOffsets(text)
  return tokenizeJson(text).map((token) => {
    const lineOffset = lineOffsets[Math.max(0, Number(token.line) - 1)] ?? 0
    return {
      token,
      startOffset: lineOffset + Number(token.start ?? 0),
      endOffset: lineOffset + Number(token.end ?? 0),
    }
  })
}

function inferJsonObjectPathAtCursor(text, cursorOffset) {
  const value = String(text ?? '')
  const cursor = Math.max(0, Math.min(Number.isInteger(cursorOffset) ? cursorOffset : 0, value.length))
  const entries = buildTokenEntries(value)
  const stack = []
  let bestPath = []

  const enterContainer = (type) => {
    const parent = stack[stack.length - 1]
    let path = []

    if (parent) {
      if (parent.type === 'object') {
        if (typeof parent.pendingKey === 'string' && parent.pendingKey.length > 0) {
          path = [...parent.path, parent.pendingKey]
        } else {
          path = [...parent.path]
        }
        parent.pendingKey = null
        parent.expecting = 'commaOrClose'
      } else if (parent.type === 'array') {
        path = [...parent.path, parent.nextIndex]
        parent.nextIndex += 1
        parent.expecting = 'commaOrClose'
      }
    }

    stack.push({
      type,
      path,
      expecting: type === 'object' ? 'keyOrClose' : 'valueOrClose',
      pendingKey: null,
      nextIndex: 0,
    })
  }

  const markPrimitiveValueConsumed = () => {
    const parent = stack[stack.length - 1]
    if (!parent) return
    if (parent.type === 'object' && parent.expecting === 'value') {
      parent.pendingKey = null
      parent.expecting = 'commaOrClose'
      return
    }
    if (parent.type === 'array' && parent.expecting === 'valueOrClose') {
      parent.nextIndex += 1
      parent.expecting = 'commaOrClose'
    }
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (entry.startOffset > cursor) {
      break
    }

    const token = entry.token
    const top = stack[stack.length - 1]
    const nextType = entries[i + 1]?.token?.type ?? ''

    if (token.type === 'brace-open') {
      enterContainer('object')
    } else if (token.type === 'bracket-open') {
      enterContainer('array')
    } else if (token.type === 'brace-close') {
      if (stack[stack.length - 1]?.type === 'object') {
        stack.pop()
      }
    } else if (token.type === 'bracket-close') {
      if (stack[stack.length - 1]?.type === 'array') {
        stack.pop()
      }
    } else if (token.type === 'comma') {
      if (top?.expecting === 'commaOrClose') {
        top.expecting = top.type === 'object' ? 'keyOrClose' : 'valueOrClose'
      }
    } else if (token.type === 'colon') {
      if (top?.type === 'object' && top.expecting === 'colon') {
        top.expecting = 'value'
      }
    } else if (token.type === 'string') {
      if (top?.type === 'object' && top.expecting === 'keyOrClose' && nextType === 'colon') {
        top.pendingKey = parseJsonStringTokenValue(token.value)
        top.expecting = 'colon'
      } else {
        markPrimitiveValueConsumed()
      }
    } else if (token.type === 'number' || token.type === 'boolean' || token.type === 'null') {
      markPrimitiveValueConsumed()
    }

    const currentObject = [...stack].reverse().find((frame) => frame.type === 'object')
    if (currentObject) {
      bestPath = currentObject.path
    }
  }

  return Array.isArray(bestPath) ? bestPath : []
}

function buildJsonObjectKeyEntries(text) {
  const value = String(text ?? '')
  const entries = buildTokenEntries(value)
  const stack = []
  const keys = []

  const enterContainer = (type) => {
    const parent = stack[stack.length - 1]
    let path = []

    if (parent) {
      if (parent.type === 'object') {
        if (typeof parent.pendingKey === 'string' && parent.pendingKey.length > 0) {
          path = [...parent.path, parent.pendingKey]
        } else {
          path = [...parent.path]
        }
        parent.pendingKey = null
        parent.expecting = 'commaOrClose'
      } else if (parent.type === 'array') {
        path = [...parent.path, parent.nextIndex]
        parent.nextIndex += 1
        parent.expecting = 'commaOrClose'
      }
    }

    stack.push({
      type,
      path,
      expecting: type === 'object' ? 'keyOrClose' : 'valueOrClose',
      pendingKey: null,
      nextIndex: 0,
    })
  }

  const markPrimitiveValueConsumed = () => {
    const parent = stack[stack.length - 1]
    if (!parent) return
    if (parent.type === 'object' && parent.expecting === 'value') {
      parent.pendingKey = null
      parent.expecting = 'commaOrClose'
      return
    }
    if (parent.type === 'array' && parent.expecting === 'valueOrClose') {
      parent.nextIndex += 1
      parent.expecting = 'commaOrClose'
    }
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    const token = entry.token
    const top = stack[stack.length - 1]
    const nextType = entries[i + 1]?.token?.type ?? ''

    if (token.type === 'brace-open') {
      enterContainer('object')
      continue
    }
    if (token.type === 'bracket-open') {
      enterContainer('array')
      continue
    }
    if (token.type === 'brace-close') {
      if (stack[stack.length - 1]?.type === 'object') {
        stack.pop()
      }
      continue
    }
    if (token.type === 'bracket-close') {
      if (stack[stack.length - 1]?.type === 'array') {
        stack.pop()
      }
      continue
    }
    if (token.type === 'comma') {
      if (top?.expecting === 'commaOrClose') {
        top.expecting = top.type === 'object' ? 'keyOrClose' : 'valueOrClose'
      }
      continue
    }
    if (token.type === 'colon') {
      if (top?.type === 'object' && top.expecting === 'colon') {
        top.expecting = 'value'
      }
      continue
    }
    if (token.type === 'string') {
      if (top?.type === 'object' && top.expecting === 'keyOrClose' && nextType === 'colon') {
        const key = parseJsonStringTokenValue(token.value)
        keys.push({ path: top.path, key, startOffset: entry.startOffset })
        top.pendingKey = key
        top.expecting = 'colon'
      } else {
        markPrimitiveValueConsumed()
      }
      continue
    }
    if (token.type === 'number' || token.type === 'boolean' || token.type === 'null') {
      markPrimitiveValueConsumed()
    }
  }

  return keys
}

function inferJsonObjectTargetAtCursor(text, cursorOffset) {
  const value = String(text ?? '')
  const cursor = Math.max(0, Math.min(Number.isInteger(cursorOffset) ? cursorOffset : 0, value.length))
  const path = inferJsonObjectPathAtCursor(value, cursor)
  const pathKey = JSON.stringify(path)
  const nextKey = buildJsonObjectKeyEntries(value)
    .filter((entry) => JSON.stringify(entry.path) === pathKey && entry.startOffset >= cursor)
    .map((entry) => entry.key)[0]

  return {
    path,
    anchorKey: typeof nextKey === 'string' && nextKey.length > 0 ? nextKey : null,
  }
}

function buildJsonValueEntries(text) {
  const entries = buildTokenEntries(text)
  const stack = []
  const values = []

  const pushValue = (path, startOffset, startLine) => {
    values.push({
      path: Array.isArray(path) ? path : [],
      startOffset: Number.isInteger(startOffset) ? startOffset : 0,
      startLine: Number.isInteger(startLine) && startLine > 0 ? startLine : 1,
    })
  }

  const enterContainer = (type, startOffset, startLine) => {
    const parent = stack[stack.length - 1]
    let path = []

    if (parent) {
      if (parent.type === 'object') {
        if (typeof parent.pendingKey === 'string' && parent.pendingKey.length > 0) {
          path = [...parent.path, parent.pendingKey]
        } else {
          path = [...parent.path]
        }
        parent.pendingKey = null
        parent.expecting = 'commaOrClose'
      } else if (parent.type === 'array') {
        path = [...parent.path, parent.nextIndex]
        parent.nextIndex += 1
        parent.expecting = 'commaOrClose'
      }
    }

    stack.push({
      type,
      path,
      expecting: type === 'object' ? 'keyOrClose' : 'valueOrClose',
      pendingKey: null,
      nextIndex: 0,
    })

    pushValue(path, startOffset, startLine)
  }

  const markPrimitiveValue = (startOffset, startLine) => {
    const parent = stack[stack.length - 1]
    if (!parent) {
      pushValue([], startOffset, startLine)
      return
    }

    if (parent.type === 'object' && parent.expecting === 'value' && typeof parent.pendingKey === 'string') {
      pushValue([...parent.path, parent.pendingKey], startOffset, startLine)
      parent.pendingKey = null
      parent.expecting = 'commaOrClose'
      return
    }

    if (parent.type === 'array' && parent.expecting === 'valueOrClose') {
      pushValue([...parent.path, parent.nextIndex], startOffset, startLine)
      parent.nextIndex += 1
      parent.expecting = 'commaOrClose'
    }
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    const token = entry.token
    const top = stack[stack.length - 1]
    const nextType = entries[i + 1]?.token?.type ?? ''

    if (token.type === 'brace-open') {
      enterContainer('object', entry.startOffset, Number(token.line) || 1)
      continue
    }

    if (token.type === 'bracket-open') {
      enterContainer('array', entry.startOffset, Number(token.line) || 1)
      continue
    }

    if (token.type === 'brace-close') {
      if (stack[stack.length - 1]?.type === 'object') {
        stack.pop()
      }
      continue
    }

    if (token.type === 'bracket-close') {
      if (stack[stack.length - 1]?.type === 'array') {
        stack.pop()
      }
      continue
    }

    if (token.type === 'comma') {
      if (top?.expecting === 'commaOrClose') {
        top.expecting = top.type === 'object' ? 'keyOrClose' : 'valueOrClose'
      }
      continue
    }

    if (token.type === 'colon') {
      if (top?.type === 'object' && top.expecting === 'colon') {
        top.expecting = 'value'
      }
      continue
    }

    if (token.type === 'string') {
      if (top?.type === 'object' && top.expecting === 'keyOrClose' && nextType === 'colon') {
        top.pendingKey = parseJsonStringTokenValue(token.value)
        top.expecting = 'colon'
      } else {
        markPrimitiveValue(entry.startOffset, Number(token.line) || 1)
      }
      continue
    }

    if (token.type === 'number' || token.type === 'boolean' || token.type === 'null') {
      markPrimitiveValue(entry.startOffset, Number(token.line) || 1)
    }
  }

  return values
}

function inferJsonPathAtLine(text, line) {
  const targetLine = Math.max(1, Number.isInteger(line) ? line : 1)
  const entries = buildJsonValueEntries(text)
  if (entries.length === 0) return []

  let exact = entries.find((entry) => entry.startLine === targetLine)
  if (exact) return Array.isArray(exact.path) ? exact.path : []

  const next = entries.find((entry) => entry.startLine > targetLine)
  if (next) return Array.isArray(next.path) ? next.path : []

  const fallback = entries[entries.length - 1]
  return Array.isArray(fallback?.path) ? fallback.path : []
}

function inferJsonPathAtOffset(text, offset) {
  const value = String(text ?? '')
  const cursor = Math.max(0, Math.min(Number.isInteger(offset) ? offset : 0, value.length))
  const entries = buildJsonValueEntries(value)
  let bestPath = []

  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].startOffset > cursor) {
      break
    }
    bestPath = entries[i].path
  }

  return Array.isArray(bestPath) ? bestPath : []
}

function findJsonValueStartOffsetByPath(text, path) {
  const entries = buildJsonValueEntries(text)
  const targetPath = Array.isArray(path) ? [...path] : []

  while (true) {
    const targetKey = JSON.stringify(targetPath)
    const match = entries.find((entry) => JSON.stringify(entry.path) === targetKey)
    if (match) {
      return match.startOffset
    }
    if (targetPath.length === 0) {
      return 0
    }
    targetPath.pop()
  }
}

function findJsonValueLineByPath(text, path) {
  const entries = buildJsonValueEntries(text)
  const targetPath = Array.isArray(path) ? [...path] : []

  while (true) {
    const targetKey = JSON.stringify(targetPath)
    const match = entries.find((entry) => JSON.stringify(entry.path) === targetKey)
    if (match) {
      return Number.isInteger(match.startLine) ? match.startLine : 1
    }
    if (targetPath.length === 0) {
      return 1
    }
    targetPath.pop()
  }
}

function buildJsonPathLineLookup(text) {
  const entries = buildJsonValueEntries(text)
  const lookup = new Map()

  for (const entry of entries) {
    const key = JSON.stringify(Array.isArray(entry.path) ? entry.path : [])
    if (!lookup.has(key)) {
      lookup.set(key, Number.isInteger(entry.startLine) && entry.startLine > 0 ? entry.startLine : 1)
    }
  }

  if (!lookup.has('[]')) {
    lookup.set('[]', 1)
  }

  return lookup
}

function getJsonNodeByPath(root, path) {
  let current = root
  for (const segment of Array.isArray(path) ? path : []) {
    if (Array.isArray(current) && Number.isInteger(segment) && segment >= 0 && segment < current.length) {
      current = current[segment]
      continue
    }
    if (current && typeof current === 'object' && !Array.isArray(current) && typeof segment === 'string' && Object.hasOwn(current, segment)) {
      current = current[segment]
      continue
    }
    return { found: false, node: undefined }
  }
  return { found: true, node: current }
}

function insertObjectPropertyOrdered(objectValue, newKey, newValue, anchorKey) {
  if (!objectValue || typeof objectValue !== 'object' || Array.isArray(objectValue)) {
    return null
  }

  const result = {}
  let inserted = false
  const hasAnchor = typeof anchorKey === 'string' && anchorKey.length > 0 && Object.hasOwn(objectValue, anchorKey)

  for (const [key, value] of Object.entries(objectValue)) {
    if (!inserted && hasAnchor && key === anchorKey && key !== newKey) {
      result[newKey] = newValue
      inserted = true
    }

    if (key === newKey) {
      if (!inserted) {
        result[newKey] = newValue
        inserted = true
      }
      continue
    }

    result[key] = value
  }

  if (!inserted) {
    result[newKey] = newValue
  }

  return result
}

function createSurfaceTelemetry() {
  return {
    mountedAt: Date.now(),
    lastSyncAt: 0,
    lastSyncSource: 'none',
    status: 'starting',
    statusReason: 'mounting',
    counters: {
      legacyInput: 0,
      surfaceInput: 0,
      legacyToSurfaceSync: 0,
      surfaceToLegacySync: 0,
      commandWrapBold: 0,
      commandWrapItalic: 0,
      commandPreviewToggle: 0,
      commandJsonNormalizeDocument: 0,
      commandJsonNormalizeSelection: 0,
      commandJsonToggleBoolean: 0,
      commandJsonAddProperty: 0,
      commandJsonSetValue: 0,
      syncPollTicks: 0,
      errors: 0,
    },
    lengths: {
      surfaceText: 0,
      legacyText: 0,
      driftChars: 0,
    },
  }
}

function getTelemetrySnapshot(telemetry) {
  return {
    ...telemetry,
    counters: { ...telemetry.counters },
    lengths: { ...telemetry.lengths },
  }
}

function publishSurfaceTelemetrySnapshot(telemetry) {
  window.__nextVSurfaceBetaTelemetry = getTelemetrySnapshot(telemetry)
}

function readStoredSurfaceBetaEnabled() {
  const stored = localStorage.getItem(storageKeys.nextVEditorSurfaceBeta)
  if (stored == null) return true
  return stored === '1'
}

function persistSurfaceBetaEnabled(enabled) {
  localStorage.setItem(storageKeys.nextVEditorSurfaceBeta, enabled ? '1' : '0')
}

function readStoredSurfaceTelemetryVisible() {
  const stored = localStorage.getItem(storageKeys.nextVEditorSurfaceTelemetry)
  if (stored == null) return true
  return stored === '1'
}

function persistSurfaceTelemetryVisible(enabled) {
  localStorage.setItem(storageKeys.nextVEditorSurfaceTelemetry, enabled ? '1' : '0')
}

function applySurfaceTelemetryVisibility(dom) {
  const hidden = surfaceTelemetryVisible !== true
  if (!dom) return
  const toolbar = dom.toolbar || dom.root?.querySelector('.surface-beta-toolbar')
  if (toolbar) {
    toolbar.hidden = hidden
    toolbar.style.display = hidden ? 'none' : 'flex'
  }
  dom.status.hidden = hidden
  dom.metrics.hidden = hidden
  dom.telemetry.hidden = hidden
}

function getPaneTrackedPath(paneId) {
  if (SURFACE_BETA_EDITOR_PANE_IDS.includes(paneId)) {
    return String(getPaneState(paneId)?.path ?? '')
  }

  if (SURFACE_BETA_FLOAT_PANE_IDS.includes(paneId)) {
    return String(nextVGraphState.floatingPanels.get(paneId)?.filePath ?? '')
  }

  return ''
}

function getEligibleSurfaceModeForPane(paneId) {
  const panePath = getPaneTrackedPath(paneId)
  const mode = inferModeFromPath(panePath)
  return mode === 'markdown' || mode === 'json' || mode === 'nerve' ? mode : ''
}

function ensureSurfacePaneSwitchControls() {
  for (const paneId of SURFACE_BETA_PANE_IDS) {
    const paneEl = SURFACE_BETA_EDITOR_PANE_IDS.includes(paneId) ? getPaneEl(paneId) : null
    const shell = getPaneEditorShell(paneId)
    const floatingPanelEl = shell?.closest('.nextv-floating-code-panel')
    const headerEl = paneEl?.querySelector('.editor-pane-header')
      || floatingPanelEl?.querySelector('.nextv-floating-code-header')
    if (!headerEl) continue

    let button = headerEl.querySelector('.pane-surface-switch')
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      button.className = 'pane-surface-switch'
      button.textContent = 'surface'
      button.hidden = true
      button.addEventListener('click', () => {
        const mode = getEligibleSurfaceModeForPane(paneId)
        if (!mode) return
        const currentlyActive = paneSurfaceSwitchState.get(paneId) === true
        paneSurfaceSwitchState.set(paneId, !currentlyActive)
        refreshSurfacePaneSwitchUi()
      })
      const floatingActions = headerEl.querySelector('.nextv-floating-code-actions')
      if (floatingActions) {
        headerEl.insertBefore(button, floatingActions)
      } else {
        headerEl.appendChild(button)
      }
    }

    paneSwitchButtons.set(paneId, button)
  }
}

function removeSurfacePaneSwitchControls() {
  for (const button of paneSwitchButtons.values()) {
    button?.remove()
  }
  paneSwitchButtons.clear()
}

function refreshSurfacePaneSwitchUi() {
  if (surfaceBetaEnabled !== true) {
    for (const paneId of SURFACE_BETA_PANE_IDS) {
      paneSurfaceSwitchState.set(paneId, false)
      unmountSurfaceBetaForPane(paneId)
    }
    return
  }

  ensureSurfacePaneSwitchControls()

  for (const paneId of SURFACE_BETA_PANE_IDS) {
    const button = paneSwitchButtons.get(paneId)
    if (!button) continue

    const mode = getEligibleSurfaceModeForPane(paneId)
    if (!mode) {
      button.hidden = true
      button.classList.remove('active')
      paneSurfaceSwitchState.set(paneId, false)
      unmountSurfaceBetaForPane(paneId)
      continue
    }

    button.hidden = false
    const active = paneSurfaceSwitchState.get(paneId) === true
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', active ? 'true' : 'false')
    if (mode === 'nerve') {
      button.title = active
        ? 'nerve plugin active (original editor)'
        : 'enable nerve plugin (original editor)'
    } else {
      button.title = active
        ? `switch to original editor (${mode})`
        : `switch to surface (${mode})`
    }

    if (mode === 'nerve') {
      // Nerve files keep the original editor path even when surface toggle is active.
      unmountSurfaceBetaForPane(paneId)
      continue
    }

    if (active) {
      mountSurfaceBetaForPane(paneId)
    } else {
      unmountSurfaceBetaForPane(paneId)
    }
  }
}

function startSurfacePaneSwitchPolling() {
  if (surfacePaneSwitchPollTimer != null) return
  surfacePaneSwitchPollTimer = window.setInterval(() => {
    refreshSurfacePaneSwitchUi()
  }, 220)
}

function stopSurfacePaneSwitchPolling() {
  if (surfacePaneSwitchPollTimer == null) return
  window.clearInterval(surfacePaneSwitchPollTimer)
  surfacePaneSwitchPollTimer = null
}

function buildSurfaceBetaDom(shell) {
  const root = document.createElement('div')
  root.className = 'surface-beta-shell'

  const toolbar = document.createElement('div')
  toolbar.className = 'surface-beta-toolbar'

  const badge = document.createElement('span')
  badge.className = 'surface-beta-badge'
  badge.textContent = 'surface beta'

  const status = document.createElement('span')
  status.className = 'surface-beta-status'
  status.dataset.state = 'starting'
  status.textContent = 'starting'

  const metrics = document.createElement('span')
  metrics.className = 'surface-beta-metrics'

  const telemetry = document.createElement('span')
  telemetry.className = 'surface-beta-telemetry'

  const diagnostics = document.createElement('div')
  diagnostics.className = 'surface-beta-diagnostics'
  diagnostics.hidden = true

  const jsonBuilder = document.createElement('div')
  jsonBuilder.className = 'surface-beta-json-builder'
  jsonBuilder.hidden = true

  const jsonInlineEditor = document.createElement('div')
  jsonInlineEditor.className = 'surface-beta-json-inline-editor'
  jsonInlineEditor.hidden = true

  const jsonInlineEditorLabel = document.createElement('span')
  jsonInlineEditorLabel.className = 'surface-beta-json-inline-label'

  const jsonInlineEditorKeyInput = document.createElement('input')
  jsonInlineEditorKeyInput.className = 'surface-beta-json-inline-input'
  jsonInlineEditorKeyInput.type = 'text'
  jsonInlineEditorKeyInput.placeholder = 'key'

  const jsonInlineEditorType = document.createElement('select')
  jsonInlineEditorType.className = 'surface-beta-json-inline-select'
  ;[
    ['json', 'json'],
    ['string', 'string'],
    ['number', 'number'],
    ['boolean', 'boolean'],
    ['null', 'null'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    jsonInlineEditorType.appendChild(option)
  })

  const jsonInlineEditorValueInput = document.createElement('input')
  jsonInlineEditorValueInput.className = 'surface-beta-json-inline-input'
  jsonInlineEditorValueInput.type = 'text'
  jsonInlineEditorValueInput.placeholder = 'value'

  const jsonInlineApplyBtn = document.createElement('button')
  jsonInlineApplyBtn.type = 'button'
  jsonInlineApplyBtn.className = 'surface-beta-json-inline-btn'
  jsonInlineApplyBtn.textContent = 'apply'

  const jsonInlineCancelBtn = document.createElement('button')
  jsonInlineCancelBtn.type = 'button'
  jsonInlineCancelBtn.className = 'surface-beta-json-inline-btn'
  jsonInlineCancelBtn.textContent = 'cancel'

  jsonInlineEditor.appendChild(jsonInlineEditorLabel)
  jsonInlineEditor.appendChild(jsonInlineEditorKeyInput)
  jsonInlineEditor.appendChild(jsonInlineEditorType)
  jsonInlineEditor.appendChild(jsonInlineEditorValueInput)
  jsonInlineEditor.appendChild(jsonInlineApplyBtn)
  jsonInlineEditor.appendChild(jsonInlineCancelBtn)

  toolbar.appendChild(badge)
  toolbar.appendChild(status)
  toolbar.appendChild(metrics)
  toolbar.appendChild(telemetry)

  const editorInput = document.createElement('textarea')
  editorInput.className = 'surface-beta-input'
  editorInput.spellcheck = false
  editorInput.wrap = 'soft'
  editorInput.placeholder = '# Surface beta editor enabled for pane A'

  const preview = document.createElement('div')
  preview.className = 'surface-beta-preview'
  preview.hidden = true

  root.appendChild(toolbar)
  root.appendChild(diagnostics)
  root.appendChild(jsonBuilder)
  root.appendChild(jsonInlineEditor)
  root.appendChild(editorInput)
  root.appendChild(preview)
  shell.appendChild(root)

  return {
    root,
    toolbar,
    status,
    metrics,
    telemetry,
    preview,
    diagnostics,
    jsonBuilder,
    jsonInlineEditor,
    jsonInlineEditorLabel,
    jsonInlineEditorKeyInput,
    jsonInlineEditorType,
    jsonInlineEditorValueInput,
    jsonInlineApplyBtn,
    jsonInlineCancelBtn,
    editorInput,
  }
}

function mountSurfaceBetaForPane(paneId) {
  const resolvedPaneId = SURFACE_BETA_PANE_IDS.includes(String(paneId ?? '').trim().toUpperCase())
    ? String(paneId).trim().toUpperCase()
    : 'A'

  if (paneBindings.has(resolvedPaneId)) {
    return true
  }

  const shell = getPaneEditorShell(resolvedPaneId)
  const legacyTextarea = getPaneTextarea(resolvedPaneId)
  if (!shell || !legacyTextarea) {
    return false
  }

  const dom = buildSurfaceBetaDom(shell)
  applySurfaceTelemetryVisibility(dom)
  const surface = new Surface({ text: legacyTextarea.value })
  const renderer = new Renderer()
  const diagnosticsChannel = new DiagnosticsChannel()
  const markdownPlugin = createMarkdownPlugin({ previewEnabled: true })
  const jsonPlugin = createJsonPlugin({ trailingNewline: false, indent: 2 })
  const detachMarkdown = markdownPlugin.attach({ surface, renderer })
  const detachJson = jsonPlugin.attach({ surface, diagnosticsChannel })
  const telemetry = createSurfaceTelemetry()
  publishSurfaceTelemetrySnapshot(telemetry)

  let syncingFromLegacy = false
  let syncingFromSurface = false
  let activeMode = 'markdown'
  let jsonInlineDraft = null
  let lastPanePath = normalizePathForModeTracking(getPaneTrackedPath(resolvedPaneId))
  const suppressScrollSync = new WeakSet()

  function normalizePathForModeTracking(path) {
    return String(path ?? '').trim()
  }

  function syncModeFromPathOrContent(options = {}) {
    const forceContentFallback = options.forceContentFallback === true
    const currentPanePath = normalizePathForModeTracking(getPaneTrackedPath(resolvedPaneId))
    const pathChanged = currentPanePath !== lastPanePath
    const currentPathMode = inferModeFromPath(currentPanePath)
    if (pathChanged) {
      lastPanePath = currentPanePath
      if (currentPathMode) {
        setMode(currentPathMode)
        return
      }
    }

    if (forceContentFallback) {
      if (currentPathMode) {
        setMode(currentPathMode)
        return
      }
      setMode(inferModeFromContent(surface.getText()))
    }
  }

  function getScrollRatio(element) {
    if (!element) return 0
    const max = Math.max(0, element.scrollHeight - element.clientHeight)
    if (max <= 0) return 0
    return Math.max(0, Math.min(1, element.scrollTop / max))
  }

  function getLineHeightForEditor() {
    const style = window.getComputedStyle(dom.editorInput)
    const lineHeight = Number.parseFloat(style.lineHeight)
    if (Number.isFinite(lineHeight) && lineHeight > 0) {
      return lineHeight
    }
    const fontSize = Number.parseFloat(style.fontSize)
    if (Number.isFinite(fontSize) && fontSize > 0) {
      return fontSize * 1.5
    }
    return 20
  }

  function getLineIndexForOffset(text, offset) {
    const offsets = buildLineOffsets(text)
    const clampedOffset = Math.max(0, Math.min(Number.isInteger(offset) ? offset : 0, String(text ?? '').length))

    let low = 0
    let high = Math.max(0, offsets.length - 1)
    let best = 0
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if ((offsets[mid] ?? 0) <= clampedOffset) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    return best
  }

  function getTopOffsetForEditor(text) {
    const lineHeight = Math.max(1, getLineHeightForEditor())
    const topLine = Math.max(0, Math.floor(dom.editorInput.scrollTop / lineHeight))
    const offsets = buildLineOffsets(text)
    return offsets[Math.min(offsets.length - 1, topLine)] ?? 0
  }

  function setScrollTop(element, scrollTop) {
    if (!element) return
    suppressScrollSync.add(element)
    element.scrollTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0)
    window.requestAnimationFrame(() => {
      suppressScrollSync.delete(element)
    })
  }

  function findTopVisibleJsonBuilderRow() {
    const rows = dom.jsonBuilder.querySelectorAll('.surface-beta-json-row[data-path]')
    if (!rows.length) return null
    const top = dom.jsonBuilder.getBoundingClientRect().top + 1

    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom > top) {
        return row
      }
    }

    return rows[rows.length - 1]
  }

  function syncJsonBuilderFromEditorAnchored() {
    if (dom.jsonBuilder.hidden) return
    if (suppressScrollSync.has(dom.editorInput)) return

    const topLine = Math.max(1, Math.floor(dom.editorInput.scrollTop / Math.max(1, getLineHeightForEditor())) + 1)
    const rows = dom.jsonBuilder.querySelectorAll('.surface-beta-json-row[data-line]')
    if (!rows.length) return

    let row = null
    for (const candidate of rows) {
      const line = Number(candidate.dataset.line)
      if (Number.isFinite(line) && line >= topLine) {
        row = candidate
        break
      }
    }
    if (!row) {
      row = rows[rows.length - 1]
    }

    const nextTop = Math.max(0, row.offsetTop - 4)
    setScrollTop(dom.jsonBuilder, nextTop)
  }

  function syncEditorFromJsonBuilderAnchored() {
    if (dom.jsonBuilder.hidden) return
    if (suppressScrollSync.has(dom.jsonBuilder)) return

    const row = findTopVisibleJsonBuilderRow()
    if (!row) return

    const parsedLine = Number(row.dataset.line)
    const lineNumber = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : 1
    const nextTop = Math.max(0, (lineNumber - 1) * getLineHeightForEditor())
    setScrollTop(dom.editorInput, nextTop)
  }

  function setScrollRatio(element, ratio) {
    if (!element) return
    const max = Math.max(0, element.scrollHeight - element.clientHeight)
    const nextTop = max <= 0 ? 0 : Math.round(max * Math.max(0, Math.min(1, ratio)))
    setScrollTop(element, nextTop)
  }

  function syncScroll(source, target) {
    if (!source || !target) return
    if (suppressScrollSync.has(source)) return
    setScrollRatio(target, getScrollRatio(source))
  }

  function syncPartnerScrollFromEditor() {
    if (activeMode === 'markdown') {
      if (dom.preview.hidden) return
      syncScroll(dom.editorInput, dom.preview)
      return
    }

    if (activeMode === 'json') {
      syncJsonBuilderFromEditorAnchored()
    }
  }

  function renderPreview(text) {
    if (activeMode === 'markdown') {
      dom.preview.hidden = false
      dom.preview.innerHTML = markdownPlugin.renderPreview(text)
      return
    }

    dom.preview.hidden = true
    dom.preview.innerHTML = ''
  }

  function tryParsePath(value) {
    try {
      const parsed = JSON.parse(String(value ?? '[]'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function createJsonNodeRow({
    path,
    keyLabel,
    value,
    lineNumber,
    depth,
    parentType,
    parentPath,
    parentKey,
  }) {
    const row = document.createElement('div')
    row.className = 'surface-beta-json-row'
    row.style.paddingLeft = `${Math.max(0, depth) * 14 + 8}px`
    row.dataset.path = JSON.stringify(path)
    row.dataset.line = String(Math.max(1, Number.isInteger(lineNumber) ? lineNumber : 1))

    if (keyLabel) {
      const title = document.createElement('span')
      title.className = 'surface-beta-json-row-title'
      title.textContent = keyLabel
      if (parentType === 'object' && typeof parentKey === 'string') {
        title.classList.add('is-clickable')
        title.dataset.jsonInlineAction = 'rename-key'
        title.dataset.parentPath = JSON.stringify(parentPath ?? [])
        title.dataset.key = parentKey
      }
      row.appendChild(title)
    }

    const isArray = Array.isArray(value)
    const isObject = value && typeof value === 'object' && !isArray

    const valuePreview = document.createElement('span')
    valuePreview.className = 'surface-beta-json-row-value'
    if (isArray || isObject) {
      valuePreview.textContent = ''
    } else if (typeof value === 'string') {
      valuePreview.textContent = value.length > 36 ? `${value.slice(0, 36)}...` : value
      valuePreview.classList.add('is-clickable')
      valuePreview.dataset.jsonInlineAction = 'set-value'
      valuePreview.dataset.path = JSON.stringify(path)
      valuePreview.dataset.valueType = 'string'
      valuePreview.dataset.valueRaw = value
    } else {
      valuePreview.textContent = String(value)
    }
    row.appendChild(valuePreview)

    const actions = document.createElement('div')
    actions.className = 'surface-beta-json-row-actions'

    const addAction = (label, actionName, extra = {}) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'surface-beta-json-row-btn'
      btn.textContent = label
      btn.dataset.jsonAction = actionName
      btn.dataset.path = JSON.stringify(path)
      btn.dataset.parentPath = JSON.stringify(parentPath ?? [])
      btn.dataset.parentType = String(parentType ?? '')
      if (typeof parentKey === 'string' || Number.isInteger(parentKey)) {
        btn.dataset.parentKey = String(parentKey)
      }
      for (const [key, extraValue] of Object.entries(extra)) {
        btn.dataset[key] = String(extraValue)
      }
      actions.appendChild(btn)
    }

    if (isObject) {
      addAction('+prop', 'add-property')
    }
    if (isArray) {
      addAction('+item', 'add-item')
    }

    if (!isObject && !isArray) {
      if (typeof value === 'boolean') {
        addAction('toggle', 'toggle-bool')
      }
    }

    if (parentType === 'object' && typeof parentKey === 'string') {
      addAction('remove', 'remove-property', { key: parentKey })
    }

    if (parentType === 'array' && Number.isInteger(parentKey)) {
      addAction('remove', 'remove-item', { index: parentKey })
    }

    row.appendChild(actions)
    return row
  }

  function renderJsonBuilderNode(container, node, path, depth, relation = {}, lineLookup = null) {
    const keyLabel = relation.kind === 'object'
      ? String(relation.key)
      : (relation.kind === 'array' ? '' : '$')
    const pathKey = JSON.stringify(path)
    const lineNumber = lineLookup instanceof Map
      ? (lineLookup.get(pathKey) ?? 1)
      : 1

    container.appendChild(createJsonNodeRow({
      path,
      keyLabel,
      value: node,
      lineNumber,
      depth,
      parentType: relation.kind ?? '',
      parentPath: relation.parentPath ?? [],
      parentKey: relation.key,
    }))

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        renderJsonBuilderNode(container, node[index], [...path, index], depth + 1, {
          kind: 'array',
          parentPath: path,
          key: index,
        }, lineLookup)
      }
      return
    }

    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        renderJsonBuilderNode(container, value, [...path, key], depth + 1, {
          kind: 'object',
          parentPath: path,
          key,
        }, lineLookup)
      }
    }
  }

  function renderJsonBuilder(text) {
    if (activeMode !== 'json') {
      dom.jsonBuilder.hidden = true
      dom.jsonBuilder.innerHTML = ''
      closeJsonInlineEditor()
      return
    }

    dom.jsonBuilder.hidden = false
    dom.jsonBuilder.innerHTML = ''

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      const hint = document.createElement('div')
      hint.className = 'surface-beta-json-builder-empty'
      hint.textContent = 'builder disabled until JSON is valid'
      dom.jsonBuilder.appendChild(hint)
      return
    }

    const lineLookup = buildJsonPathLineLookup(text)
    renderJsonBuilderNode(dom.jsonBuilder, parsed, [], 0, { kind: 'root', key: '$', parentPath: [] }, lineLookup)
  }

  function setStatus(status, reason = '') {
    telemetry.status = status
    telemetry.statusReason = reason
    dom.status.dataset.state = status
    dom.status.textContent = reason ? `${status}: ${reason}` : status
    publishSurfaceTelemetrySnapshot(telemetry)
  }

  function recordError(error, reason) {
    telemetry.counters.errors += 1
    const message = String(error?.message ?? reason ?? 'error')
    setStatus('error', message)
  }

  function renderSurfaceMetrics() {
    const text = surface.getText()
    telemetry.lengths.surfaceText = text.length
    telemetry.lengths.legacyText = legacyTextarea.value.length
    telemetry.lengths.driftChars = Math.abs(telemetry.lengths.surfaceText - telemetry.lengths.legacyText)
    const lineCount = text.length === 0 ? 1 : text.split('\n').length
    const tokenCount = activeMode === 'json'
      ? tokenizeJson(text).length
      : renderer.getTokens().length
    dom.metrics.textContent = `${lineCount} lines, ${tokenCount} tokens, drift ${telemetry.lengths.driftChars}`

    const uptimeSeconds = Math.max(0, Math.floor((Date.now() - telemetry.mountedAt) / 1000))
    const sinceLastSyncMs = telemetry.lastSyncAt > 0 ? Date.now() - telemetry.lastSyncAt : -1
    const syncAgeLabel = sinceLastSyncMs >= 0 ? `${sinceLastSyncMs}ms ago` : 'n/a'
    dom.telemetry.textContent = [
      `src=${telemetry.lastSyncSource}`,
      `mode=${activeMode}`,
      `legacy->surface=${telemetry.counters.legacyToSurfaceSync}`,
      `surface->legacy=${telemetry.counters.surfaceToLegacySync}`,
      `errors=${telemetry.counters.errors}`,
      `last=${syncAgeLabel}`,
      `up=${uptimeSeconds}s`,
    ].join(' | ')

    publishSurfaceTelemetrySnapshot(telemetry)
  }

  function syncSurfaceToDom(statusReason = 'surface active') {
    let text = ''
    try {
      text = surface.getText()
    } catch (error) {
      recordError(error, 'surface read failed')
      return
    }
    telemetry.lastSyncAt = Date.now()
    telemetry.lastSyncSource = 'surface'
    telemetry.counters.surfaceToLegacySync += 1

    if (dom.editorInput.value !== text) {
      const selection = surface.getSelection()
      dom.editorInput.value = text
      dom.editorInput.setSelectionRange(selection.start, selection.end)
    }

    if (legacyTextarea.value !== text) {
      try {
        syncingFromSurface = true
        legacyTextarea.value = text
        legacyTextarea.dispatchEvent(new Event('input', { bubbles: true }))
      } catch (error) {
        recordError(error, 'legacy sync failed')
      } finally {
        syncingFromSurface = false
      }
    }

    renderPreview(text)
    renderJsonBuilder(text)
    syncPartnerScrollFromEditor()

    setStatus('live', statusReason)
    renderSurfaceMetrics()
  }

  function syncLegacyToSurface() {
    if (syncingFromSurface) {
      return
    }

    const value = legacyTextarea.value
    syncModeFromPathOrContent()
    if (value === surface.getText()) {
      telemetry.counters.syncPollTicks += 1
      return
    }

    setStatus('syncing', 'legacy -> surface')
    try {
      syncingFromLegacy = true
      telemetry.lastSyncAt = Date.now()
      telemetry.lastSyncSource = 'legacy'
      telemetry.counters.legacyToSurfaceSync += 1
      surface.setText(value)
    } catch (error) {
      recordError(error, 'surface sync failed')
    } finally {
      syncingFromLegacy = false
    }
  }

  const onLegacyInput = () => {
    telemetry.counters.legacyInput += 1
    syncLegacyToSurface()
  }

  const onSurfaceChange = () => {
    syncSurfaceToDom(syncingFromLegacy ? 'legacy mirrored' : 'surface active')
  }

  const onSurfaceInput = () => {
    if (activeMode === 'json') {
      return
    }
    if (syncingFromSurface) {
      return
    }
    telemetry.counters.surfaceInput += 1
    setStatus('syncing', 'surface -> legacy')
    try {
      surface.setSelection(dom.editorInput.selectionStart, dom.editorInput.selectionEnd)
      surface.setText(dom.editorInput.value)
    } catch (error) {
      recordError(error, 'surface write failed')
    }
  }

  const onSurfaceClick = async () => {
    if (dom.editorInput.selectionStart !== dom.editorInput.selectionEnd) return

    const text = String(dom.editorInput.value ?? '')
    const primaryOffset = Number(dom.editorInput.selectionStart)
    const candidateOffsets = [primaryOffset, Math.max(0, primaryOffset - 1)]

    for (const offset of candidateOffsets) {
      const opened = await openEditorClickTargetAtOffset(text, offset)
      if (opened) return
    }
  }

  const onSurfaceKeyDown = (event) => {
    const isCommandKey = event.ctrlKey || event.metaKey
    if (!isCommandKey || event.altKey) {
      return
    }

    if (event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        surface.redo()
      } else {
        surface.undo()
      }
      syncSurfaceToDom()
      return
    }

    if (event.key.toLowerCase() === 'y') {
      event.preventDefault()
      surface.redo()
      syncSurfaceToDom()
      return
    }

    if (event.key.toLowerCase() === 'b' && activeMode === 'markdown') {
      event.preventDefault()
      telemetry.counters.commandWrapBold += 1
      try {
        surface.setSelection(dom.editorInput.selectionStart, dom.editorInput.selectionEnd)
        surface.dispatchCommand('markdown.wrapBold')
        syncSurfaceToDom()
      } catch (error) {
        recordError(error, 'bold command failed')
      }
      return
    }

    if (event.key.toLowerCase() === 'i' && activeMode === 'markdown') {
      event.preventDefault()
      telemetry.counters.commandWrapItalic += 1
      try {
        surface.setSelection(dom.editorInput.selectionStart, dom.editorInput.selectionEnd)
        surface.dispatchCommand('markdown.wrapItalic')
        syncSurfaceToDom()
      } catch (error) {
        recordError(error, 'italic command failed')
      }
      return
    }

  }

  function renderDiagnostics() {
    const diagnostics = diagnosticsChannel.getDiagnostics()
    if (activeMode !== 'json') {
      dom.diagnostics.hidden = true
      dom.diagnostics.textContent = ''
      return
    }

    if (diagnostics.length === 0) {
      dom.diagnostics.hidden = false
      dom.diagnostics.dataset.level = 'ok'
      dom.diagnostics.textContent = 'json diagnostics: clean'
      return
    }

    const first = diagnostics[0]
    dom.diagnostics.hidden = false
    dom.diagnostics.dataset.level = first.severity === 'error' ? 'error' : 'warn'
    dom.diagnostics.textContent = `json diagnostics: ${first.severity} L${first.line}:C${first.column} ${first.message}`
  }

  function setMode(nextMode) {
    activeMode = nextMode === 'json'
      ? 'json'
      : (nextMode === 'nerve' ? 'nerve' : 'markdown')
    const useOriginalEditor = activeMode === 'nerve'
    dom.root.hidden = useOriginalEditor
    shell.classList.toggle('surface-beta-enabled', !useOriginalEditor)
    dom.editorInput.readOnly = activeMode === 'json'
    dom.editorInput.wrap = activeMode === 'json' ? 'off' : 'soft'
    dom.editorInput.classList.toggle('is-json-output', activeMode === 'json')
    if (activeMode !== 'json') {
      closeJsonInlineEditor()
    }
    renderDiagnostics()
    renderPreview(surface.getText())
    renderJsonBuilder(surface.getText())
    syncPartnerScrollFromEditor()
    renderSurfaceMetrics()
  }

  function parseJsonPromptValue(inputValue) {
    const raw = String(inputValue ?? '').trim()
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  function parseJsonInlineValue() {
    const type = String(dom.jsonInlineEditorType.value ?? 'json')
    const raw = String(dom.jsonInlineEditorValueInput.value ?? '')
    if (type === 'null') return null
    if (type === 'string') return raw
    if (type === 'number') {
      const numeric = Number(raw)
      return Number.isFinite(numeric) ? numeric : 0
    }
    if (type === 'boolean') {
      return String(raw).trim().toLowerCase() === 'true'
    }
    return parseJsonPromptValue(raw)
  }

  function closeJsonInlineEditor() {
    jsonInlineDraft = null
    dom.jsonInlineEditor.hidden = true
    dom.jsonInlineEditorLabel.textContent = ''
    dom.jsonInlineEditorKeyInput.value = ''
    dom.jsonInlineEditorValueInput.value = ''
  }

  function openJsonInlineEditor(draft) {
    jsonInlineDraft = draft
    dom.jsonInlineEditor.hidden = false
    dom.jsonInlineEditorLabel.textContent = String(draft?.label ?? 'edit')
    dom.jsonInlineEditorKeyInput.hidden = draft?.needsKey !== true
    dom.jsonInlineEditorType.hidden = draft?.needsValue !== true
    dom.jsonInlineEditorValueInput.hidden = draft?.needsValue !== true
    dom.jsonInlineEditorKeyInput.value = String(draft?.keyValue ?? '')
    dom.jsonInlineEditorValueInput.value = String(draft?.valueRaw ?? '')
    dom.jsonInlineEditorType.value = String(draft?.valueType ?? 'json')
    if (draft?.needsKey === true) {
      dom.jsonInlineEditorKeyInput.focus()
      dom.jsonInlineEditorKeyInput.select()
    } else if (draft?.needsValue === true) {
      dom.jsonInlineEditorValueInput.focus()
      dom.jsonInlineEditorValueInput.select()
    }
  }

  function applyJsonInlineEditor() {
    if (!jsonInlineDraft) {
      return
    }

    const draft = jsonInlineDraft
    const keyValue = String(dom.jsonInlineEditorKeyInput.value ?? '').trim()
    const value = parseJsonInlineValue()

    withJsonMode(() => {
      if (draft.action === 'add-property') {
        if (!keyValue) return
        surface.dispatchCommand('json.addProperty', { path: draft.path, key: keyValue, value })
      } else if (draft.action === 'rename-key') {
        if (!keyValue || keyValue === draft.key) return
        surface.dispatchCommand('json.renameKey', { path: draft.parentPath, fromKey: draft.key, toKey: keyValue })
      } else if (draft.action === 'set-value') {
        surface.dispatchCommand('json.setValue', { path: draft.path, value })
      } else if (draft.action === 'add-item') {
        surface.dispatchCommand('json.addArrayItem', { path: draft.path, value })
      }
    })

    closeJsonInlineEditor()
  }

  function withJsonMode(operation) {
    if (activeMode !== 'json') {
      setMode('json')
    }
    try {
      operation()
    } catch (error) {
      recordError(error, 'json control failed')
    } finally {
      syncSurfaceToDom()
      renderDiagnostics()
    }
  }

  const onJsonBuilderClick = (event) => {
    const actionButton = event.target.closest('[data-json-action]')
    if (!actionButton) {
      const inlineTarget = event.target.closest('[data-json-inline-action]')
      if (!inlineTarget) {
        return
      }

      const inlineAction = String(inlineTarget.dataset.jsonInlineAction ?? '').trim()
      if (inlineAction === 'rename-key') {
        const inlineParentPath = tryParsePath(inlineTarget.dataset.parentPath)
        const inlineKey = String(inlineTarget.dataset.key ?? '').trim()
        if (!inlineKey) return
        openJsonInlineEditor({
          action: 'rename-key',
          label: `rename ${inlineKey}`,
          parentPath: inlineParentPath,
          key: inlineKey,
          needsKey: true,
          keyValue: inlineKey,
          needsValue: false,
        })
        return
      }

      if (inlineAction === 'set-value') {
        const inlinePath = tryParsePath(inlineTarget.dataset.path)
        const inlineValueType = String(inlineTarget.dataset.valueType ?? 'json')
        const inlineValueRaw = String(inlineTarget.dataset.valueRaw ?? '')
        openJsonInlineEditor({
          action: 'set-value',
          label: 'set value',
          path: inlinePath,
          needsKey: false,
          needsValue: true,
          valueType: inlineValueType,
          valueRaw: inlineValueRaw,
        })
      }

      return
    }

    const action = String(actionButton.dataset.jsonAction ?? '').trim()
    const path = tryParsePath(actionButton.dataset.path)
    const parentPath = tryParsePath(actionButton.dataset.parentPath)
    const key = String(actionButton.dataset.key ?? '').trim()
    const index = Number(actionButton.dataset.index)

    if (action === 'add-property') {
      openJsonInlineEditor({
        action,
        label: 'add property',
        path,
        needsKey: true,
        needsValue: true,
        valueType: 'json',
        valueRaw: '{}',
      })
      return
    }

    if (action === 'rename-key') {
      if (!key) return
      openJsonInlineEditor({
        action,
        label: `rename ${key}`,
        parentPath,
        key,
        needsKey: true,
        keyValue: key,
        needsValue: false,
      })
      return
    }

    if (action === 'set-value') {
      openJsonInlineEditor({
        action,
        label: 'set value',
        path,
        needsKey: false,
        needsValue: true,
        valueType: 'json',
        valueRaw: 'null',
      })
      return
    }

    if (action === 'add-item') {
      openJsonInlineEditor({
        action,
        label: 'add array item',
        path,
        needsKey: false,
        needsValue: true,
        valueType: 'json',
        valueRaw: 'null',
      })
      return
    }

    withJsonMode(() => {
      if (action === 'remove-property') {
        if (!key) return
        surface.dispatchCommand('json.removeProperty', { path: parentPath, key })
        return
      }

      if (action === 'toggle-bool') {
        surface.dispatchCommand('json.toggleBoolean', { path })
        return
      }

      if (action === 'remove-item') {
        if (!Number.isInteger(index)) return
        surface.dispatchCommand('json.removeArrayItem', { path: parentPath, index })
      }
    })
  }

  const onJsonInlineApply = () => {
    applyJsonInlineEditor()
  }

  const onJsonInlineCancel = () => {
    closeJsonInlineEditor()
  }

  const onJsonInlineKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      applyJsonInlineEditor()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeJsonInlineEditor()
    }
  }

  const onEditorScroll = () => {
    syncPartnerScrollFromEditor()
  }

  const onPreviewScroll = () => {
    if (activeMode !== 'markdown' || dom.preview.hidden) {
      return
    }
    syncScroll(dom.preview, dom.editorInput)
  }

  const onJsonBuilderScroll = () => {
    if (activeMode !== 'json' || dom.jsonBuilder.hidden) {
      return
    }
    syncEditorFromJsonBuilderAnchored()
  }

  legacyTextarea.addEventListener('input', onLegacyInput)
  dom.editorInput.addEventListener('input', onSurfaceInput)
  dom.editorInput.addEventListener('click', onSurfaceClick)
  dom.editorInput.addEventListener('keydown', onSurfaceKeyDown)
  dom.editorInput.addEventListener('scroll', onEditorScroll)
  dom.preview.addEventListener('scroll', onPreviewScroll)
  dom.jsonBuilder.addEventListener('scroll', onJsonBuilderScroll)
  dom.jsonBuilder.addEventListener('click', onJsonBuilderClick)
  dom.jsonInlineApplyBtn.addEventListener('click', onJsonInlineApply)
  dom.jsonInlineCancelBtn.addEventListener('click', onJsonInlineCancel)
  dom.jsonInlineEditorKeyInput.addEventListener('keydown', onJsonInlineKeyDown)
  dom.jsonInlineEditorValueInput.addEventListener('keydown', onJsonInlineKeyDown)

  const unsubscribeSurface = surface.on('change', onSurfaceChange)
  const unsubscribeDiagnostics = diagnosticsChannel.subscribe(() => {
    renderDiagnostics()
  })

  // Capture programmatic textarea updates that bypass input events.
  const syncTimer = window.setInterval(syncLegacyToSurface, 180)
  const telemetryTimer = window.setInterval(() => {
    telemetry.counters.syncPollTicks += 1
    renderSurfaceMetrics()
  }, 1000)

  syncModeFromPathOrContent({ forceContentFallback: true })
  renderDiagnostics()
  syncSurfaceToDom()

  const paneBinding = {
    paneId: resolvedPaneId,
    shell,
    dom,
    detachMarkdown,
    detachJson,
    unsubscribeSurface,
    unsubscribeDiagnostics,
    syncTimer,
    telemetryTimer,
    onLegacyInput,
    onSurfaceInput,
    onSurfaceClick,
    onSurfaceKeyDown,
    onEditorScroll,
    onPreviewScroll,
    onJsonBuilderScroll,
    onJsonBuilderClick,
    onJsonInlineApply,
    onJsonInlineCancel,
    onJsonInlineKeyDown,
    legacyTextarea,
    setStatus,
    telemetry,
  }

  paneBindings.set(resolvedPaneId, paneBinding)

  return true
}

function unmountSurfaceBetaForPane(paneId) {
  const resolvedPaneId = SURFACE_BETA_PANE_IDS.includes(String(paneId ?? '').trim().toUpperCase())
    ? String(paneId).trim().toUpperCase()
    : 'A'
  const paneBinding = paneBindings.get(resolvedPaneId)
  if (!paneBinding) {
    return
  }

  const {
    shell,
    dom,
    detachMarkdown,
    detachJson,
    unsubscribeSurface,
    unsubscribeDiagnostics,
    syncTimer,
    telemetryTimer,
    onLegacyInput,
    onSurfaceInput,
    onSurfaceClick,
    onSurfaceKeyDown,
    onEditorScroll,
    onPreviewScroll,
    onJsonBuilderScroll,
    onJsonBuilderClick,
    onJsonInlineApply,
    onJsonInlineCancel,
    onJsonInlineKeyDown,
    legacyTextarea,
    setStatus,
    telemetry,
  } = paneBinding

  window.clearInterval(syncTimer)
  window.clearInterval(telemetryTimer)
  legacyTextarea.removeEventListener('input', onLegacyInput)
  dom.editorInput.removeEventListener('input', onSurfaceInput)
  dom.editorInput.removeEventListener('click', onSurfaceClick)
  dom.editorInput.removeEventListener('keydown', onSurfaceKeyDown)
  dom.editorInput.removeEventListener('scroll', onEditorScroll)
  dom.preview.removeEventListener('scroll', onPreviewScroll)
  dom.jsonBuilder.removeEventListener('scroll', onJsonBuilderScroll)
  dom.jsonBuilder.removeEventListener('click', onJsonBuilderClick)
  dom.jsonInlineApplyBtn.removeEventListener('click', onJsonInlineApply)
  dom.jsonInlineCancelBtn.removeEventListener('click', onJsonInlineCancel)
  dom.jsonInlineEditorKeyInput.removeEventListener('keydown', onJsonInlineKeyDown)
  dom.jsonInlineEditorValueInput.removeEventListener('keydown', onJsonInlineKeyDown)

  if (typeof unsubscribeSurface === 'function') unsubscribeSurface()
  if (typeof unsubscribeDiagnostics === 'function') unsubscribeDiagnostics()
  if (typeof detachMarkdown === 'function') detachMarkdown()
  if (typeof detachJson === 'function') detachJson()

  setStatus('stopped', 'disabled')
  publishSurfaceTelemetrySnapshot(telemetry)

  shell.classList.remove('surface-beta-enabled')
  dom.root.remove()
  paneBindings.delete(resolvedPaneId)
}

export function setNextVEditorSurfaceBetaEnabled(enabled, options = {}) {
  const nextEnabled = Boolean(enabled)
  surfaceBetaEnabled = nextEnabled

  if (nextVEditorSurfaceBetaToggle) {
    nextVEditorSurfaceBetaToggle.checked = nextEnabled
  }

  if (nextEnabled) {
    ensureSurfacePaneSwitchControls()
    refreshSurfacePaneSwitchUi()
    startSurfacePaneSwitchPolling()
  } else {
    stopSurfacePaneSwitchPolling()
    for (const paneId of SURFACE_BETA_PANE_IDS) {
      paneSurfaceSwitchState.set(paneId, false)
      unmountSurfaceBetaForPane(paneId)
    }
    removeSurfacePaneSwitchControls()
  }

  if (options.persist !== false) {
    persistSurfaceBetaEnabled(nextEnabled)
  }

  return surfaceBetaEnabled
}

export function setNextVEditorSurfaceTelemetryVisible(enabled, options = {}) {
  const nextVisible = enabled !== false
  surfaceTelemetryVisible = nextVisible

  if (nextVEditorSurfaceTelemetryToggle) {
    nextVEditorSurfaceTelemetryToggle.checked = nextVisible
  }

  for (const paneBinding of paneBindings.values()) {
    applySurfaceTelemetryVisibility(paneBinding.dom)
  }

  if (options.persist !== false) {
    persistSurfaceTelemetryVisible(nextVisible)
  }

  return surfaceTelemetryVisible
}

export function isNextVEditorSurfaceTelemetryVisible() {
  return surfaceTelemetryVisible
}

export function isNextVEditorSurfaceBetaEnabled() {
  return surfaceBetaEnabled
}

export function initNextVEditorSurfaceBeta() {
  setNextVEditorSurfaceTelemetryVisible(readStoredSurfaceTelemetryVisible(), { persist: false })
  const enabled = readStoredSurfaceBetaEnabled()
  setNextVEditorSurfaceBetaEnabled(enabled, { persist: false })
}

// --- Imports (auto-generated by gen-es-modules.js) ---
import {
  nextVEventsOutput,
} from './state.js'
import {
  openNextVCallInspectorForToken,
} from './12_stream.js'

let nextVTokenClickPluginBound = false

export function initNextVTokenClickPlugin() {
  if (!nextVEventsOutput || nextVTokenClickPluginBound) return
  nextVTokenClickPluginBound = true

  nextVEventsOutput.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('.exec-event-token[data-nerve-token-kind][data-nerve-token-value]')
      : null
    if (!target) return

    const kind = String(target.dataset.nerveTokenKind ?? '').trim().toLowerCase()
    const value = String(target.dataset.nerveTokenValue ?? '').trim()
    if (!value || (kind !== 'agent' && kind !== 'model')) return

    event.preventDefault()
    openNextVCallInspectorForToken(kind, value, { focusPrompt: true }).catch(() => {})
  })
}
