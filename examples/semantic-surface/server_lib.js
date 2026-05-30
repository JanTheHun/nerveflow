import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_STATE_DIR = path.basename(path.dirname(dirname)) === 'capabilities'
  ? path.resolve(dirname, '..', '..', 'semantic-surface')
  : dirname
const DEFAULT_STATE_PATH = path.join(DEFAULT_STATE_DIR, 'semantic-surface-state.json')

function asString(value) {
  return String(value ?? '').trim()
}

function asIsoNow() {
  return new Date().toISOString()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readSharedState(stateFilePath) {
  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { interactions: [], updatedAt: null }
    }
    return {
      interactions: Array.isArray(parsed.interactions)
        ? parsed.interactions.filter((entry) => isPlainObject(entry))
        : [],
      updatedAt: asString(parsed.updatedAt) || null,
    }
  } catch {
    return { interactions: [], updatedAt: null }
  }
}

async function writeSharedState(stateFilePath, nextState) {
  const payload = {
    interactions: Array.isArray(nextState?.interactions)
      ? nextState.interactions.filter((entry) => isPlainObject(entry))
      : [],
    updatedAt: asString(nextState?.updatedAt) || asIsoNow(),
  }
  await mkdir(path.dirname(stateFilePath), { recursive: true })
  await writeFile(stateFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function withoutInteraction(interactions, interactionId, target) {
  return interactions.filter((entry) => {
    return !(
      asString(entry?.interactionId) === interactionId
      && asString(entry?.target) === target
    )
  })
}

export async function getSemanticSurfaceSnapshot({ stateFilePath = DEFAULT_STATE_PATH } = {}) {
  return await readSharedState(stateFilePath)
}

export function createSemanticSurfaceIngressConnector({
  ingressName = 'semantic_surface_event',
  stateFilePath = DEFAULT_STATE_PATH,
} = {}) {
  const name = asString(ingressName) || 'semantic_surface_event'
  const connector = {
    [name]: async (payload = {}) => {
      const interactionId = asString(payload.interactionId)
      const target = asString(payload.target)
      const action = asString(payload.action)

      if (!interactionId) {
        throw new Error('semantic-surface ingress requires interactionId')
      }
      if (!target) {
        throw new Error('semantic-surface ingress requires target')
      }
      if (!action) {
        throw new Error('semantic-surface ingress requires action')
      }

      const sharedState = await readSharedState(stateFilePath)
      await writeSharedState(stateFilePath, {
        interactions: withoutInteraction(sharedState.interactions, interactionId, target),
        updatedAt: asIsoNow(),
      })

      return {
        type: 'semantic_surface_event',
        source: 'external',
        value: {
          interactionId,
          target,
          action,
          payload: payload.value ?? payload.payload ?? null,
          schemaVersion: asString(payload.schemaVersion) || '1.0',
          sourceSessionId: asString(payload.sourceSessionId) || 'semantic-surface-local',
          timestamp: asString(payload.timestamp) || asIsoNow(),
        },
      }
    },
  }

  return connector
}

export function createSemanticSurfaceEffectRealizer({
  effectName = 'semantic_surface',
  stateFilePath = DEFAULT_STATE_PATH,
} = {}) {
  const name = asString(effectName) || 'semantic_surface'
  const realizer = {
    [name]: async (payload = {}) => {
      const value = payload?.runtimeEvent?.value ?? payload?.event?.value ?? payload?.value ?? null
      const interactionId = asString(value?.interactionId)
      const target = asString(value?.target)

      if (!interactionId) {
        throw new Error('semantic-surface effect requires interactionId in event.value')
      }
      if (!target) {
        throw new Error('semantic-surface effect requires target in event.value')
      }

      const sharedState = await readSharedState(stateFilePath)
      const nextInteractions = withoutInteraction(sharedState.interactions, interactionId, target)
      nextInteractions.push({
        interactionId,
        target,
        value,
        renderedAt: asIsoNow(),
      })
      await writeSharedState(stateFilePath, {
        interactions: nextInteractions,
        updatedAt: asIsoNow(),
      })

      return {
        ok: true,
        interactionId,
        target,
        renderedAt: asIsoNow(),
      }
    },
  }

  return realizer
}
