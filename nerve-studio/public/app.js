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
let activeScriptAbortController = null
let activeScriptRunId = ''
let nextVRuntimeRunning = false
let isRemoteMode = false
let isRemoteControlMode = false
let isRemoteRuntimeConnected = true
let remoteTransport = 'local'
let nextVEventSource = null
let nextVHasLiveRuntimeEvents = false
let visualOutputWindow = null
let traceRowCounter = 0
let nextVLastKnownState = null
let nextVStateFilterQuery = ''
let deleteConfirmTimeoutId = null
let deleteConfirmTickerId = null
let pendingDeleteConfirmResolver = null
const nextVStateSectionOpenByKey = new Map()
const SCRIPT_FILE_REF_REGEX = /([!?])?file:([^\s"']+)/g

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
  nextVOpenFile: 'local-agent.nextv.openFilePath',
  nextVTreeWidth: 'local-agent.nextv.treeWidth',
  nextVTreeDrawerOpen: 'local-agent.nextv.treeDrawerOpen',
  nextVStateDiffOpen: 'local-agent.nextv.stateDiffOpen',
  nextVStateDiffWidth: 'local-agent.nextv.stateDiffWidth',
  nextVStateFilter: 'local-agent.nextv.stateFilter',
  nextVUserIOOpen: 'local-agent.nextv.userIOOpen',
  nextVUserIOWidth: 'local-agent.nextv.userIOWidth',
  nextVGraphDirection: 'local-agent.nextv.graphDirection',
}

const MIN_LEFT_PANEL_SECTION_HEIGHT = 90

const scriptEditorState = {
  path: '',
  loadedText: '',
  dirty: false,
}

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
  runtimeStepByNode: new Map(),
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
  selectedNodeId: '',
  autoFollowEnabled: false,
  layoutDirection: 'TB',
  setSelectedGraphNodeFn: null,
  layoutPositions: new Map(),
  savedViewportState: null,
  pendingTimerPulses: [],
  graphRefreshInProgress: false,
  detailPopoverEl: null,
  canvasEl: null,
}

const inputPanelState = {
  currentTab: 'ui',
}

const nextVInputImageState = {
  entries: [],
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
const nextVInputTabUi = document.getElementById('nextv-input-tab-ui')
const nextVInputTabExternal = document.getElementById('nextv-input-tab-external')
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
const nextVImageDropzone = document.getElementById('nextv-image-dropzone')
const nextVImageInput = document.getElementById('nextv-image-input')
const nextVImageCount = document.getElementById('nextv-image-count')
const nextVImageList = document.getElementById('nextv-image-list')
const nextVStartBtn = document.getElementById('nextv-start-btn')
const nextVStopBtn = document.getElementById('nextv-stop-btn')
const remoteModeBadge = document.getElementById('remote-mode-badge')
const userOutput = document.getElementById('user-output')
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
const nextVInputUiPane = document.getElementById('nextv-input-ui-pane')
const nextVInputExternalPane = document.getElementById('nextv-input-external-pane')
const fileTree = document.getElementById('file-tree')
const fileTreePane = document.getElementById('file-tree-pane')
const fileTreeSplitter = document.getElementById('file-tree-splitter')
const filetreeDeleteConfirm = document.getElementById('filetree-delete-confirm')
const filetreeDeleteDesc = document.getElementById('filetree-delete-desc')
const filetreeDeleteTimer = document.getElementById('filetree-delete-timer')
const splitter = document.getElementById('panel-splitter')
const workspace = document.getElementById('workspace')

function updateScriptRunControls() {
  if (cancelScriptBtn) {
    cancelScriptBtn.disabled = activeScriptAbortController === null
  }
}

function appendUserOutputMessage(text) {
  if (!userOutput) return
  const content = String(text ?? '').trim()
  if (!content) return

  const empty = userOutput.querySelector('.user-output-empty')
  if (empty) empty.remove()

  const row = document.createElement('div')
  row.className = 'user-output-message'
  row.textContent = content
  userOutput.appendChild(row)
  userOutput.scrollTop = userOutput.scrollHeight
}

function appendUserOutputVoice(event) {
  if (!userOutput) return

  const empty = userOutput.querySelector('.user-output-empty')
  if (empty) empty.remove()

  const row = document.createElement('div')
  row.className = 'user-output-message'

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
  userOutput.scrollTop = userOutput.scrollHeight
}

function openVisualOutputWindow(visual, source = 'visual output') {
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
      visualOutputWindow = null
    }
  }

  const opened = window.open(url, 'local-agent-visual-output', 'popup=yes,width=980,height=720')
  if (!opened) {
    appendErrorRow('Could not open visual output window (popup blocked).')
    return
  }

  visualOutputWindow = opened
  setStatus(`${source} opened`)
}

