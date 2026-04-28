import { dirname, resolve } from 'node:path'

export function resolveOptionalStatePath({
  rawStatePath,
  rawWorkspaceDir,
  workspaceDir,
  entrypoint,
  resolvePathFromBaseDirectory,
  existsSync,
}) {
  if (!rawStatePath) return ''

  const fromWorkspace = resolvePathFromBaseDirectory(workspaceDir.absolutePath, rawStatePath, 'editor').absolutePath
  const hasPathSeparator = rawStatePath.includes('/') || rawStatePath.includes('\\')

  if (!rawWorkspaceDir && !hasPathSeparator) {
    const fromEntrypointDir = resolvePathFromBaseDirectory(dirname(entrypoint.absolutePath), rawStatePath, 'editor').absolutePath
    if (existsSync(fromEntrypointDir) || !existsSync(fromWorkspace)) {
      return fromEntrypointDir
    }
  }

  return fromWorkspace
}

export function resolveStateDiscoveryBaseDir({ rawWorkspaceDir, workspaceDir, entrypoint }) {
  if (rawWorkspaceDir) return workspaceDir.absolutePath
  return dirname(entrypoint.absolutePath)
}

export function resolveDiscoveredStatePath(baseDir, fileName, existsSync) {
  const candidate = resolve(baseDir, fileName)
  if (!existsSync(candidate)) return ''
  return candidate
}

export function normalizeInputEvent(body = {}) {
  const hasExplicitSource = Object.prototype.hasOwnProperty.call(body, 'source')
  return {
    value: String(body.value ?? ''),
    type: String(body.type ?? body.eventType ?? '').trim(),
    source: hasExplicitSource ? String(body.source ?? '').trim() : 'external',
    payload: body.payload ?? null,
  }
}

export function buildNextVTimerEvent(timer) {
  const payload = timer.payload ?? null
  return {
    type: timer.event,
    value: payload,
    payload,
    source: 'timer',
  }
}

export function clearTimerHandles(timerHandles, clearIntervalImpl = clearInterval) {
  if (!Array.isArray(timerHandles) || timerHandles.length === 0) return []
  for (const timer of timerHandles) {
    try {
      clearIntervalImpl(timer.handle)
    } catch {
      // ignore timer cleanup errors
    }
  }
  return []
}

export function startTimerHandles({
  runner,
  timers,
  isRunnerActive,
  onPulse,
  setIntervalImpl = setInterval,
}) {
  if (!runner || !Array.isArray(timers) || timers.length === 0) return []

  const handles = []
  for (const timer of timers) {
    if (timer.runOnStart) {
      const event = buildNextVTimerEvent(timer)
      runner.enqueue(event)
      if (typeof onPulse === 'function') {
        onPulse(event)
      }
    }

    const handle = setIntervalImpl(() => {
      if (typeof isRunnerActive === 'function' && !isRunnerActive(runner)) return
      const event = buildNextVTimerEvent(timer)
      runner.enqueue(event)
      if (typeof onPulse === 'function') {
        onPulse(event)
      }
    }, timer.interval)

    handles.push({
      event: timer.event,
      interval: timer.interval,
      runOnStart: timer.runOnStart === true,
      handle,
    })
  }

  return handles
}
