import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function resolveToolInput(args, positional) {
  if (Array.isArray(positional) && positional.length > 0 && isPlainObject(positional[0])) {
    return positional[0]
  }

  if (isPlainObject(args?.named) && Object.keys(args.named).length > 0) {
    return args.named
  }

  if (isPlainObject(args)) return args
  return {}
}

function resolveStorePath(workspaceDir, storePathRaw) {
  const root = String(workspaceDir ?? '').trim()
  if (!root) {
    throw new Error('store_file_json requires a workspaceDir context.')
  }

  const storePath = String(storePathRaw ?? '').trim()
  if (!storePath) {
    throw new Error('store_file_json requires args.store as a non-empty relative path.')
  }
  if (isAbsolute(storePath)) {
    throw new Error('store_file_json args.store must be a workspace-relative path.')
  }

  const absolutePath = resolve(root, storePath)
  const rel = relative(root, absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('store_file_json args.store must stay within the workspace directory.')
  }

  return {
    absolutePath,
    relativePath: rel.replace(/\\/g, '/'),
  }
}

function loadStoreObject(absolutePath) {
  if (!existsSync(absolutePath)) return {}

  const raw = readFileSync(absolutePath, 'utf8').trim()
  if (!raw) return {}

  const parsed = JSON.parse(raw)
  if (!isPlainObject(parsed)) {
    throw new Error('store_file_json store file must contain a JSON object.')
  }
  return parsed
}

function saveStoreObjectAtomic(absolutePath, value) {
  const dir = dirname(absolutePath)
  mkdirSync(dir, { recursive: true })

  const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(tempPath, absolutePath)
  } finally {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    } catch {
      // ignore cleanup failure for orphaned temp files
    }
  }
}

function requireKey(input) {
  const key = String(input.key ?? '').trim()
  if (!key) {
    throw new Error('store_file_json requires args.key for this operation.')
  }
  return key
}

export function createPublicFileStoreProvider({ workspaceDir } = {}) {
  return {
    store_file_json: async ({ args, positional }) => {
      const input = resolveToolInput(args, positional)
      const op = String(input.op ?? '').trim().toLowerCase()
      const { absolutePath, relativePath } = resolveStorePath(workspaceDir, input.store)
      const store = loadStoreObject(absolutePath)

      if (op === 'get') {
        const key = requireKey(input)
        const found = Object.prototype.hasOwnProperty.call(store, key)
        return {
          ok: true,
          op,
          store: relativePath,
          key,
          found,
          value: found ? store[key] : null,
        }
      }

      if (op === 'put') {
        const key = requireKey(input)
        if (!Object.prototype.hasOwnProperty.call(input, 'value') || input.value === undefined) {
          throw new Error('store_file_json put requires args.value.')
        }
        store[key] = input.value
        saveStoreObjectAtomic(absolutePath, store)
        return {
          ok: true,
          op,
          store: relativePath,
          key,
        }
      }

      if (op === 'delete') {
        const key = requireKey(input)
        const deleted = Object.prototype.hasOwnProperty.call(store, key)
        if (deleted) {
          delete store[key]
          saveStoreObjectAtomic(absolutePath, store)
        }
        return {
          ok: true,
          op,
          store: relativePath,
          key,
          deleted,
        }
      }

      if (op === 'list_keys') {
        const keys = Object.keys(store)
        return {
          ok: true,
          op,
          store: relativePath,
          count: keys.length,
          keys,
        }
      }

      throw new Error('store_file_json requires args.op to be one of: get, put, delete, list_keys.')
    },
  }
}
