import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function emptyRoleBuckets() {
  return {
    toolProviders: [],
    ingressConnectors: [],
    effectRealizers: [],
  }
}

function normalizeProviderValue(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'function' || isPlainObject(value)) return [value]
  return []
}

function hasRoleKeys(value) {
  if (!isPlainObject(value)) return false
  return (
    Object.prototype.hasOwnProperty.call(value, 'toolProviders')
    || Object.prototype.hasOwnProperty.call(value, 'providers')
    || Object.prototype.hasOwnProperty.call(value, 'tools')
    || Object.prototype.hasOwnProperty.call(value, 'ingressConnectors')
    || Object.prototype.hasOwnProperty.call(value, 'connectors')
    || Object.prototype.hasOwnProperty.call(value, 'effectRealizers')
    || Object.prototype.hasOwnProperty.call(value, 'realizers')
  )
}

function normalizeRoleValue(value, fallbackRole = 'tools') {
  const buckets = emptyRoleBuckets()

  if (!value) return buckets

  if (Array.isArray(value)) {
    const normalized = normalizeProviderValue(value)
    if (fallbackRole === 'connectors') buckets.ingressConnectors.push(...normalized)
    else if (fallbackRole === 'realizers') buckets.effectRealizers.push(...normalized)
    else buckets.toolProviders.push(...normalized)
    return buckets
  }

  if (typeof value === 'function') {
    if (fallbackRole === 'connectors') buckets.ingressConnectors.push(value)
    else if (fallbackRole === 'realizers') buckets.effectRealizers.push(value)
    else buckets.toolProviders.push(value)
    return buckets
  }

  if (!isPlainObject(value)) return buckets

  if (hasRoleKeys(value)) {
    buckets.toolProviders.push(...normalizeProviderValue(value.toolProviders ?? value.providers ?? value.tools))
    buckets.ingressConnectors.push(...normalizeProviderValue(value.ingressConnectors ?? value.connectors))
    buckets.effectRealizers.push(...normalizeProviderValue(value.effectRealizers ?? value.realizers))
    return buckets
  }

  if (fallbackRole === 'connectors') buckets.ingressConnectors.push(value)
  else if (fallbackRole === 'realizers') buckets.effectRealizers.push(value)
  else buckets.toolProviders.push(value)
  return buckets
}

function mergeRoleBuckets(target, source) {
  target.toolProviders.push(...source.toolProviders)
  target.ingressConnectors.push(...source.ingressConnectors)
  target.effectRealizers.push(...source.effectRealizers)
}

async function resolveProviderEntry(entry, context) {
  if (typeof entry === 'function') {
    const resolved = await entry(context)
    return normalizeProviderValue(resolved)
  }
  return normalizeProviderValue(entry)
}

async function resolveRoleEntry(entry, context, fallbackRole = 'tools') {
  if (typeof entry === 'function') {
    const resolved = await entry(context)
    return normalizeRoleValue(resolved, fallbackRole)
  }
  return normalizeRoleValue(entry, fallbackRole)
}

async function loadWorkspaceRoles(workspaceDir) {
  const hostModulesDir = path.resolve(workspaceDir, 'host_modules')
  if (!fs.existsSync(hostModulesDir)) return emptyRoleBuckets()

  const indexPath = path.resolve(hostModulesDir, 'index.js')
  if (!fs.existsSync(indexPath)) {
    console.warn('[host-modules] host_modules exists but no index.js found; skipping workspace providers')
    return emptyRoleBuckets()
  }

  try {
    const loaded = await import(pathToFileURL(indexPath).href)
    const context = {
      workspaceDir,
      hostModulesDir,
    }

    const knownExports = new Set([
      'default',
      'createHostModules',
      'createProviders',
      'createConnectors',
      'createIngressConnectors',
      'createRealizers',
      'createEffectRealizers',
    ])

    const roles = emptyRoleBuckets()

    if (loaded.default != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.default, context, 'tools'))
    }

    if (loaded.createHostModules != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.createHostModules, context, 'tools'))
    }

    if (loaded.createProviders != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.createProviders, context, 'tools'))
    }

    if (loaded.createConnectors != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.createConnectors, context, 'connectors'))
    }

    if (loaded.createIngressConnectors != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.createIngressConnectors, context, 'connectors'))
    }

    if (loaded.createRealizers != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.createRealizers, context, 'realizers'))
    }

    if (loaded.createEffectRealizers != null) {
      mergeRoleBuckets(roles, await resolveRoleEntry(loaded.createEffectRealizers, context, 'realizers'))
    }

    const foundKnownRoleExports = (
      roles.toolProviders.length > 0
      || roles.ingressConnectors.length > 0
      || roles.effectRealizers.length > 0
    )

    if (!foundKnownRoleExports) {
      for (const [name, value] of Object.entries(loaded)) {
        if (knownExports.has(name)) continue
        if (!name.startsWith('create')) continue
        mergeRoleBuckets(roles, await resolveRoleEntry(value, context, 'tools'))
      }
    }

    roles.toolProviders = roles.toolProviders.filter(Boolean)
    roles.ingressConnectors = roles.ingressConnectors.filter(Boolean)
    roles.effectRealizers = roles.effectRealizers.filter(Boolean)
    return roles
  } catch (error) {
    console.error('[host-modules] Failed to load workspace providers:', error.message)
    return emptyRoleBuckets()
  }
}

/**
 * Load host modules grouped by role.
 *
 * Roles:
 * - toolProviders: callable workflow tools
 * - ingressConnectors: external event ingress connectors
 * - effectRealizers: output/effect channel realizers
 */
export async function loadHostModulesByRole(options = {}) {
  const roles = emptyRoleBuckets()
  const { workspaceDir, builtinOnly = false } = options

  try {
    const { createRuntimeBuiltinToolProvider } = await import('./builtin/index.js')
    roles.toolProviders.push(createRuntimeBuiltinToolProvider())
  } catch (error) {
    console.error('[host-modules] Failed to load builtin provider:', error.message)
  }

  if (builtinOnly) {
    return roles
  }

  try {
    const { createPublicHostModuleProviders } = await import('./public/index.js')
    const publicProviders = await resolveProviderEntry(createPublicHostModuleProviders, {
      workspaceDir,
      hostModulesDir: workspaceDir ? path.resolve(workspaceDir, 'host_modules') : undefined,
    })
    roles.toolProviders.push(...publicProviders)
  } catch (error) {
    console.error('[host-modules] Failed to load public providers:', error.message)
  }

  if (builtinOnly || !workspaceDir) {
    return roles
  }

  const workspaceRoles = await loadWorkspaceRoles(workspaceDir)
  mergeRoleBuckets(roles, workspaceRoles)
  return roles
}

/**
 * Load host modules from a workspace directory.
 *
 * Discovers and loads tool providers from:
 * 1. Builtin providers (always first)
 * 2. Public shared providers
 * 3. Workspace host_modules directory (if present)
 *
 * Provider ordering: builtin first, public providers after builtin, workspace providers last.
 * First provider handling a tool name wins (createToolRuntime semantics).
 *
 * @param {Object} options
 * @param {string} [options.workspaceDir] - Workspace root for host_modules discovery
 * @param {boolean} [options.builtinOnly] - Skip workspace discovery, builtin only
 * @returns {Promise<Array<Object|Function>>} Ordered array of provider maps or functions
 */
export async function loadHostModules(options = {}) {
  const roles = await loadHostModulesByRole(options)
  return roles.toolProviders
}
