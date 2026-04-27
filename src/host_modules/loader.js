import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProviderValue(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'function' || isPlainObject(value)) return [value]
  return []
}

async function resolveProviderEntry(entry, context) {
  if (typeof entry === 'function') {
    const resolved = await entry(context)
    return normalizeProviderValue(resolved)
  }
  return normalizeProviderValue(entry)
}

async function loadWorkspaceProviders(workspaceDir) {
  const hostModulesDir = path.resolve(workspaceDir, 'host_modules')
  if (!fs.existsSync(hostModulesDir)) return []

  const indexPath = path.resolve(hostModulesDir, 'index.js')
  if (!fs.existsSync(indexPath)) {
    console.warn('[host-modules] host_modules exists but no index.js found; skipping workspace providers')
    return []
  }

  try {
    const loaded = await import(pathToFileURL(indexPath).href)
    const context = {
      workspaceDir,
      hostModulesDir,
    }

    const providers = []

    if (loaded.default != null) {
      providers.push(...await resolveProviderEntry(loaded.default, context))
    }

    if (loaded.createHostModules != null) {
      providers.push(...await resolveProviderEntry(loaded.createHostModules, context))
    }

    if (loaded.createProviders != null) {
      providers.push(...await resolveProviderEntry(loaded.createProviders, context))
    }

    if (providers.length === 0) {
      for (const [name, value] of Object.entries(loaded)) {
        if (name === 'default' || name === 'createHostModules' || name === 'createProviders') continue
        if (!name.startsWith('create')) continue
        providers.push(...await resolveProviderEntry(value, context))
      }
    }

    return providers.filter(Boolean)
  } catch (error) {
    console.error('[host-modules] Failed to load workspace providers:', error.message)
    return []
  }
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
  const providers = []
  const { workspaceDir, builtinOnly = false } = options

  // Always include builtin provider first
  try {
    const { createRuntimeBuiltinToolProvider } = await import('./builtin/index.js')
    providers.push(createRuntimeBuiltinToolProvider())
  } catch (error) {
    console.error('[host-modules] Failed to load builtin provider:', error.message)
    // Continue without builtin; caller may have other providers
  }

  // builtinOnly intentionally means builtin only.
  if (builtinOnly) {
    return providers
  }

  // Include public providers after builtin providers
  try {
    const { createPublicHostModuleProviders } = await import('./public/index.js')
    const publicProviders = await resolveProviderEntry(createPublicHostModuleProviders, {
      workspaceDir,
      hostModulesDir: workspaceDir ? path.resolve(workspaceDir, 'host_modules') : undefined,
    })
    providers.push(...publicProviders)
  } catch (error) {
    console.error('[host-modules] Failed to load public providers:', error.message)
  }

  // Skip workspace discovery if disabled
  if (builtinOnly || !workspaceDir) {
    return providers
  }

  providers.push(...await loadWorkspaceProviders(workspaceDir))

  return providers
}