function parseMaybeJson(value) {
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

function maybeRenderToolVisual(name, result) {
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

function clearUserOutputPanel() {
  if (!userOutput) return
  userOutput.innerHTML = ''
  const empty = document.createElement('div')
  empty.className = 'user-output-empty'
  empty.textContent = 'No user output yet.'
  userOutput.appendChild(empty)
  setStatus('user output cleared')
}

async function sendNextVUserText() {
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
    const res = await fetch('/api/nextv/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, eventType, source }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to enqueue nextv event')
    }

    if (!nextVEventSource) {
      appendNextVLogRow(`[nextv:event] queued type=${eventType} source=UI`, 'step')
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

function isScriptMode() {
  return document.body.classList.contains('mode-script')
}

function isNextVMode() {
  return document.body.classList.contains('mode-nextv')
}

function setActiveScriptRunId(runId) {
  activeScriptRunId = String(runId ?? '').trim()
}

function setNextVFileDrawerOpen(isOpen, options = {}) {
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

function toggleNextVFileDrawer() {
  const collapsed = document.body.classList.contains('nextv-tree-collapsed')
  setNextVFileDrawerOpen(collapsed)
}

function setModePanelLabels(mode) {
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
      outputTitle: 'dev console',
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
  if (outputHeaderTitle) outputHeaderTitle.textContent = labels.outputTitle
  if (outputHeaderBadge) {
    outputHeaderBadge.textContent = labels.outputBadge
    outputHeaderBadge.style.display = labels.outputBadge ? 'inline-block' : 'none'
  }
}

function setNextVPrimaryView(view, options = {}) {
  const { persist = true } = options
  const nextView = view === 'graph' ? 'graph' : 'editor'
  const previousView = nextVViewState.currentView

  if (previousView === 'graph' && nextView !== 'graph') {
    const captured = captureNextVGraphViewportState()
    if (captured) {
      nextVGraphState.savedViewportState = captured
    }
  }

  nextVViewState.currentView = nextView

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

function normalizeNextVGraphDirection(value) {
  return String(value ?? '').trim().toUpperCase() === 'LR' ? 'LR' : 'TB'
}

function setNextVGraphDirection(direction, options = {}) {
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

function setNextVStateDiffTab(tab) {
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

function setNextVDevTab(tab, options = {}) {
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

function setNextVDevConsoleOpen(open, options = {}) {
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

function toggleNextVDevConsole() {
  setNextVDevConsoleOpen(!nextVPanelState.devConsoleOpen)
}

function clampNextVUserIOWidth(value) {
  const numeric = Number(value)
  const maxWidth = Math.max(340, Math.min(860, Math.round(window.innerWidth * 0.72)))
  if (!Number.isFinite(numeric)) return 320
  return Math.max(240, Math.min(maxWidth, Math.round(numeric)))
}

function persistNextVUserIOWidth(width) {
  localStorage.setItem(storageKeys.nextVUserIOWidth, String(clampNextVUserIOWidth(width)))
}

function getStoredNextVUserIOWidth() {
  const stored = Number(localStorage.getItem(storageKeys.nextVUserIOWidth))
  if (!Number.isFinite(stored)) return 320
  return clampNextVUserIOWidth(stored)
}

function setUserIOPanelOpen(open, options = {}) {
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

function toggleUserIOPanel() {
  setUserIOPanelOpen(!userIOPanelState.open)
}

function setNextVInputTab(tab, options = {}) {
  const { persist = true } = options
  const nextTab = 'external'
  inputPanelState.currentTab = nextTab

  if (nextVInputTabUi) {
    nextVInputTabUi.classList.toggle('active', nextTab === 'ui')
    nextVInputTabUi.setAttribute('aria-selected', nextTab === 'ui' ? 'true' : 'false')
  }

  if (nextVInputTabExternal) {
    nextVInputTabExternal.classList.toggle('active', nextTab === 'external')
    nextVInputTabExternal.setAttribute('aria-selected', nextTab === 'external' ? 'true' : 'false')
  }

  if (nextVInputExternalPane) {
    const showExternal = isNextVMode() && nextTab === 'external'
    nextVInputExternalPane.classList.toggle('active-input-pane', showExternal)
  }

  if (persist) {
    localStorage.setItem(storageKeys.nextVInputTab, nextTab)
  }
}

function setAppMode(mode) {
  const nextMode = mode === 'script' || mode === 'nextv' ? mode : 'chat'
  document.body.classList.remove('mode-chat', 'mode-script', 'mode-nextv')
  document.body.classList.add(`mode-${nextMode}`)
  if (settingsMenu) settingsMenu.removeAttribute('open')
  setModePanelLabels(nextMode)
  setNextVDevTab(tracePanelState.currentTab, { persist: false })
  setNextVInputTab(inputPanelState.currentTab, { persist: false })
  localStorage.setItem(storageKeys.mode, nextMode)
  if (nextMode === 'script' || nextMode === 'nextv') {
    window.requestAnimationFrame(() => {
      applyStoredLeftPanelHeights()
      setNextVDevConsoleOpen(nextVPanelState.devConsoleOpen, { persist: false })
    })
  }

  if (nextMode !== 'nextv' && !nextVRuntimeRunning) {
    closeNextVStream()
  }
}

function setChatMode() {
  setAppMode('chat')
}

function setScriptMode() {
  setAppMode('script')
}

function setNextVMode(options = {}) {
  const { ensureEntrypoint = true, refreshGraph = true, preserveViewport = false } = options
  setAppMode('nextv')
  if (ensureEntrypoint) {
    ensureNextVEntrypointVisible({ logLoaded: false, warnOnDirty: true })
  }
  if (refreshGraph) {
    refreshNextVGraph({ silent: true, preserveViewport })
  }
}

function updateRemoteModeBadge() {
  if (!remoteModeBadge) return
  remoteModeBadge.hidden = isRemoteMode !== true
  if (!isRemoteMode) {
    remoteModeBadge.textContent = 'remote runtime'
    return
  }

  if (isRemoteControlMode) {
    remoteModeBadge.textContent = 'remote WS runtime (control)'
    return
  }

  if (remoteTransport === 'mqtt') {
    remoteModeBadge.textContent = 'remote MQTT runtime'
    return
  }

  remoteModeBadge.textContent = 'remote runtime'
}

function setNextVRunControls() {
  const hasEntrypoint = Boolean(normalizeRelativePath(nextVEntrypointInput?.value ?? ''))
  const remoteBlocksControl = isRemoteMode && (!isRemoteControlMode || !isRemoteRuntimeConnected)
  if (nextVStartBtn) nextVStartBtn.disabled = remoteBlocksControl || nextVRuntimeRunning || isBusy || !hasEntrypoint
  if (nextVStopBtn) nextVStopBtn.disabled = remoteBlocksControl || !nextVRuntimeRunning || isBusy
}

function appendPanelLogRow(panel, line, cls = '') {
  if (!panel) return
  const row = document.createElement('div')
  row.className = `script-log-row${cls ? ` ${cls}` : ''}`
  row.textContent = line
  panel.appendChild(row)
  panel.scrollTop = panel.scrollHeight
}

function clearNextVEventsOutput() {
  if (nextVEventsOutput) nextVEventsOutput.innerHTML = ''
}

function clearNextVConsoleOutput() {
  if (nextVConsoleOutput) nextVConsoleOutput.innerHTML = ''
}

function clearNextVGraphOutput() {
  if (nextVGraphOutput) nextVGraphOutput.innerHTML = ''
  for (const timerId of nextVGraphState.visualPulseTimers) {
    window.clearTimeout(timerId)
  }
  nextVGraphState.visualPulseTimers.clear()
  nextVGraphState.visualPulseTimersByNode.clear()
  nextVGraphState.detailPopoverEl = null
  nextVGraphState.canvasEl = null
  nextVGraphState.layoutPositions = new Map()
  nextVGraphState.setSelectedGraphNodeFn = null
}

function getNextVGraphViewport() {
  return document.getElementById('nextv-graph-viewport')
}

function getNextVGraphSvg() {
  return document.querySelector('#nextv-graph-viewport .nextv-graph-svg')
}

function getNextVGraphCanvas() {
  return document.querySelector('#nextv-graph-viewport .nextv-graph-canvas')
}

function getNextVGraphPadding(width, height) {
  return Math.max(220, Math.round(Math.max(width, height) * 0.7))
}

function getNextVGraphBaseMetrics() {
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

function getNextVGraphZoomProfile(zoom) {
  const normalizedZoom = clampNextVGraphZoom(zoom)
  const zoomOutProgress = Math.max(0, Math.min(1, (1 - normalizedZoom) / 0.75))
  return {
    density: 1 - (0.18 * zoomOutProgress),
    nodeScale: 1 + (0.22 * zoomOutProgress),
    paddingScale: 1 - (0.32 * zoomOutProgress),
  }
}

function getNextVGraphRenderScale(zoom) {
  const normalizedZoom = clampNextVGraphZoom(zoom)
  const profile = getNextVGraphZoomProfile(normalizedZoom)
  return normalizedZoom * profile.density
}

function getNextVGraphScaledPadding(zoom, viewport = getNextVGraphViewport()) {
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

function clampNextVGraphZoom(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(0.25, Math.min(4, numeric))
}

function getNextVGraphWheelZoomStep() {
  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  if (zoom < 0.75) return 0.05
  if (zoom > 2) return 0.2

  const progress = (zoom - 0.75) / (2 - 0.75)
  return 0.05 + (0.15 * progress)
}

function applyNextVGraphZoom() {
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

function positionNextVGraphPopover() {
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

function centerNextVGraphViewport() {
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

function captureNextVGraphViewportState(viewport = getNextVGraphViewport()) {
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

function restoreNextVGraphViewportState(viewportState, viewport = getNextVGraphViewport()) {
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

function scheduleNextVGraphViewportRestore(viewportState, attemptsRemaining = 10) {
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

function setNextVGraphZoom(value, options = {}) {
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

function zoomNextVGraph(delta, options = {}) {
  setNextVGraphZoom(nextVGraphState.zoom + delta, options)
}

function resetNextVGraphZoom() {
  setNextVGraphZoom(1)
}

function getNextVGraphFitZoom() {
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

function renderNextVGraphMessage(message, cls = '') {
  if (!nextVGraphOutput) return
  clearNextVGraphOutput()
  const row = document.createElement('div')
  row.className = `graph-empty${cls ? ` ${cls}` : ''}`
  row.textContent = String(message ?? '')
  nextVGraphOutput.appendChild(row)
}

function getTransitionClassName(classification) {
  const value = String(classification ?? '').trim().toLowerCase()
  if (value === 'pure' || value === 'llm' || value === 'side_effect' || value === 'mixed') {
    return value
  }
  return 'unknown'
}

function formatTransitionClassification(classification) {
  const value = getTransitionClassName(classification)
  if (value === 'side_effect') return 'side effect'
  if (value === 'llm') return 'llm'
  if (value === 'mixed') return 'mixed'
  if (value === 'pure') return 'pure'
  return 'unknown'
}

function appendTransitionChip(container, text, cls = '') {
  const chip = document.createElement('span')
  chip.className = `nextv-graph-chip${cls ? ` ${cls}` : ''}`
  chip.textContent = text
  container.appendChild(chip)
}

function clearNextVGraphRuntimeTimers() {
  for (const timerId of nextVGraphState.runtimeTimers) {
    window.clearTimeout(timerId)
  }
  nextVGraphState.runtimeTimers.clear()
}

function resetNextVGraphRuntimeState(options = {}) {
  const { keepExternalNodes = true, keepContractState = true } = options
  clearNextVGraphRuntimeTimers()
  nextVGraphState.runtimeStepByNode.clear()
  nextVGraphState.runtimeVisitedEdges.clear()
  nextVGraphState.runtimeActiveNodes.clear()
  nextVGraphState.runtimeActiveEdges.clear()
  nextVGraphState.runtimeTriggeredExternalNodes.clear()
  nextVGraphState.runtimeWarningNodes.clear()
  nextVGraphState.runtimeLastDispatchedNode = ''
  nextVGraphState.runtimeSequence = 0
  if (!keepExternalNodes) {
    nextVGraphState.runtimeExternalNodes.clear()
  }
  if (!keepContractState) {
    nextVGraphState.declaredExternalNodes.clear()
    nextVGraphState.contractWarningNodes.clear()
    nextVGraphState.contractWarnings = []
  }
}

function beginNextVGraphExecutionTrail() {
  resetNextVGraphRuntimeState({ keepExternalNodes: true })
  applyNextVGraphRuntimeVisuals()
}

function flashNextVGraphExternalEvent(eventType) {
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

function flashNextVGraphSignalDispatch(signalType, durationMs = 650) {
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

function formatNextVGraphEventValue(value) {
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

function flashNextVGraphEventValue(eventType, value, options = {}) {
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

function getNextVGraphEdgeFlashAnchor(edgeKey) {
  const edgeElement = nextVGraphState.edgeElements.get(edgeKey)
  if (!edgeElement) return null

  let point = null
  if (typeof edgeElement.getTotalLength === 'function' && typeof edgeElement.getPointAtLength === 'function') {
    try {
      const totalLength = Number(edgeElement.getTotalLength())
      if (Number.isFinite(totalLength) && totalLength > 0) {
        point = edgeElement.getPointAtLength(totalLength * 0.62)
      }
    } catch {
      // Fall back to data attributes below.
    }
  }

  if (!point) {
    const x1 = Number(edgeElement.getAttribute('x1'))
    const y1 = Number(edgeElement.getAttribute('y1'))
    const x2 = Number(edgeElement.getAttribute('x2'))
    const y2 = Number(edgeElement.getAttribute('y2'))
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      point = {
        x: x1 + ((x2 - x1) * 0.62),
        y: y1 + ((y2 - y1) * 0.62),
      }
    }
  }

  if (!point) return null

  const zoom = clampNextVGraphZoom(nextVGraphState.zoom)
  const renderScale = getNextVGraphRenderScale(zoom)
  const scaledPadding = getNextVGraphScaledPadding(zoom, getNextVGraphViewport())
  return {
    x: scaledPadding.x + (point.x * renderScale),
    y: scaledPadding.y + (point.y * renderScale),
  }
}

function flashNextVGraphEdgeValue(edgeKey, value) {
  const formatted = formatNextVGraphEventValue(value)
  if (!formatted) return

  const anchor = getNextVGraphEdgeFlashAnchor(edgeKey)
  if (!anchor) return

  const canvas = nextVGraphState.canvasEl ?? getNextVGraphCanvas()
  if (!canvas) return

  const badge = document.createElement('div')
  badge.className = 'nextv-graph-emit-value-flash nextv-graph-effect-value-flash'
  badge.textContent = formatted
  badge.style.left = `${Math.round(anchor.x + 10)}px`
  badge.style.top = `${Math.round(anchor.y - 14)}px`
  canvas.appendChild(badge)

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

function getNextVGraphEdgeKey(from, to) {
  return `${String(from ?? '').trim()}\u0000${String(to ?? '').trim()}`
}

function pulseNextVGraphNode(nodeId, durationMs = 650) {
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

function queueNextVGraphTimerPulse(eventType) {
  const normalizedEventType = String(eventType ?? '').trim()
  if (!normalizedEventType) return
  nextVGraphState.pendingTimerPulses.push(normalizedEventType)
  if (nextVGraphState.pendingTimerPulses.length > 64) {
    nextVGraphState.pendingTimerPulses.shift()
  }
}

function flushNextVGraphPendingTimerPulses() {
  if (nextVGraphState.pendingTimerPulses.length === 0) return

  const pulses = nextVGraphState.pendingTimerPulses.slice()
  nextVGraphState.pendingTimerPulses = []
  for (const eventType of pulses) {
    flashNextVGraphTimerPulse(eventType, { force: true })
  }
}

function flashNextVGraphTimerPulse(eventType, options = {}) {
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

function fadeNextVGraphActiveHighlights(delayMs = 700) {
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

function getNextVGraphEffectOutputNodeId(sourceEvent, outputFormat) {
  const source = String(sourceEvent ?? '').trim()
  const format = String(outputFormat ?? '').trim()
  if (!source || !format) return ''
  return `__effect__${source}__output__${format}`
}

function getNextVGraphEffectToolNodeId(sourceEvent, toolName) {
  const source = String(sourceEvent ?? '').trim()
  const tool = String(toolName ?? '').trim() || 'dynamic'
  if (!source) return ''
  return `__effect__${source}__tool__${tool}`
}

function collectNextVGraphExternalNodeCandidates(nodes, edges) {
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

function collectNextVGraphEffects(transitions) {
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

function normalizeNextVGraphFilePath(pathValue) {
  return String(pathValue ?? '').trim().replace(/\\/g, '/')
}

function compactNextVGraphFileLabel(pathValue) {
  const normalized = normalizeNextVGraphFilePath(pathValue)
  if (!normalized) return '(entrypoint)'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return '(entrypoint)'
  // Path is already workspace-relative; keep up to 2 trailing segments for compact display.
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

function getNextVGraphNodeGroupKey(nodeObj, entrypointPath = '') {
  const nodeSourcePath = normalizeNextVGraphFilePath(nodeObj?.sourcePath)
  if (nodeSourcePath) return nodeSourcePath

  const fallbackEntrypoint = normalizeNextVGraphFilePath(entrypointPath)
  if (fallbackEntrypoint) return fallbackEntrypoint

  return '(entrypoint)'
}

function getNextVGraphNodeVisual(nodeObj, effectLabel = '') {
  const nodeKind = String(nodeObj?.kind ?? 'event')
  const label = nodeKind === 'effect'
    ? String(effectLabel || nodeObj?.id || '')
    : String(nodeObj?.eventType || nodeObj?.id || '')

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

  const minWidth = nodeKind === 'handler' ? 96 : 112
  const maxWidth = nodeKind === 'handler' ? 176 : 206
  const width = Math.max(minWidth, Math.min(maxWidth, 26 + (label.length * 7)))
  const height = nodeKind === 'handler' ? 54 : 50

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

function applyNextVGraphRuntimeVisuals() {
  for (const [nodeName, nodeElement] of nextVGraphState.nodeElements.entries()) {
    const isActive = nextVGraphState.runtimeActiveNodes.has(nodeName)
    const hasWarning = nextVGraphState.runtimeWarningNodes.has(nodeName)
    const isExternal = nextVGraphState.runtimeExternalNodes.has(nodeName)
    const isTriggeredExternal = nextVGraphState.runtimeTriggeredExternalNodes.has(nodeName)
    const stepValue = nextVGraphState.runtimeStepByNode.get(nodeName)
    const stepLabel = nextVGraphState.stepLabelElements.get(nodeName)

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

function markNextVGraphNodeActive(nodeName) {
  const normalizedNode = String(nodeName ?? '').trim()
  if (!normalizedNode) return
  nextVGraphState.runtimeActiveNodes.clear()
  nextVGraphState.runtimeActiveNodes.add(normalizedNode)
  applyNextVGraphRuntimeVisuals()
}

function markNextVGraphEdgeActive(from, to) {
  const edgeKey = getNextVGraphEdgeKey(from, to)
  if (!edgeKey || !nextVGraphState.edgeElements.has(edgeKey)) return

  nextVGraphState.runtimeVisitedEdges.add(edgeKey)
  nextVGraphState.runtimeActiveEdges.clear()
  nextVGraphState.runtimeActiveEdges.add(edgeKey)
  applyNextVGraphRuntimeVisuals()
}

function markNextVGraphEffectEdgeActive(sourceNode, effectType, effectName) {
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

function resolveNextVGraphEffectEdgeKey(sourceNode, effectType, effectName) {
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

function updateNextVGraphRuntimeStep(nodeName) {
  const normalizedNode = String(nodeName ?? '').trim()
  if (!normalizedNode) return

  if (!nextVGraphState.runtimeStepByNode.has(normalizedNode)) {
    nextVGraphState.runtimeSequence += 1
    nextVGraphState.runtimeStepByNode.set(normalizedNode, nextVGraphState.runtimeSequence)
  }
}

function inferNextVGraphFallbackHandler(eventType) {
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

function markNextVGraphRuntimeWarning(nodeName) {
  const normalizedNode = String(nodeName ?? '').trim()
  if (!normalizedNode) return
  nextVGraphState.runtimeWarningNodes.add(normalizedNode)
  applyNextVGraphRuntimeVisuals()
}

function inferNextVGraphNodeFromWarning(runtimeEvent) {
  const explicitSignalType = String(runtimeEvent?.signalType ?? '').trim()
  if (explicitSignalType) return explicitSignalType
  return String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
}

function handleNextVGraphRuntimeEvent(runtimeEvent) {
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
    flashNextVGraphEventValue(signalType, runtimeEvent.value, { nodeId: handlerId })
    if (nextVGraphState.autoFollowEnabled && typeof nextVGraphState.setSelectedGraphNodeFn === 'function') {
      nextVGraphState.setSelectedGraphNodeFn(handlerId)
    }
    return
  }

  if (runtimeEvent.type === 'output') {
    const currentNode = String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
    const format = String(runtimeEvent.format ?? '').trim()
    if (currentNode && format) {
      markNextVGraphEffectEdgeActive(currentNode, 'output', format)
      const edgeKey = resolveNextVGraphEffectEdgeKey(currentNode, 'output', format)
      flashNextVGraphEdgeValue(edgeKey, runtimeEvent.value ?? runtimeEvent.content)
    }
    return
  }

  if (runtimeEvent.type === 'tool_call' || runtimeEvent.type === 'tool_result') {
    const currentNode = String(nextVGraphState.runtimeLastDispatchedNode ?? '').trim()
    const toolName = String(runtimeEvent.tool ?? '').trim()
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
function buildSmoothPath(points) {
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

function buildNextVGraphLayout(graphNodes, options = {}) {
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

function renderNextVGraph(data = {}, options = {}) {
  const { preserveViewport = false, viewportState = null } = options
  if (!nextVGraphOutput) return
  const layoutDirection = normalizeNextVGraphDirection(nextVGraphState.layoutDirection)

  const nodes = Array.isArray(data.nodes) ? data.nodes : []
  const edges = Array.isArray(data.edges) ? data.edges : []
  const cycles = Array.isArray(data.cycles) ? data.cycles : []
  const ignoredDynamicEmits = Array.isArray(data.ignoredDynamicEmits) ? data.ignoredDynamicEmits : []
  const transitions = Array.isArray(data.transitions) ? data.transitions : []
  const contractWarnings = Array.isArray(data.contractWarnings) ? data.contractWarnings : []
  const declaredExternals = Array.isArray(data.declaredExternals) ? data.declaredExternals : []
  const entrypointPath = String(data.entrypointPath ?? '')
  const transitionByEvent = new Map(transitions.map((transition) => [String(transition.eventType ?? ''), transition]))
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

  // Timer nodes sourced from host config: each drives the corresponding event node.
  const rawTimerNodes = Array.isArray(data.timerNodes) ? data.timerNodes : []
  const timerEdges = rawTimerNodes
    .filter((tn) => nodes.some((n) => n.id === tn.eventType))
    .map((tn) => ({ from: tn.id, to: tn.eventType, type: 'fires' }))

  // Unified graph node objects: data nodes (event/handler) + effect nodes + timer nodes.
  const graphNodes = [...nodes, ...effectNodes, ...rawTimerNodes]
  // Unified edge objects: data edges + effect edges + timer fires edges.
  const graphEdges = [...edges, ...effectEdges, ...timerEdges]

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
  nextVGraphState.cycles = cycles
  nextVGraphState.entrypointPath = entrypointPath
  nextVGraphState.ignoredDynamicEmits = ignoredDynamicEmits
  nextVGraphState.transitions = transitions
  nextVGraphState.nodeElements = new Map()
  nextVGraphState.edgeElements = new Map()
  nextVGraphState.stepLabelElements = new Map()

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
    const effectMeta = isEffectNode ? effectNodeById.get(normalizedNodeId) : null
    const transitionEventType = isHandlerNode
      ? String(nodeObj.eventType ?? '')
      : isEffectNode
        ? String(effectMeta?.sourceEvent ?? '')
        : String(nodeObj.eventType ?? nodeObj.id)
    const transition = transitionByEvent.get(transitionEventType)
    const transitionClass = getTransitionClassName(
      isEffectNode ? 'side_effect' : transition?.classification
    )

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
      : isHandlerNode
        ? String(nodeObj.eventType ?? normalizedNodeId)
        : String(nodeObj.eventType ?? normalizedNodeId)
    eventName.textContent = label

    const badge = document.createElement('span')
    badge.className = `nextv-graph-chip ${transitionClass}`
    badge.textContent = formatTransitionClassification(isEffectNode ? 'side_effect' : transition?.classification)

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
    }

    if (isEffectNode) {
      addLine(`effect source: ${String(effectMeta?.sourceEvent ?? '(unknown)')}`)
    }

    if (!detailRow.childNodes.length) {
      addLine('No additional transition metadata.')
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
  autoFollowLabel.title = 'Auto-select active handler node during runtime'
  const autoFollowCheckbox = document.createElement('input')
  autoFollowCheckbox.type = 'checkbox'
  autoFollowCheckbox.checked = nextVGraphState.autoFollowEnabled
  autoFollowCheckbox.addEventListener('change', () => {
    nextVGraphState.autoFollowEnabled = autoFollowCheckbox.checked
  })
  autoFollowLabel.appendChild(autoFollowCheckbox)
  autoFollowLabel.appendChild(document.createTextNode('auto-follow'))

  toolbar.appendChild(layoutLrBtn)
  toolbar.appendChild(layoutTbBtn)
  toolbar.appendChild(zoomOutBtn)
  toolbar.appendChild(zoomInBtn)
  toolbar.appendChild(resetBtn)
  toolbar.appendChild(zoomLabel)
  toolbar.appendChild(hint)
  toolbar.appendChild(autoFollowLabel)
  wrap.appendChild(toolbar)

  const meta = document.createElement('div')
  meta.className = 'nextv-graph-meta nextv-graph-toolbar-meta'
  const cycleLabel = cycles.length === 1 ? '1 cycle' : `${cycles.length} cycles`
  const mixedCount = transitions.filter((transition) => transition?.classification === 'mixed').length
  const effectCount = effectNodes.length
  const handlerCount = nodes.filter((n) => n.kind === 'handler').length
  const timerCount = rawTimerNodes.length
  const entrypointLabel = pathBasename(entrypointPath) || 'entrypoint'
  meta.textContent = `${entrypointLabel} • ${handlerCount} handlers • ${edges.length} edges${timerCount ? ` • ${timerCount} timers` : ''}${effectCount ? ` • ${effectCount} effects` : ''}${cycles.length ? ` • ${cycleLabel}` : ''}${mixedCount ? ` • ${mixedCount} mixed` : ''}`
  toolbar.appendChild(meta)

  if (transitions.length > 0) {
    const legend = document.createElement('div')
    legend.className = 'nextv-graph-legend'
    appendTransitionChip(legend, 'pure', 'pure')
    appendTransitionChip(legend, 'llm', 'llm')
    appendTransitionChip(legend, 'side effect', 'side_effect')
    appendTransitionChip(legend, 'mixed', 'mixed')
    wrap.appendChild(legend)
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

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  arrow.setAttribute('id', 'nextv-graph-arrow')
  arrow.setAttribute('markerWidth', '8')
  arrow.setAttribute('markerHeight', '8')
  arrow.setAttribute('refX', '7')
  arrow.setAttribute('refY', '4')
  arrow.setAttribute('orient', 'auto')
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  arrowPath.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z')
  arrowPath.setAttribute('fill', '#5f89a7')
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
  cycleArrowPath.setAttribute('fill', '#f44747')
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
  activeArrowPath.setAttribute('fill', '#9cdcfe')
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

  for (const edge of graphEdges) {
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
    const classification = fromEffectNode
      ? 'side_effect'
      : edgeType === 'subscription'
        ? 'subscription'
        : edgeType === 'fires'
          ? 'timer-fires'
          : getTransitionClassName(fromTransition?.classification)
    const hasWarnings = edgeType !== 'subscription' && Array.isArray(fromTransition?.warnings) && fromTransition.warnings.length > 0
    const edgeClass = `nextv-graph-edge ${classification}${isCycleEdge ? ' cycle' : ''}${hasWarnings ? ' warning' : ''}`
    const edgeKey = getNextVGraphEdgeKey(from, to)

    // Determine node radii for endpoint clipping.
    const toNode = graphNodes.find((n) => n.id === to)
    const toEffectLabel = toNode?.kind === 'effect' ? String(effectNodeById.get(to)?.label ?? '') : ''
    const toRadius = toNode ? getNextVGraphNodeVisual(toNode, toEffectLabel).edgeClip : 24
    const fromNodeObj = graphNodes.find((n) => n.id === from)
    const fromEffectLabel = fromNodeObj?.kind === 'effect' ? String(effectNodeById.get(from)?.label ?? '') : ''
    const fromRadius = fromNodeObj ? getNextVGraphNodeVisual(fromNodeObj, fromEffectLabel).edgeClip : 24

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
      nextVGraphState.edgeElements.set(edgeKey, path)
      svg.appendChild(path)
      continue
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
      nextVGraphState.edgeElements.set(edgeKey, pathEl)
      svg.appendChild(pathEl)
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
    nextVGraphState.edgeElements.set(edgeKey, line)
    svg.appendChild(line)
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

    const effectMeta = isEffectNode ? effectNodeById.get(nodeId) : null
    const transition = isHandlerNode ? transitionByEvent.get(nodeObj.eventType) : null
    const classification = isEffectNode
      ? 'side_effect'
      : isHandlerNode
        ? getTransitionClassName(transition?.classification)
        : '' // event and timer nodes carry no classification color

    const hasWarnings = isHandlerNode && Array.isArray(transition?.warnings) && transition.warnings.length > 0
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
      isExternal ? 'external' : '',
      isDeclaredExternal ? 'declared-external' : '',
      hasContractWarnings ? 'contract-warning' : '',
    ].filter(Boolean).join(' ')
    group.setAttribute('class', classStr)
    group.dataset.nodeId = nodeId
    if (nodeObj.eventType) group.dataset.eventType = nodeObj.eventType

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    const label = isEffectNode ? String(effectMeta?.label ?? nodeId) : (nodeObj.eventType ?? nodeId)
    const visual = getNextVGraphNodeVisual(nodeObj, isEffectNode ? String(effectMeta?.label ?? '') : '')
    const titleParts = [label]
    if (isHandlerNode) titleParts[0] = `handler: ${nodeObj.eventType}`
    if (isTimerNode) titleParts[0] = `timer: ${nodeObj.eventType}`
    if (isTimerNode && nodeObj.interval) titleParts.push(`interval=${nodeObj.interval}ms`)
    if (isTimerNode && nodeObj.runOnStart) titleParts.push('runOnStart=true')
    if (isExternal) titleParts.push('external=true')
    if (isDeclaredExternal) titleParts.push('declared-external=true')
    if (hasContractWarnings) titleParts.push(`contract-warnings=${nodeContractWarnings.map((cw) => cw.code).join(', ')}`)
    if (transition?.classification && isHandlerNode) titleParts.push(`type=${formatTransitionClassification(transition.classification)}`)
    if (emittedEvents.length > 0) titleParts.push(`emits=${emittedEvents.join(', ')}`)
    if (emittedEffects.length > 0) titleParts.push(`effects=${emittedEffects.join(', ')}`)
    if (Array.isArray(transition?.outputs) && transition.outputs.length > 0) titleParts.push(`outputs=${transition.outputs.join(', ')}`)
    if (Array.isArray(transition?.tools) && transition.tools.length > 0) titleParts.push(`tools=${transition.tools.map((tool) => tool.name || 'dynamic').join(', ')}`)
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
    text.textContent = isEffectNode ? String(effectMeta?.label ?? nodeId) : (nodeObj.eventType ?? nodeId)
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
      const warningTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      warningTag.setAttribute('x', String(pos.x + visual.badgeOffsetX))
      warningTag.setAttribute('y', String(pos.y + visual.badgeOffsetY))
      warningTag.setAttribute('class', 'nextv-graph-node-warning')
      warningTag.textContent = '!'
      group.appendChild(warningTag)
    }

    if (isEventNode && hasContractWarnings) {
      const contractTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      contractTag.setAttribute('x', String(pos.x - visual.badgeOffsetX))
      contractTag.setAttribute('y', String(pos.y + visual.badgeOffsetY))
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

async function refreshNextVGraph(options = {}) {
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

function appendNextVLogRow(line, cls = '') {
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
    appendPanelLogRow(nextVEventsOutput, line, 'result')
    return
  }

  appendPanelLogRow(nextVEventsOutput, line, cls)
}

function extractErrorLineNumber(raw) {
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

function normalizeErrorSourcePath(raw) {
  return String(raw ?? '').trim().replace(/\\/g, '/')
}

function extractErrorSourcePath(raw) {
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

function formatErrorMessageWithSource(message, line, sourcePath) {
  const text = String(message ?? 'runtime error').trim() || 'runtime error'
  const lineNumber = Number(line)
  const normalizedSourcePath = normalizeErrorSourcePath(sourcePath)
  const hasLine = Number.isFinite(lineNumber) && lineNumber > 0

  if (normalizedSourcePath && /\bfile\s*=\s*[^\s]+/i.test(text)) {
    return text
  }
  if (!normalizedSourcePath && !hasLine) {
    return text
  }
  if (!normalizedSourcePath && (/\bline\s*=\s*\d+\b/i.test(text) || /\bline\s+\d+\b/i.test(text) || /\bat\s+line\s+\d+\b/i.test(text))) {
    return text
  }

  const parts = []
  if (normalizedSourcePath) {
    parts.push(`file=${normalizedSourcePath}`)
  }
  if (hasLine) {
    parts.push(`line=${lineNumber}`)
  }

  return `${parts.join(' ')} ${text}`
}

function getErrorMessageAndSource(payloadLike, fallbackMessage = 'runtime error') {
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

function appendNextVErrorLog(payloadLike, prefix = '[nextv:error]') {
  const { message, line, sourcePath } = getErrorMessageAndSource(payloadLike)
  appendNextVLogRow(`${prefix} ${formatErrorMessageWithSource(message, line, sourcePath)}`, 'error')
}

function normalizeRelativePath(pathValue) {
  return String(pathValue ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function normalizeNextVWorkspaceDir(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized || normalized === '.') return ''
  return normalized
}

function resolveNextVPath(pathValue) {
  const pathPart = normalizeRelativePath(pathValue)
  if (!pathPart) return ''

  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!workspaceDir || workspaceDir === '.') return pathPart
  if (pathPart === workspaceDir || pathPart.startsWith(`${workspaceDir}/`)) {
    return pathPart
  }
  return `${workspaceDir}/${pathPart}`
}

function normalizePathSegments(pathValue) {
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

function pathDirname(pathValue) {
  const normalized = normalizeRelativePath(pathValue)
  if (!normalized || !normalized.includes('/')) return ''
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

function joinRelativePath(basePath, childPath) {
  return normalizePathSegments([basePath, childPath].filter(Boolean).join('/'))
}

function toNextVRelativePath(workspacePath) {
  const normalizedPath = normalizeRelativePath(workspacePath)
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (!normalizedPath) return ''
  if (!workspaceDir) return normalizedPath
  if (!normalizedPath.startsWith(`${workspaceDir}/`)) return normalizedPath
  return normalizedPath.slice(workspaceDir.length + 1)
}

function updateOpenFileLabel(filePath = '') {
  if (!scriptOpenFileLabel) return
  const normalized = normalizeRelativePath(filePath)
  scriptOpenFileLabel.textContent = normalized || 'no file open'
  scriptOpenFileLabel.title = normalized || 'no file open'
}

function ensureOpenFileTab(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return
  if (!nextVFileState.openTabs.includes(normalized)) {
    nextVFileState.openTabs.push(normalized)
  }
}

function removeOpenFileTab(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return
  nextVFileState.openTabs = nextVFileState.openTabs.filter((path) => path !== normalized)
}

async function closeOpenFileTab(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return

  if (scriptEditorState.dirty && normalizeRelativePath(scriptEditorState.path) === normalized) {
    await saveCurrentEditorFile({ silent: true })
  }

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
      return
    }

    clearScriptView()
    persistNextVOpenFile('')
    renderWorkspaceTree()
  }

  renderOpenFileTabs()
}

function renderOpenFileTabs() {
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
  const fragment = document.createDocumentFragment()

  for (const tabPath of nextVFileState.openTabs) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = `open-file-tab${tabPath === activePath ? ' active' : ''}`
    tab.title = tabPath

    const tabName = document.createElement('span')
    tabName.className = 'open-file-tab-name'
    const basename = pathBasename(tabPath)
    const isCurrentDirty = tabPath === activePath && scriptEditorState.dirty
    const isStashedDirty = tabPath !== activePath && dirtyEditsCache.has(tabPath)
    tabName.textContent = (isCurrentDirty || isStashedDirty) ? `${basename} *` : basename
    tab.appendChild(tabName)

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
      if (normalizeRelativePath(scriptEditorState.path) === tabPath) return
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
}

function persistNextVOpenFile(filePath = '') {
  const normalized = normalizeRelativePath(filePath)
  nextVFileState.openFilePath = normalized
  if (normalized) ensureOpenFileTab(normalized)
  if (normalized) localStorage.setItem(storageKeys.nextVOpenFile, normalized)
  else localStorage.removeItem(storageKeys.nextVOpenFile)
  updateOpenFileLabel(normalized)
  renderOpenFileTabs()
}

function getStoredNextVOpenFile() {
  return normalizeRelativePath(localStorage.getItem(storageKeys.nextVOpenFile) ?? '')
}

function clearNextVAutoSaveTimer() {
  if (!nextVFileState.autoSaveTimer) return
  window.clearTimeout(nextVFileState.autoSaveTimer)
  nextVFileState.autoSaveTimer = null
}

function rememberExpandedPath(filePath) {
  const normalized = normalizeRelativePath(filePath)
  if (!normalized) return
  const segments = normalized.split('/')
  let current = ''
  for (let index = 0; index < segments.length - 1; index++) {
    current = current ? `${current}/${segments[index]}` : segments[index]
    nextVFileState.expandedDirs.add(current)
  }
}

function getTreeNodeIcon(node, expanded = false) {
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

function initFileTreeCtxMenu() {
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

function showFileTreeCtxMenu(event, path, type) {
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

function hideFileTreeCtxMenu() {
  if (ctxMenu.el) ctxMenu.el.style.display = 'none'
  ctxMenu.targetPath = null
  ctxMenu.targetType = null
}

function clearDeleteConfirmTimers() {
  if (deleteConfirmTimeoutId != null) {
    window.clearTimeout(deleteConfirmTimeoutId)
    deleteConfirmTimeoutId = null
  }
  if (deleteConfirmTickerId != null) {
    window.clearInterval(deleteConfirmTickerId)
    deleteConfirmTickerId = null
  }
}

function hideDeleteConfirmModal() {
  clearDeleteConfirmTimers()
  if (filetreeDeleteConfirm) {
    filetreeDeleteConfirm.style.display = 'none'
  }
}

function resolvePendingDeleteConfirm(confirmed) {
  const resolver = pendingDeleteConfirmResolver
  pendingDeleteConfirmResolver = null
  hideDeleteConfirmModal()
  if (resolver) resolver(Boolean(confirmed))
}

function updateDeleteConfirmTimer(endAtMs) {
  if (!filetreeDeleteTimer) return
  const remainingMs = Math.max(0, endAtMs - Date.now())
  filetreeDeleteTimer.textContent = (remainingMs / 1000).toFixed(1)
}

function buildDeleteConfirmDescription(type, targetPath) {
  const pathText = String(targetPath ?? '').trim() || '(unknown path)'
  if (type === 'dir') {
    return `Delete folder "${pathText}" and all contents?`
  }
  return `Delete file "${pathText}"?`
}

function requestTimedDeleteConfirm(type, targetPath) {
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
    pendingDeleteConfirmResolver = resolve
    deleteConfirmTickerId = window.setInterval(() => {
      updateDeleteConfirmTimer(endAtMs)
    }, 100)
    deleteConfirmTimeoutId = window.setTimeout(() => {
      resolvePendingDeleteConfirm(false)
      setStatus('delete cancelled (timeout)', 'responding')
    }, timeoutMs)
  })
}

function onDeleteConfirmApprove() {
  if (!pendingDeleteConfirmResolver) return
  resolvePendingDeleteConfirm(true)
}

function onDeleteConfirmCancel() {
  if (!pendingDeleteConfirmResolver) {
    hideDeleteConfirmModal()
    return
  }
  resolvePendingDeleteConfirm(false)
  setStatus('delete cancelled')
}

function getCtxMenuParentPath() {
  if (ctxMenu.targetType === 'dir') {
    return normalizeRelativePath(ctxMenu.targetPath)
  }
  if (ctxMenu.targetType === 'file') {
    return pathDirname(ctxMenu.targetPath)
  }
  return ''
}

function ctxMenuNewFile() {
  const parentPath = getCtxMenuParentPath()
  hideFileTreeCtxMenu()
  showInlineNameInput(parentPath, 'file')
}

function ctxMenuNewFolder() {
  const parentPath = getCtxMenuParentPath()
  hideFileTreeCtxMenu()
  showInlineNameInput(parentPath, 'dir')
}

async function ctxMenuRename() {
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

async function ctxMenuDelete() {
  const path = ctxMenu.targetPath
  const type = ctxMenu.targetType
  hideFileTreeCtxMenu()
  if (!path) return
  if (type === 'file') await doDeleteFile(path)
  else if (type === 'dir') await doDeleteFolder(path)
}

// --- Inline name input ---

function showInlineNameInput(parentFolderPath, kind) {
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

async function doCreateFile(parentFolderPath, name, fullPath) {
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

async function doCreateFolder(parentFolderPath, name, fullPath) {
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

async function doDeleteFile(filePath) {
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

async function doDeleteFolder(folderPath) {
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

function remapPathPrefix(pathValue, fromPrefix, toPrefix) {
  const normalizedPath = normalizeRelativePath(pathValue)
  const from = normalizeRelativePath(fromPrefix)
  const to = normalizeRelativePath(toPrefix)
  if (!normalizedPath || !from || !to) return normalizedPath
  if (normalizedPath === from) return to
  if (!normalizedPath.startsWith(`${from}/`)) return normalizedPath
  return `${to}${normalizedPath.slice(from.length)}`
}

function remapMapKeysByPrefix(mapRef, fromPrefix, toPrefix) {
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

function remapEditorStatePaths(oldPath, newPath) {
  const oldNormalized = normalizeRelativePath(oldPath)
  const newNormalized = normalizeRelativePath(newPath)
  if (!oldNormalized || !newNormalized) return

  nextVFileState.openTabs = nextVFileState.openTabs.map((path) => remapPathPrefix(path, oldNormalized, newNormalized))
  nextVFileState.openFilePath = remapPathPrefix(nextVFileState.openFilePath, oldNormalized, newNormalized)
  scriptEditorState.path = remapPathPrefix(scriptEditorState.path, oldNormalized, newNormalized)

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

async function doRenameFile(filePath, newName) {
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

async function doRenameFolder(folderPath, newName) {
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

function renderFileTreeNode(node) {
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
      await openWorkspaceEditorFile(node.path)
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

function renderWorkspaceTree() {
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

function inferEditorKind() {
  return 'editor'
}

async function loadEditorFileContent(filePath, options = {}) {
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

async function loadWorkspaceTree(workspaceDir) {
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

async function saveCurrentEditorFile(options = {}) {
  const silent = options.silent === true
  const explicitPath = normalizeRelativePath(options.explicitPath)
  const fallbackEntrypoint = resolveNextVPath(nextVEntrypointInput?.value)
  const filePath = explicitPath || normalizeRelativePath(scriptEditorState.path) || fallbackEntrypoint

  if (!filePath) {
    if (!silent) setStatus('file path required to save', 'responding')
    return false
  }

  const content = getScriptEditorText()
  const { savedPath, bytes } = await saveEditorFileContent(filePath, content)
  scriptEditorState.path = savedPath
  scriptEditorState.loadedText = content
  scriptEditorState.dirty = false
  dirtyEditsCache.delete(savedPath)
  persistNextVOpenFile(savedPath)
  syncScriptBadgeState()
  renderWorkspaceTree()

  if (!silent) {
    appendScriptLogRow(`[file:save] path=${savedPath} bytes=${bytes}`, 'result')
    setStatus('file saved')
  }

  return true
}

async function saveEditorFileContent(filePath, content) {
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
  scriptCache.set(savedPath, payload.split('\n'))
  return { savedPath, bytes: data.bytes ?? 0 }
}

async function saveAllNextVFiles(options = {}) {
  const silent = options.silent === true
  const activePath = normalizeRelativePath(scriptEditorState.path)
  const failed = []
  let savedCount = 0

  for (const tabPath of nextVFileState.openTabs) {
    const normalizedTabPath = normalizeRelativePath(tabPath)
    if (!normalizedTabPath) continue

    let content = null
    if (normalizedTabPath === activePath && scriptEditorState.dirty) {
      content = getScriptEditorText()
    } else {
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

      if (normalizedTabPath === activePath) {
        scriptEditorState.path = savedPath
        scriptEditorState.loadedText = content
        scriptEditorState.dirty = false
        persistNextVOpenFile(savedPath)
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

function scheduleNextVAutoSave() {
  if (!isNextVMode()) return
  if (nextVAutoSaveInput?.checked === false) {
    clearNextVAutoSaveTimer()
    return
  }
  const hasActiveDirty = Boolean(scriptEditorState.path && scriptEditorState.dirty)
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

async function openWorkspaceEditorFile(filePath, options = {}) {
  let normalizedPath = normalizeRelativePath(filePath)
  if (!normalizedPath) return

  const leavingPath = scriptEditorState.path ? normalizeRelativePath(scriptEditorState.path) : ''
  if (scriptEditorState.dirty && leavingPath && leavingPath !== normalizedPath) {
    if (nextVAutoSaveInput?.checked === false) {
      dirtyEditsCache.set(leavingPath, {
        content: getScriptEditorText(),
        loadedText: scriptEditorState.loadedText,
      })
    } else {
      await saveCurrentEditorFile({ silent: true })
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

  scriptView.value = text
  scriptEditorState.path = normalizedPath
  scriptEditorState.loadedText = loadedText
  scriptEditorState.dirty = isDirty
  activeScriptLine = null
  rememberExpandedPath(scriptEditorState.path)
  persistNextVOpenFile(scriptEditorState.path)
  renderScriptMirror(text)
  syncScriptBadgeState()
  renderWorkspaceTree()
}

function refreshNextVWorkspaceTree() {
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

function setOpenFileAsNextVEntrypoint() {
  const openFilePath = normalizeRelativePath(scriptEditorState.path)
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

function persistNextVConfig() {
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const entrypointPath = normalizeRelativePath(nextVEntrypointInput?.value ?? '')
  const autoSaveEnabled = nextVAutoSaveInput?.checked !== false
  const graphDirection = normalizeNextVGraphDirection(nextVGraphState.layoutDirection)

  localStorage.setItem(storageKeys.nextVWorkspaceDir, workspaceDir)
  localStorage.setItem(storageKeys.nextVEntrypoint, entrypointPath)
  localStorage.setItem(storageKeys.nextVAutoSave, autoSaveEnabled ? '1' : '0')
  localStorage.setItem(storageKeys.nextVGraphDirection, graphDirection)
}

function restoreNextVConfig() {
  const workspaceDir = normalizeNextVWorkspaceDir(localStorage.getItem(storageKeys.nextVWorkspaceDir) ?? '')
  const entrypointPath = normalizeRelativePath(localStorage.getItem(storageKeys.nextVEntrypoint) ?? '')
  const storedPrimaryView = localStorage.getItem(storageKeys.nextVPrimaryView)
  const primaryView = storedPrimaryView === 'graph' ? 'graph' : 'editor'
  const storedAutoSave = localStorage.getItem(storageKeys.nextVAutoSave)
  const autoSaveEnabled = storedAutoSave == null ? false : storedAutoSave === '1'
  const storedDevTab = localStorage.getItem(storageKeys.nextVDevTab)
  const devTab = ['events', 'trace', 'console'].includes(storedDevTab) ? storedDevTab : 'events'
  const devConsoleOpen = localStorage.getItem(storageKeys.nextVDevConsoleOpen) !== '0'
  const graphDirection = normalizeNextVGraphDirection(localStorage.getItem(storageKeys.nextVGraphDirection) ?? 'TB')

  if (nextVWorkspaceDirInput) nextVWorkspaceDirInput.value = workspaceDir
  if (nextVEntrypointInput) nextVEntrypointInput.value = entrypointPath
  if (nextVAutoSaveInput) nextVAutoSaveInput.checked = autoSaveEnabled
  tracePanelState.currentTab = devTab
  nextVViewState.currentView = primaryView
  nextVPanelState.devConsoleOpen = devConsoleOpen
  nextVGraphState.layoutDirection = graphDirection
}

function pathBasename(p) {
  return String(p ?? '').replace(/\\/g, '/').split('/').pop() || String(p ?? '')
}

function formatNextVStartLine(entrypointPath, runtimeStatePath, baselineStatePath) {
  const entry = pathBasename(entrypointPath) || '(unknown)'
  const runtimeRaw = String(runtimeStatePath ?? '').trim()
  const runtime = runtimeRaw === 'in-memory' ? 'in-memory' : (pathBasename(runtimeRaw) || '(in-memory)')
  const baseline = String(baselineStatePath ?? '').trim()
  if (!baseline) {
    return `[nextv:start] entrypoint=${entry} runtime=${runtime}`
  }
  return `[nextv:start] entrypoint=${entry} runtime=${runtime} baseline=${pathBasename(baseline)}`
}

function formatWorkspaceConfigStatus(config = {}) {
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

function formatCapabilityStatus(summary = {}, effects = {}) {
  const required = Number(summary.required ?? 0)
  const unsupported = Number(summary.unsupportedBindings ?? 0)
  const declaredEffects = Number(effects.declared ?? 0)
  const unsupportedEffects = Number(effects.unsupportedBindings ?? 0)
  const policy = String(effects.policy ?? 'warn')
  return `[nextv:capabilities] required=${required} unsupported=${unsupported} effects=${declaredEffects} effectUnsupported=${unsupportedEffects} policy=${policy}`
}

function formatHostModulesStatus(hostModules = {}) {
  const toolProviders = Number(hostModules.toolProviders ?? 0)
  const ingressConnectors = Number(hostModules.ingressConnectors ?? 0)
  const effectRealizers = Number(hostModules.effectRealizers ?? 0)
  const workspaceDir = String(hostModules.workspaceDir ?? '').trim() || '.'
  return `[nextv:host-modules] tools=${toolProviders} ingress=${ingressConnectors} effects=${effectRealizers} workspace=${workspaceDir}`
}

function toPrettyJson(value) {
  if (value === undefined) return '(none)'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isObjectRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function safeJsonByteSize(value) {
  try {
    const encoded = JSON.stringify(value)
    return typeof encoded === 'string' ? encoded.length : 0
  } catch {
    return 0
  }
}

function formatPayloadByteSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0B'
  if (value < 1024) return `${Math.round(value)}B`
  if (value < (1024 * 1024)) return `${(value / 1024).toFixed(1)}kb`
  return `${(value / (1024 * 1024)).toFixed(1)}mb`
}

function summarizeToolCallArgs(args) {
  const positional = Array.isArray(args?.positional) ? args.positional : []
  const named = isObjectRecord(args?.named) ? args.named : {}
  const positionalCount = positional.length
  const namedCount = Object.keys(named).length
  const totalCount = positionalCount + namedCount
  const sizeLabel = formatPayloadByteSize(safeJsonByteSize(args))
  return `args=${totalCount} (${positionalCount}p/${namedCount}n) size=${sizeLabel}`
}

function summarizeToolResultPayload(result) {
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

function flattenStatePaths(value, basePath = '', out = new Map()) {
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

function buildStateDiff(previousState, nextState) {
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

function formatStateDiff(changes) {
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

function normalizeNextVStateFilterQuery(value) {
  return String(value ?? '').trim().toLowerCase()
}

function formatStateSectionMeta(value) {
  if (Array.isArray(value)) return `${value.length} items`
  if (isObjectRecord(value)) return `${Object.keys(value).length} keys`
  if (typeof value === 'string') return `${value.length} chars`
  if (value === null) return 'null'
  return typeof value
}

function isNextVStateTreeContainer(value) {
  return Array.isArray(value) || isObjectRecord(value)
}

function formatNextVStateLeafPreview(value) {
  if (typeof value === 'string') {
    const compact = value.length > 120 ? `${value.slice(0, 117)}...` : value
    return JSON.stringify(compact)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }
  return toPrettyJson(value)
}

function createNextVStateTreeNode(label, value, options = {}) {
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

function matchesNextVStateFilter(element, query) {
  if (!query) return true
  return String(element?.dataset?.searchText ?? '').includes(query)
}

function applyNextVStateSearchFilter() {
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

function setNextVStateFilter(value, options = {}) {
  const { persist = true } = options
  nextVStateFilterQuery = normalizeNextVStateFilterQuery(value)
  if (nextVStateFilterInput && nextVStateFilterInput.value !== value) {
    nextVStateFilterInput.value = String(value ?? '')
  }
  applyNextVStateSearchFilter()
  if (persist) {
    localStorage.setItem(storageKeys.nextVStateFilter, String(value ?? ''))
  }
}

function initNextVStatePanelTools() {
  const stored = localStorage.getItem(storageKeys.nextVStateFilter) ?? ''
  setNextVStateFilter(stored, { persist: false })

  if (!nextVStateFilterInput || nextVStateFilterInput.dataset.bound === '1') return
  nextVStateFilterInput.dataset.bound = '1'
  nextVStateFilterInput.addEventListener('input', (event) => {
    setNextVStateFilter(event.target?.value ?? '')
  })
}

function setNextVStateCollapseAll(collapsed) {
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

function clearNextVStateDiff() {
  if (nextVStateDiffFeed) nextVStateDiffFeed.innerHTML = ''
}

function clampNextVStateDiffWidth(value) {
  const numeric = Number(value)
  const maxWidth = Math.max(300, Math.min(820, Math.round(window.innerWidth * 0.7)))
  if (!Number.isFinite(numeric)) return 260
  return Math.max(220, Math.min(maxWidth, Math.round(numeric)))
}

function persistNextVStateDiffWidth(width) {
  localStorage.setItem(storageKeys.nextVStateDiffWidth, String(clampNextVStateDiffWidth(width)))
}

function getStoredNextVStateDiffWidth() {
  const stored = Number(localStorage.getItem(storageKeys.nextVStateDiffWidth))
  if (!Number.isFinite(stored)) return 260
  return clampNextVStateDiffWidth(stored)
}

function toggleNextVStateDiff() {
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

function initNextVStateDiffPanel() {
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

function setupNextVStateDiffSplitter() {
  if (!nextVStateDiffSplitter || !nextVStateDiffPanel || !nextVGraphShell) return

  const applyStateDiffWidth = (pixels) => {
    const clamped = clampNextVStateDiffWidth(pixels)
    nextVStateDiffPanel.style.width = `${clamped}px`
    persistNextVStateDiffWidth(clamped)
  }

  nextVStateDiffSplitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode() || nextVStateDiffPanel.classList.contains('collapsed')) return
    isStateDiffResizing = true
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
    isStateDiffResizing = false
    document.body.classList.remove('is-resizing-statediff')
  })
}

function initNextVUserIOPanel() {
  const stored = localStorage.getItem(storageKeys.nextVUserIOOpen)
  const shouldOpen = stored === '1'
  setUserIOPanelOpen(shouldOpen, { persist: false })
}

function setupNextVUserIOSplitter() {
  if (!nextVUserIOSplitter || !scriptEditorPanel || !nextVGraphShell) return

  const applyUserIOWidth = (pixels) => {
    const clamped = clampNextVUserIOWidth(pixels)
    scriptEditorPanel.style.width = `${clamped}px`
    persistNextVUserIOWidth(clamped)
  }

  nextVUserIOSplitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode() || !userIOPanelState.open) return
    isUserIOResizing = true
    document.body.classList.add('is-resizing-userio')
    event.preventDefault()
  })

  window.addEventListener('mousemove', (event) => {
    if (!isUserIOResizing) return
    const shellRect = nextVGraphShell.getBoundingClientRect()
    applyUserIOWidth(shellRect.right - event.clientX)
  })

  window.addEventListener('mouseup', () => {
    if (!isUserIOResizing) return
    isUserIOResizing = false
    document.body.classList.remove('is-resizing-userio')
  })
}

function appendNextVStateDiffEntry(signalType, changes) {
  if (!nextVStateDiffFeed) return

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

function buildTraceRow(event, previousState) {
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
  const rowId = `trace-${++traceRowCounter}`

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

function renderTraceDetail() {
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

function renderTraceList() {
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

function appendTraceRows(events) {
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

function clearTracePanel(options = {}) {
  const { silent = false } = options
  tracePanelState.rows = []
  tracePanelState.selectedId = ''
  renderTraceList()
  if (!silent) {
    setStatus('trace panel cleared')
  }
}

function renderCanonicalNextVEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return

  for (const event of events) {
    if (!event || typeof event !== 'object') continue

    if (event.type === 'output') {
      const format = String(event.format ?? 'text')
      if (format === 'text') {
        appendUserOutputMessage(String(event.content ?? ''))
      } else if (format === 'json') {
        const hasValue = Object.prototype.hasOwnProperty.call(event, 'value')
        const rawValue = hasValue ? event.value : parseMaybeJson(event.content)
        let formatted = String(event.content ?? '')
        if (rawValue !== null && rawValue !== undefined) {
          try {
            formatted = JSON.stringify(rawValue, null, 2)
          } catch {
            formatted = String(rawValue)
          }
        }
        appendUserOutputMessage(formatted)
      } else if (format === 'voice') {
        appendUserOutputVoice(event)
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

        appendUserOutputMessage(`[interaction] ${promptText}`)
        appendNextVLogRow('[nextv:interaction] request received (host policy decides follow-up)', 'step')
      }
      appendNextVLogRow(`[nextv:output] format=${format} content=${String(event.content ?? '')}`, 'content')
      continue
    }

    if (event.type === 'tool_call') {
      appendNextVLogRow(
        `[nextv:tool_call] tool=${String(event.tool ?? '')} ${summarizeToolCallArgs(event.args)}`,
        'step'
      )
      continue
    }

    if (event.type === 'tool_result') {
      appendNextVLogRow(
        `[nextv:tool_result] tool=${String(event.tool ?? '')} ${summarizeToolResultPayload(event.result)}`,
        'result'
      )
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

function renderNextVSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return
  const { log = false } = options
  nextVRuntimeRunning = snapshot.running === true
  setNextVRunControls()

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
  nextVLastKnownState = nextState
}

function closeNextVStream() {
  if (!nextVEventSource) return
  nextVEventSource.close()
  nextVEventSource = null
  nextVHasLiveRuntimeEvents = false
}

function openNextVStream() {
  closeNextVStream()
  nextVEventSource = new EventSource('/api/nextv/stream')

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
      nextVHasLiveRuntimeEvents = false
      resetNextVGraphRuntimeState({ keepExternalNodes: false })
      applyNextVGraphRuntimeVisuals()
      nextVLastKnownState = null
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

      nextVHasLiveRuntimeEvents = true
      handleNextVGraphRuntimeEvent(runtimeEvent)
      renderCanonicalNextVEvents([runtimeEvent])
      appendTraceRows([runtimeEvent])
      if (payload?.snapshot) renderNextVSnapshot(payload.snapshot)
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_execution', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const eventType = String(payload?.event?.type ?? '')
      const source = String(payload?.event?.source ?? '')
      const shouldRenderFromExecution = !nextVHasLiveRuntimeEvents
      if (eventType) {
        nextVGraphState.runtimeExternalNodes.add(eventType)
      }
      if (shouldRenderFromExecution && Array.isArray(payload?.events)) {
        for (const runtimeEvent of payload.events) {
          handleNextVGraphRuntimeEvent(runtimeEvent)
        }
      }
      if (shouldRenderFromExecution) {
        renderCanonicalNextVEvents(payload?.events)
        appendTraceRows(payload?.events)
      }
      if (eventType && nextVGraphState.runtimeSequence === 0) {
        const fallbackHandlerId = inferNextVGraphFallbackHandler(eventType) || `handler:${eventType}`
        updateNextVGraphRuntimeStep(fallbackHandlerId)
        nextVGraphState.runtimeLastDispatchedNode = fallbackHandlerId
        // Mark both the queued event node and the inferred active handler node.
        nextVGraphState.runtimeActiveNodes.add(eventType)
        nextVGraphState.runtimeActiveNodes.add(fallbackHandlerId)
      }
      applyNextVGraphRuntimeVisuals()
      fadeNextVGraphActiveHighlights(760)
      appendNextVLogRow(`[nextv:execution] type=${eventType} source=${source} steps=${Number(payload?.result?.steps ?? 0)}`, 'result')
      const diffBefore = nextVLastKnownState ?? {}
      const diffAfter = payload?.snapshot?.state ?? {}
      appendNextVStateDiffEntry(eventType, buildStateDiff(diffBefore, diffAfter))
      renderNextVSnapshot(payload.snapshot)
      nextVHasLiveRuntimeEvents = false
      setStatus('nextv execution complete')
    } catch {
      // ignore malformed stream payload
    }
  })

  nextVEventSource.addEventListener('nextv_event_queued', (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      const eventType = String(payload?.event?.type ?? '')
      const source = String(payload?.event?.source ?? '')
      beginNextVGraphExecutionTrail()
      flashNextVGraphExternalEvent(eventType)
      flashNextVGraphEventValue(eventType, payload?.event?.value, { nodeId: eventType })
      appendNextVLogRow(`[nextv:event] queued type=${eventType} source=${source}`, 'step')
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
      const payload = JSON.parse(evt.data)
      if (payload?.snapshot) renderNextVSnapshot(payload.snapshot)
      resetNextVGraphRuntimeState({ keepExternalNodes: true })
      applyNextVGraphRuntimeVisuals()
      nextVRuntimeRunning = false
      setNextVRunControls()
      appendNextVLogRow('[nextv:stop] runtime stopped', 'step')
      setStatus('nextv runtime stopped')
    } catch {
      nextVRuntimeRunning = false
      setNextVRunControls()
    }
  })
}

async function refreshNextVSnapshot() {
  try {
    const res = await fetch('/api/nextv/snapshot')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'unable to load nextv snapshot')
    }
    renderNextVSnapshot(data.snapshot, { log: true })
    setStatus('nextv snapshot updated')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv snapshot failed', 'responding')
  }
}

async function syncNextVRuntimeState() {
  try {
    const res = await fetch('/api/nextv/snapshot')
    const data = await res.json().catch(() => ({}))

    isRemoteMode = data?.remoteMode === true
    isRemoteControlMode = data?.remoteControl === true
    remoteTransport = String(data?.remoteTransport ?? (isRemoteControlMode ? 'ws' : (isRemoteMode ? 'mqtt' : 'local')))
    isRemoteRuntimeConnected = isRemoteControlMode
      ? (data?.remoteConnection?.connected === true)
      : true

    if (!res.ok) {
      nextVRuntimeRunning = false
      updateRemoteModeBadge()
      closeNextVStream()
      setNextVRunControls()
      return
    }
    updateRemoteModeBadge()
    renderNextVSnapshot(data.snapshot)
    if (isRemoteMode || data?.snapshot?.running === true) {
      openNextVStream()
    } else {
      closeNextVStream()
    }
    nextVRuntimeRunning = data?.running === true
    setNextVRunControls()
  } catch {
    nextVRuntimeRunning = false
    if (isRemoteControlMode) {
      isRemoteRuntimeConnected = false
    }
    updateRemoteModeBadge()
    closeNextVStream()
    setNextVRunControls()
  }
}

async function startNextVRuntime() {
  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  const entrypointPath = normalizeRelativePath(nextVEntrypointInput?.value ?? '')
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
    await ensureNextVEntrypointVisible({ logLoaded: true, warnOnDirty: true })
    const res = await fetch('/api/nextv/start', {
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

    nextVRuntimeRunning = true
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
    nextVLastKnownState = null
    clearNextVStateDiff()
    appendNextVStateDiffEntry('init', buildStateDiff({}, data?.snapshot?.state ?? {}))
    renderNextVSnapshot(data.snapshot)
    setStatus('nextv runtime started')
  } catch (err) {
    appendNextVErrorLog(err)
    setStatus('nextv start failed', 'responding')
  }
}

async function stopNextVRuntime() {
  try {
    const hadStream = Boolean(nextVEventSource)
    const res = await fetch('/api/nextv/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to stop nextv runtime')
    }

    nextVRuntimeRunning = false
    setNextVRunControls()
    closeNextVStream()
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

async function sendNextVEvent() {
  const value = String(nextVEventValueInput?.value ?? '')
  const eventType = String(nextVEventTypeInput?.value ?? '')
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

    const res = await fetch('/api/nextv/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? 'failed to enqueue nextv event')
    }

    if (!nextVEventSource) {
      appendNextVLogRow(`[nextv:event] queued type=${eventType} source=${source}`, 'step')
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

async function sendNextVIngress() {
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
    const res = await fetch('/api/nextv/ingress', {
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

function updateNextVEventImageUI() {
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
}

function readImageFileAsBase64(file) {
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

async function addNextVEventImages(filesLike) {
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
    updateNextVEventImageUI()
    setStatus(`${loaded.length} image${loaded.length === 1 ? '' : 's'} attached to nextv input`)
  } catch (err) {
    appendErrorRow(String(err?.message ?? err))
  }
}

function clearNextVEventImages(options = {}) {
  nextVInputImageState.entries = []
  if (nextVImageInput) nextVImageInput.value = ''
  updateNextVEventImageUI()
  if (!options.silent) {
    setStatus('nextv input images cleared')
  }
}

async function handleNextVImageInput(input) {
  const files = input?.files
  if (input) input.value = ''
  if (!files || files.length === 0) return
  await addNextVEventImages(files)
}

function setupNextVImageDropzone() {
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

function setLeftPanelWidth(percent) {
  const clamped = Math.max(25, Math.min(70, percent))
  document.documentElement.style.setProperty('--left-panel-width', `${clamped}%`)
  localStorage.setItem(storageKeys.leftWidth, String(clamped))
}

function setupSplitter() {
  if (!splitter || !workspace) return

  splitter.addEventListener('mousedown', (event) => {
    if ((!isScriptMode() && !isNextVMode()) || window.innerWidth <= 760) return
    isResizing = true
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
    isResizing = false
    document.body.classList.remove('is-resizing')
  })
}

function setupFileTreeSplitter() {
  if (!fileTreeSplitter || !fileTreePane || !scriptSection) return

  const applyTreeWidth = (pixels) => {
    const sectionRect = scriptSection.getBoundingClientRect()
    const clamped = Math.max(180, Math.min(sectionRect.width * 0.55, pixels))
    fileTreePane.style.flex = `0 0 ${clamped}px`
    localStorage.setItem(storageKeys.nextVTreeWidth, String(clamped))
  }

  fileTreeSplitter.addEventListener('mousedown', (event) => {
    if (!isNextVMode()) return
    isFileTreeResizing = true
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
    isFileTreeResizing = false
    document.body.classList.remove('is-resizing-filetree')
  })

  const storedWidth = Number(localStorage.getItem(storageKeys.nextVTreeWidth))
  if (Number.isFinite(storedWidth) && storedWidth > 0) {
    applyTreeWidth(storedWidth)
  }
}

function beginVerticalResize(event, topEl, bottomEl) {
  if (!topEl || !bottomEl) return
  const topRect = topEl.getBoundingClientRect()
  const bottomRect = bottomEl.getBoundingClientRect()
  activeVerticalResize = {
    topEl,
    bottomEl,
    startY: event.clientY,
    startTop: topRect.height,
    startBottom: bottomRect.height,
  }
  document.body.classList.add('is-vresizing')
  event.preventDefault()
}

function getLeftPanelSections() {
  if (isNextVMode()) {
    if (!nextVPanelState.devConsoleOpen) {
      return [scriptSection]
    }
    return [scriptSection, outputSection]
  }
  return [scriptSection, logsSection, outputSection]
}

function getLeftPanelSplitters() {
  if (isNextVMode()) {
    if (!nextVPanelState.devConsoleOpen) {
      return []
    }
    return [scriptVSplit1]
  }
  return [scriptVSplit1, scriptVSplit2]
}

function normalizeSectionRatios(values, expectedLength = getLeftPanelSections().length) {
  if (!Array.isArray(values) || values.length !== expectedLength) return null
  const numeric = values.map((value) => Number(value))
  if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) return null
  const total = numeric.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  return numeric.map((value) => value / total)
}

function readStoredLeftPanelHeights() {
  try {
    const raw = localStorage.getItem(storageKeys.leftHeights)
    if (!raw) return null
    return normalizeSectionRatios(JSON.parse(raw))
  } catch {
    return null
  }
}

function getCurrentLeftPanelHeights() {
  return getLeftPanelSections().map((section) => section?.getBoundingClientRect().height ?? 0)
}

function getAvailableLeftPanelSectionHeight() {
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

function getLeftPanelHeightRatios() {
  const heights = getCurrentLeftPanelHeights()
  return normalizeSectionRatios(heights)
}

function persistLeftPanelHeights() {
  const ratios = getLeftPanelHeightRatios()
  if (!ratios) return
  localStorage.setItem(storageKeys.leftHeights, JSON.stringify(ratios))
}

function resolveSectionHeights(totalHeight, ratios, minHeight) {
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

function applyLeftPanelHeights(ratios) {
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

function applyStoredLeftPanelHeights() {
  const stored = readStoredLeftPanelHeights()
  if (!stored) return false
  return applyLeftPanelHeights(stored)
}

function setupVerticalSplitters() {
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
    activeVerticalResize = null
    document.body.classList.remove('is-vresizing')
    persistLeftPanelHeights()
  })

  window.addEventListener('resize', () => {
    if (activeVerticalResize) return
    applyStoredLeftPanelHeights()
  })
}

function scrollToBottom() {
  transcript.scrollTop = transcript.scrollHeight
}

// Insert or append status bar just above footer
function ensureStatusBar() {
  let bar = document.getElementById('status-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'status-bar'
    document.getElementById('workspace').before(bar)
  }
  return bar
}

function setStatus(text, cls = '') {
  const bar = ensureStatusBar()
  bar.textContent = text
  bar.className = cls
}

// --- Session init ---
async function loadSession() {
  try {
    const res = await fetch('/api/session')
    const data = await res.json()
    if (data.model) modelInput.value = data.model
    imageCount.textContent = `${data.imageCount} attached`
  } catch {
    // best-effort
  }
}

// --- Transcript rendering ---
function appendUserTurn(prompt) {
  const turn = document.createElement('div')
  turn.className = 'turn'
  turn.innerHTML = `<div class="turn-role user">you</div><div class="turn-content">${escapeHtml(prompt)}</div>`
  transcript.appendChild(turn)
  scrollToBottom()
  return turn
}

function appendAssistantTurn() {
  const turn = document.createElement('div')
  turn.className = 'turn'
  const roleEl = document.createElement('div')
  roleEl.className = 'turn-role assistant'
  roleEl.textContent = 'assistant'
  const contentEl = document.createElement('div')
  contentEl.className = 'turn-content'
  contentEl.id = 'active-content'
  turn.appendChild(roleEl)
  turn.appendChild(contentEl)
  transcript.appendChild(turn)
  scrollToBottom()
  return contentEl
}

function appendThinkingBlock() {
  const block = document.createElement('div')
  block.className = 'thinking-block'
  block.id = 'active-thinking'
  const label = document.createElement('div')
  label.className = 'thinking-label'
  label.textContent = 'thinking…'
  const content = document.createElement('div')
  content.id = 'active-thinking-content'
  block.appendChild(label)
  block.appendChild(content)
  transcript.appendChild(block)
  scrollToBottom()
  return content
}

function appendToolRow(name, args) {
  const row = document.createElement('div')
  row.className = 'tool-row'
  row.id = `tool-${name}-pending`
  const argsStr = typeof args === 'string' ? args : JSON.stringify(args)
  row.innerHTML = `<span class="tool-name">${escapeHtml(name)}</span><span class="tool-args">${escapeHtml(argsStr)}</span>`
  transcript.appendChild(row)
  scrollToBottom()
  return row
}

function fillToolResult(name, result) {
  const row = document.getElementById(`tool-${name}-pending`)
  if (row) {
    const resultEl = document.createElement('span')
    resultEl.innerHTML = `<span class="tool-result-label">→</span> <span class="tool-result">${escapeHtml(result)}</span>`
    row.appendChild(resultEl)
    row.removeAttribute('id')
  }
}

function appendConfirmBlock(id, description, container = transcript) {
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
  if (container === transcript) {
    scrollToBottom()
  } else {
    container.scrollTop = container.scrollHeight
  }
}

async function submitScriptInputResponse(scriptRunId, value, meta = {}) {
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

function appendInputRequestNotice(payload) {
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

function appendErrorRow(message) {
  const row = document.createElement('div')
  row.className = 'turn'
  row.innerHTML = `<div class="turn-role system-msg">error</div><div class="turn-content">${escapeHtml(message)}</div>`
  transcript.appendChild(row)
  scrollToBottom()
}

function appendScriptLogRow(line, cls = '') {
  const row = document.createElement('div')
  row.className = `script-log-row${cls ? ` ${cls}` : ''}`
  row.textContent = line
  scriptLogs.appendChild(row)
  scriptLogs.scrollTop = scriptLogs.scrollHeight
}

function clearScriptLogs() {
  scriptLogs.innerHTML = ''
}

function clearScriptLogsPanel() {
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

function appendScriptOutputLine(line = '') {
  scriptOutput.textContent += `${line}\n`
  scriptOutput.scrollTop = scriptOutput.scrollHeight
}

function clearScriptOutput() {
  scriptOutput.textContent = ''
}

function clearScriptOutputPanel() {
  clearScriptOutput()
  setStatus('script output cleared')
}

function clearOutputPanel() {
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

function setScriptBadgeState(text, cls = '') {
  if (!scriptDirtyBadge) return
  scriptDirtyBadge.textContent = text
  scriptDirtyBadge.classList.remove('saved', 'dirty')
  if (cls) scriptDirtyBadge.classList.add(cls)
}

function syncScriptBadgeState() {
  const content = getScriptEditorText()
  if (!content && !scriptEditorState.path) {
    setScriptBadgeState('empty')
    return
  }
  if (scriptEditorState.dirty) {
    setScriptBadgeState('dirty', 'dirty')
    return
  }
  setScriptBadgeState('saved', 'saved')
}

function cancelScriptRun() {
  if (!activeScriptAbortController) {
    setStatus('no active script run', 'responding')
    return
  }

  activeScriptAbortController.abort()
  appendScriptLogRow('[script:cancel] Cancellation requested.', 'error')
  setStatus('cancelling script…', 'responding')
}

function clearScriptView() {
  clearNextVAutoSaveTimer()
  scriptView.value = ''
  scriptEditorState.path = ''
  scriptEditorState.loadedText = ''
  scriptEditorState.dirty = false
  activeScriptLine = null
  nextVFileState.openFilePath = ''
  nextVFileState.openTabs = []
  dirtyEditsCache.clear()
  updateOpenFileLabel('')
  renderScriptMirror('')
  syncScriptBadgeState()
  renderOpenFileTabs()
}

function normalizeNewlines(textValue) {
  return String(textValue ?? '').replace(/\r\n/g, '\n')
}

function inferEditorKindFromContext(lineText, tokenStart, marker) {
  if (marker === '!') return 'instruction'
  if (marker === '?') return 'prompt'

  const prior = String(lineText ?? '').slice(0, tokenStart).toLowerCase()
  const lastInstructions = prior.lastIndexOf('instructions=')
  const lastPrompt = prior.lastIndexOf('prompt=')
  if (lastPrompt > lastInstructions) return 'prompt'
  return 'instruction'
}

function findScriptReferenceAtOffset(textValue, offset) {
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

  return null
}

function buildScriptMirrorLine(textValue) {
  const row = document.createElement('div')
  row.className = 'script-editor-line'

  const textWrap = document.createElement('span')
  textWrap.className = 'script-editor-line-text'

  const line = String(textValue ?? '')
  SCRIPT_FILE_REF_REGEX.lastIndex = 0
  let lastIndex = 0
  let match

  while ((match = SCRIPT_FILE_REF_REGEX.exec(line)) !== null) {
    const marker = match[1] || ''
    const filePath = match[2]
    const start = match.index

    if (start > lastIndex) {
      textWrap.appendChild(document.createTextNode(line.slice(lastIndex, start)))
    }

    const token = document.createElement('span')
    const kind = inferEditorKindFromContext(line, start, marker)
    token.className = `script-ref-token ${kind}`
    token.textContent = match[0]
    token.title = `${kind}: ${filePath}`
    textWrap.appendChild(token)

    lastIndex = start + match[0].length
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

function syncScriptMirrorScroll() {
  if (!scriptView) return
  if (!scriptViewMirror && !scriptLineGutter) return
  if (scriptViewMirror) {
    scriptViewMirror.scrollTop = scriptView.scrollTop
    scriptViewMirror.scrollLeft = scriptView.scrollLeft
  }
  if (scriptLineGutter) {
    scriptLineGutter.scrollTop = scriptView.scrollTop
  }
}

function renderScriptMirror(textValue = getScriptEditorText()) {
  if (!scriptViewMirror && !scriptLineGutter) return

  if (scriptViewMirror) scriptViewMirror.innerHTML = ''
  if (scriptLineGutter) scriptLineGutter.innerHTML = ''
  const text = normalizeNewlines(textValue)
  if (!text) {
    syncScriptMirrorScroll()
    return
  }

  const gutterFragment = document.createDocumentFragment()
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (scriptLineGutter) {
      const gutterLine = document.createElement('div')
      gutterLine.className = 'script-editor-gutter-line'
      if (activeScriptLine === index + 1) {
        gutterLine.classList.add('is-active')
      }
      gutterLine.textContent = String(index + 1)
      gutterFragment.appendChild(gutterLine)
    }
  }

  if (scriptLineGutter) scriptLineGutter.appendChild(gutterFragment)
  syncScriptMirrorScroll()
}

async function openEditorReference(filePath) {
  const targetPath = String(filePath ?? '').trim()
  if (!targetPath) return

  if (!isNextVMode()) {
    setStatus(`file reference selected: ${targetPath}`)
    return
  }

  const currentDir = pathDirname(scriptEditorState.path)
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

function getScriptEditorText() {
  return normalizeNewlines(scriptView.value)
}

function renderScriptView(lines, filePath = '') {
  const text = normalizeNewlines(Array.isArray(lines) ? lines.join('\n') : '')
  scriptView.value = text
  scriptEditorState.path = filePath
  scriptEditorState.loadedText = text
  scriptEditorState.dirty = false
  activeScriptLine = null
  updateOpenFileLabel(filePath)
  renderScriptMirror(text)
  if (scriptPathInput && filePath) {
    scriptPathInput.value = filePath
  }
  syncScriptBadgeState()
}

function highlightScriptLine(lineNumber) {
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
  activeScriptLine = line
  renderScriptMirror()
}

function parseScriptStepLine(line) {
  const match = String(line ?? '').match(/^\[script:step\]\s+line=(\d+)\b/)
  if (!match) return null
  return Number(match[1])
}

function isScriptMetaLine(line) {
  return /^\[script:/.test(String(line ?? ''))
}

async function loadScriptContent(filePath) {
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

async function ensureNextVEntrypointVisible(options = {}) {
  if (!isNextVMode()) return

  const { logLoaded = false, warnOnDirty = true } = options
  const entrypointPath = resolveNextVPath(nextVEntrypointInput?.value)
  if (!entrypointPath) return

  const editorPath = String(scriptEditorState.path ?? '').trim()
  const hasUnsaved = scriptEditorState.dirty === true
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

async function openNextVWorkspace() {
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
  try {
    const cfgRes = await fetch(`/api/nextv/workspace-config?workspaceDir=${encodeURIComponent(workspaceDir)}`)
    if (cfgRes.ok) {
      const cfg = await cfgRes.json()
      configEntrypoint = String(cfg.entrypointPath ?? '').trim()
    }
  } catch {
    // ignore — fall through to heuristic
  }

  // 2. Determine candidate entrypoint: config first, then step.nrv, then step.wfs
  const fallbackEntrypoints = ['step.nrv', 'step.wfs']
  const candidateEntrypoints = configEntrypoint
    ? [configEntrypoint]
    : fallbackEntrypoints
  let candidateEntrypoint = candidateEntrypoints[0] || ''
  let candidateEntrypointPath = candidateEntrypoint ? `${workspaceDir}/${candidateEntrypoint}` : ''

  let loadedEntrypoint = false
  try {
    await loadWorkspaceTree(workspaceDir)
    const storedOpenFile = getStoredNextVOpenFile()
    const preferredOpenFile = storedOpenFile && storedOpenFile.startsWith(`${workspaceDir}/`)
      ? storedOpenFile
      : ''

    const openAttempts = []
    if (preferredOpenFile) openAttempts.push(preferredOpenFile)
    for (const relPath of candidateEntrypoints) {
      const fullPath = `${workspaceDir}/${relPath}`
      if (!openAttempts.includes(fullPath)) {
        openAttempts.push(fullPath)
      }
    }

    let openedPath = ''
    for (const attemptPath of openAttempts) {
      try {
        await openWorkspaceEditorFile(attemptPath)
        openedPath = attemptPath
        break
      } catch {
        // try next candidate
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
    appendNextVLogRow(`[nextv:workspace] loaded ${normalizeRelativePath(scriptEditorState.path)}`, 'step')
    if (configEntrypoint) {
      appendNextVLogRow(`[nextv:workspace] entrypoint from nextv.json: ${configEntrypoint}`, 'result')
    }
  } catch (err) {
    if (nextVEntrypointInput) {
      nextVEntrypointInput.value = ''
    }
    appendNextVLogRow(`[nextv:workspace] ${candidateEntrypointPath} not found — select an entrypoint to enable start`, 'result')
  }

  persistNextVConfig()
  setNextVRunControls()
  await refreshNextVGraph({ silent: true })
  if (loadedEntrypoint) {
    setStatus('workspace opened')
  } else {
    setStatus('no entrypoint found', 'responding')
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- SSE stream parser ---
// Parses complete SSE events from a growing string buffer.
// Returns {events: [{event, data}], remaining: string}
function parseSSEBuffer(buffer) {
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

function tokenizeCommandArgs(rawArgs) {
  const tokens = []
  const source = String(rawArgs ?? '')
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(source)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

function parseScriptChatCommand(prompt) {
  const text = String(prompt ?? '').trim()
  if (!text.toLowerCase().startsWith('/script')) return null

  const rest = text.slice('/script'.length).trim()
  const tokens = tokenizeCommandArgs(rest)
  if (tokens.length === 0) {
    return { error: 'Usage: /script <path> [--yes|-y]' }
  }

  let autoAllow = false
  const pathTokens = []
  for (const token of tokens) {
    const normalized = String(token).toLowerCase()
    if (normalized === '--yes' || normalized === '-y') {
      autoAllow = true
      continue
    }
    pathTokens.push(token)
  }

  const filePath = pathTokens.join(' ').trim()
  if (!filePath) {
    return { error: 'Script path required. Usage: /script <path> [--yes|-y]' }
  }

  return { filePath, autoAllow }
}

// --- Chat submit ---
async function handleSubmit(e) {
  e.preventDefault()
  const prompt = promptInput.value.trim()
  if (!prompt) return

  const scriptCommand = parseScriptChatCommand(prompt)
  if (scriptCommand) {
    if (scriptCommand.error) {
      setStatus(scriptCommand.error, 'responding')
      return
    }
    if (isBusy) {
      setStatus('busy: wait for current task', 'responding')
      return
    }

    appendUserTurn(prompt)
    promptInput.value = ''

    const autoAllowInput = document.getElementById('script-autoallow')
    const previousAutoAllow = Boolean(autoAllowInput?.checked)
    if (scriptPathInput) {
      scriptPathInput.value = scriptCommand.filePath
    }
    if (autoAllowInput) {
      autoAllowInput.checked = scriptCommand.autoAllow
    }

    try {
      await runScript()
    } finally {
      if (autoAllowInput) {
        autoAllowInput.checked = previousAutoAllow
      }
    }
    return
  }

  if (isBusy) return

  isBusy = true
  setNextVRunControls()
  sendBtn.disabled = true
  promptInput.disabled = true

  appendUserTurn(prompt)
  promptInput.value = ''

  const contentEl = appendAssistantTurn()
  let thinkingEl = null
  let buffer = ''

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'request failed' }))
      appendErrorRow(err.error ?? 'request failed')
      return
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
        handleSSEEvent(event, payload, contentEl, (el) => { thinkingEl = el })
      }
    }
  } catch (err) {
    appendErrorRow(err.message)
  } finally {
    isBusy = false
    setNextVRunControls()
    sendBtn.disabled = false
    promptInput.disabled = false
    promptInput.focus()
    // Clean up any lingering thinking block
    const activeThinking = document.getElementById('active-thinking')
    if (activeThinking) activeThinking.removeAttribute('id')
    setStatus('idle')
  }
}

function handleSSEEvent(event, payload, contentEl, setThinkingEl) {
  switch (event) {
    case 'status':
      setStatus(payload.status ?? '', payload.status ?? '')
      break
    case 'thinking_start': {
      const el = appendThinkingBlock()
      setThinkingEl(el)
      break
    }
    case 'thinking': {
      const el = document.getElementById('active-thinking-content')
      if (el) el.textContent += payload.chunk ?? ''
      scrollToBottom()
      break
    }
    case 'thinking_end': {
      const block = document.getElementById('active-thinking')
      if (block) block.removeAttribute('id')
      break
    }
    case 'content':
      if (contentEl) {
        contentEl.textContent += payload.chunk ?? ''
        scrollToBottom()
      }
      break
    case 'tool_call':
      appendToolRow(payload.name ?? 'tool', payload.args)
      break
    case 'tool_result':
      fillToolResult(payload.name ?? 'tool', payload.result)
      maybeRenderToolVisual(payload.name, payload.result)
      break
    case 'confirm_request':
      appendConfirmBlock(payload.id, payload.description)
      break
    case 'error':
      appendErrorRow(payload.message ?? 'unknown error')
      break
    case 'done':
      // handled by finally
      break
  }
}

// --- Tool confirmation ---
async function resolveConfirm(id, allow, btn) {
  btn.closest('.confirm-block').querySelectorAll('button').forEach(b => b.disabled = true)
  try {
    await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, allow }),
    })
    const label = btn.closest('.confirm-block').querySelector('.confirm-desc')
    if (label) label.textContent += allow ? ' → allowed' : ' → denied'
    setStatus(allow ? 'confirmation sent: allowed' : 'confirmation sent: denied')
  } catch (err) {
    appendErrorRow(`Confirm failed: ${err.message}`)
  }
}

// --- Model ---
async function setModel() {
  const model = modelInput.value.trim()
  if (!model) return
  try {
    const res = await fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    const data = await res.json()
    if (data.model) modelInput.value = data.model
    setStatus(`model: ${data.model ?? model}`)
  } catch (err) {
    appendErrorRow(`Model switch failed: ${err.message}`)
  }
}

// --- htmx callbacks ---
function onChatCleared(event) {
  if (event.detail.successful) {
    transcript.innerHTML = ''
    imageCount.textContent = '0 attached'
    setStatus('chat cleared')
    return
  }

  const xhr = event.detail?.xhr
  if (!xhr || xhr.status !== 409) return

  let payload = {}
  try {
    payload = JSON.parse(xhr.responseText || '{}')
  } catch {
    payload = {}
  }

  if (!payload?.requiresDiscard) {
    setStatus('failed to clear chat', 'responding')
    return
  }

  const shouldDiscard = window.confirm('Discard unsaved chat changes and clear session?')
  if (!shouldDiscard) {
    setStatus('clear cancelled')
    return
  }

  fetch('/api/chat/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discardUnsaved: true }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('clear failed')
      transcript.innerHTML = ''
      imageCount.textContent = '0 attached'
      setStatus('chat cleared')
    })
    .catch((err) => {
      appendErrorRow(`Clear failed: ${err.message}`)
      setStatus('failed to clear chat', 'responding')
    })
}

function onImagesCleared(event) {
  if (event.detail.successful) {
    imageCount.textContent = '0 attached'
    setStatus('images cleared')
  }
}

function isValidScriptInputKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key ?? ''))
}

function addScriptInputRow(key = '', value = '') {
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

function collectScriptInputVars() {
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

// --- Image upload ---
async function uploadImage(input) {
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  const reader = new FileReader()
  reader.onload = async (e) => {
    const dataUrl = e.target.result
    // Strip the data URI prefix: data:<mime>;base64,<data>
    const base64 = dataUrl.split(',')[1]
    if (!base64) return appendErrorRow('Could not read image data.')
    try {
      const res = await fetch('/api/images/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, name: file.name }),
      })
      const data = await res.json()
      if (res.ok) {
        imageCount.textContent = `${data.imageCount} attached`
        setStatus(`image added: ${file.name}`)
      } else {
        appendErrorRow(data.error ?? 'Image upload failed.')
      }
    } catch (err) {
      appendErrorRow(`Image upload failed: ${err.message}`)
    }
  }
  reader.readAsDataURL(file)
}

async function loadScriptPreview() {
  const filePath = scriptPathInput.value.trim()
  if (!filePath) {
    setStatus('script path required', 'responding')
    return
  }

  if (isBusy) {
    setStatus('wait for current task', 'responding')
    return
  }

  setScriptMode()
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

async function saveScriptBuffer() {
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

async function saveNextVEntrypoint() {
  try {
    const filePath = normalizeRelativePath(scriptEditorState.path)
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
async function runScript(runOptions = {}) {
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
    isBusy = true
    setNextVRunControls()
    sendBtn.disabled = true
    promptInput.disabled = true
    activeScriptAbortController = new AbortController()
    setActiveScriptRunId('')
    updateScriptRunControls()
    if (!isNextVMode()) {
      setScriptMode()
    }
    clearScriptLogs()
    activeScriptLine = null

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

    const normalizedPath = normalizeNewlines(filePath)
    const runningEditedBuffer =
      scriptEditorState.dirty ||
      scriptEditorState.path !== normalizedPath ||
      scriptText !== scriptEditorState.loadedText
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
    activeScriptAbortController = null
    updateScriptRunControls()
    isBusy = false
    setNextVRunControls()
    sendBtn.disabled = false
    promptInput.disabled = false
    promptInput.focus()
  }
}

// --- Keyboard shortcut ---
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (!isBusy) document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
  }
})

if (userInputText) {
  userInputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      sendNextVUserText()
    }
  })
}

if (scriptView) {
  const toggleScriptCommentBlock = () => {
    const value = scriptView.value
    const start = Number(scriptView.selectionStart)
    const end = Number(scriptView.selectionEnd)
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
    scriptView.value = `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`

    if (hasSelection) {
      scriptView.setSelectionRange(lineStart, lineStart + transformedBlock.length)
    } else {
      const originalLine = lines[0] ?? ''
      const transformedLine = transformedLines[0] ?? ''
      const delta = transformedLine.length - originalLine.length
      const nextCaret = Math.max(lineStart, start + delta)
      scriptView.setSelectionRange(nextCaret, nextCaret)
    }

    scriptView.dispatchEvent(new Event('input', { bubbles: true }))
  }

  scriptView.addEventListener('keydown', (e) => {
    const isCommentToggleShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '/' || e.code === 'Slash')
    if (isCommentToggleShortcut) {
      e.preventDefault()
      toggleScriptCommentBlock()
      return
    }

    if (e.key !== 'Tab') return

    e.preventDefault()

    const value = scriptView.value
    const start = Number(scriptView.selectionStart)
    const end = Number(scriptView.selectionEnd)
    const hasSelection = start !== end

    if (!hasSelection && !e.shiftKey) {
      const inserted = '\t'
      scriptView.value = `${value.slice(0, start)}${inserted}${value.slice(end)}`
      scriptView.setSelectionRange(start + inserted.length, start + inserted.length)
      scriptView.dispatchEvent(new Event('input', { bubbles: true }))
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
        if (line.startsWith('  ')) {
          if (index === 0 && start > lineStart) removedBeforeCaret = Math.min(2, start - lineStart)
          return line.slice(2)
        }
        return line
      })
    } else {
      transformedLines = lines.map((line) => `\t${line}`)
    }

    const transformedBlock = transformedLines.join('\n')
    scriptView.value = `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`

    if (hasSelection) {
      scriptView.setSelectionRange(lineStart, lineStart + transformedBlock.length)
    } else if (e.shiftKey) {
      const nextCaret = Math.max(lineStart, start - removedBeforeCaret)
      scriptView.setSelectionRange(nextCaret, nextCaret)
    } else {
      scriptView.setSelectionRange(start + 1, start + 1)
    }

    scriptView.dispatchEvent(new Event('input', { bubbles: true }))
  })

  scriptView.addEventListener('input', () => {
    activeScriptLine = null
    scriptEditorState.dirty = getScriptEditorText() !== scriptEditorState.loadedText
    renderScriptMirror()
    syncScriptBadgeState()
    renderOpenFileTabs()
    scheduleNextVAutoSave()
  })

  scriptView.addEventListener('scroll', () => {
    syncScriptMirrorScroll()
  })

  scriptView.addEventListener('click', async () => {
    if (scriptView.selectionStart !== scriptView.selectionEnd) return

    const text = getScriptEditorText()
    const primaryOffset = Number(scriptView.selectionStart)
    const candidateOffsets = [primaryOffset, Math.max(0, primaryOffset - 1)]

    for (const offset of candidateOffsets) {
      const ref = findScriptReferenceAtOffset(text, offset)
      if (!ref) continue
      await openEditorReference(ref.filePath)
      return
    }
  })
}

if (scriptPathInput) {
  scriptPathInput.addEventListener('input', () => {
    const nextPath = scriptPathInput.value.trim()
    scriptEditorState.dirty = nextPath !== scriptEditorState.path || getScriptEditorText() !== scriptEditorState.loadedText
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

// Model input: Enter = set
modelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setModel()
})

document.addEventListener('keydown', (e) => {
  const key = String(e.key ?? '').toLowerCase()
  if (key !== 's' || (!e.ctrlKey && !e.metaKey)) return
  if (!isScriptMode() && !isNextVMode()) return
  e.preventDefault()
  if (isNextVMode()) {
    if (e.shiftKey) {
      saveAllNextVFiles()
      return
    }
    saveNextVEntrypoint()
    return
  }
  saveScriptBuffer()
})

window.addEventListener('beforeunload', () => {
  closeNextVStream()
  clearDeleteConfirmTimers()
})

// --- Init ---
function initLayoutState() {
  const savedMode = localStorage.getItem(storageKeys.mode)
  setAppMode(savedMode === 'script' || savedMode === 'nextv' ? savedMode : 'nextv')

  const savedWidth = Number(localStorage.getItem(storageKeys.leftWidth))
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    setLeftPanelWidth(savedWidth)
  }

  restoreNextVConfig()

  const queryWorkspaceDir = normalizeNextVWorkspaceDir(
    new URLSearchParams(window.location.search).get('workspaceDir') ?? ''
  )
  if (queryWorkspaceDir && nextVWorkspaceDirInput) {
    nextVWorkspaceDirInput.value = queryWorkspaceDir
  }

  setNextVDevConsoleOpen(nextVPanelState.devConsoleOpen, { persist: false })
  setNextVPrimaryView(nextVViewState.currentView, { persist: false })
  setNextVDevTab(tracePanelState.currentTab, { persist: false })
  inputPanelState.currentTab = 'external'
  setNextVInputTab(inputPanelState.currentTab, { persist: false })
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

  const workspaceDir = normalizeNextVWorkspaceDir(nextVWorkspaceDirInput?.value ?? '')
  if (workspaceDir && isNextVMode()) {
    openNextVWorkspace().catch((err) => {
      appendNextVErrorLog(err, '[nextv:workspace:auto-open:error]')
    })
  }
}

setupSplitter()
setupFileTreeSplitter()
setupNextVStateDiffSplitter()
setupNextVUserIOSplitter()
setupNextVImageDropzone()
updateNextVEventImageUI()
setupVerticalSplitters()
initLayoutState()
initFileTreeCtxMenu()
updateScriptRunControls()
syncNextVRuntimeState()
loadSession()
