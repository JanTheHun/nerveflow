import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Load host modules from a workspace directory.
 *
 * Discovers and loads tool providers from:
 * 1. Builtin providers (always first)
 * 2. Workspace host_modules directory (if present)
 *
 * Provider ordering: builtin first, workspace providers after.
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

  // Skip workspace discovery if disabled
  if (builtinOnly || !workspaceDir) {
    return providers
  }

  // Discover workspace providers in host_modules directory
  const hostModulesDir = path.resolve(workspaceDir, 'host_modules')
  if (!fs.existsSync(hostModulesDir)) {
    // Non-fatal: workspace may not have custom providers
    return providers
  }

  // Load provider files from host_modules (future extension point)
  // For now, workspace-level provider discovery is deferred pending use case
  // In future: scan for index.js or provider.js files
  // providers.push(...loadedWorkspaceProviders)

  return providers
}
