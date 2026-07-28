export const GRAPH_LAYOUT_STORAGE_KEY = 'local-agent.nextv.graphLayoutOverrides'

function normalizeLayoutDirection(value) {
  return String(value ?? '').trim().toUpperCase() === 'LR' ? 'LR' : 'TB'
}

export function getGraphLayoutScope(workspaceDir, entrypointPath, layoutDirection) {
  return JSON.stringify([
    String(workspaceDir ?? '').trim(),
    String(entrypointPath ?? '').trim(),
    normalizeLayoutDirection(layoutDirection),
  ])
}

function readStoredLayouts(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {}
  try {
    const parsed = JSON.parse(storage.getItem(GRAPH_LAYOUT_STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function loadGraphLayoutPositions(storage, scope) {
  const layouts = readStoredLayouts(storage)
  const storedPositions = layouts[String(scope ?? '')]
  const positions = new Map()
  if (!storedPositions || typeof storedPositions !== 'object' || Array.isArray(storedPositions)) {
    return positions
  }

  for (const [nodeId, value] of Object.entries(storedPositions)) {
    if (!Array.isArray(value) || value.length < 2) continue
    const x = Number(value[0])
    const y = Number(value[1])
    if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) continue
    positions.set(nodeId, { x, y })
  }
  return positions
}

export function saveGraphLayoutPosition(storage, scope, nodeId, position) {
  if (!storage || typeof storage.setItem !== 'function') return false
  const normalizedScope = String(scope ?? '')
  const normalizedNodeId = String(nodeId ?? '').trim()
  const x = Number(position?.x)
  const y = Number(position?.y)
  if (!normalizedScope || !normalizedNodeId || !Number.isFinite(x) || !Number.isFinite(y)) return false

  const layouts = readStoredLayouts(storage)
  const storedPositions = layouts[normalizedScope]
  layouts[normalizedScope] = storedPositions && typeof storedPositions === 'object' && !Array.isArray(storedPositions)
    ? storedPositions
    : {}
  layouts[normalizedScope][normalizedNodeId] = [Math.round(x), Math.round(y)]
  storage.setItem(GRAPH_LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
  return true
}

export function clearGraphLayoutPositions(storage, scope) {
  if (!storage || typeof storage.setItem !== 'function') return false
  const normalizedScope = String(scope ?? '')
  if (!normalizedScope) return false

  const layouts = readStoredLayouts(storage)
  if (!Object.prototype.hasOwnProperty.call(layouts, normalizedScope)) return false
  delete layouts[normalizedScope]
  storage.setItem(GRAPH_LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
  return true
}

export function applyGraphLayoutPositions(positions, overrides) {
  if (!(positions instanceof Map) || !(overrides instanceof Map)) return 0
  let applied = 0
  for (const [nodeId, position] of overrides.entries()) {
    if (!positions.has(nodeId)) continue
    positions.set(nodeId, { x: position.x, y: position.y })
    applied += 1
  }
  return applied
}

function getNodeBoundaryPoint(center, target, geometry) {
  const dx = target.x - center.x
  const dy = target.y - center.y
  const distance = Math.hypot(dx, dy) || 1
  const width = Math.max(0, Number(geometry?.width) || 0)
  const height = Math.max(0, Number(geometry?.height) || 0)

  if (geometry?.shape === 'circle') {
    const radius = Math.min(width, height) / 2
    return {
      x: center.x + ((dx / distance) * radius),
      y: center.y + ((dy / distance) * radius),
    }
  }

  const halfWidth = width / 2
  const halfHeight = height / 2
  const xScale = Math.abs(dx) > 0 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY
  const yScale = Math.abs(dy) > 0 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY
  const scale = Math.min(xScale, yScale)
  if (!Number.isFinite(scale)) return { x: center.x, y: center.y }
  return {
    x: center.x + (dx * scale),
    y: center.y + (dy * scale),
  }
}

export function getClippedGraphEdgeLine(start, end, fromGeometry, toGeometry) {
  const startX = Number(start?.x)
  const startY = Number(start?.y)
  const endX = Number(end?.x)
  const endY = Number(end?.y)
  if (![startX, startY, endX, endY].every(Number.isFinite)) return null

  const startCenter = { x: startX, y: startY }
  const endCenter = { x: endX, y: endY }
  const clippedStart = getNodeBoundaryPoint(startCenter, endCenter, fromGeometry)
  const clippedEnd = getNodeBoundaryPoint(endCenter, startCenter, toGeometry)
  return {
    x1: clippedStart.x,
    y1: clippedStart.y,
    x2: clippedEnd.x,
    y2: clippedEnd.y,
  }
}