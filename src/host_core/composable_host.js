import { createServer } from 'node:http'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../runtime/index.js'

import {
  createEffectRealizerRuntime,
  createIngressConnectorRuntime,
  createToolRuntime,
} from './tool_runtime.js'

import {
  getConfiguredModules,
  getRequiredCapabilities,
} from './workspace_config.js'

import {
  storageCapability,
} from './capabilities/storage.js'

import {
  speechCapability,
} from './capabilities/speech.js'

import {
  mcpCapability,
} from './capabilities/mcp.js'

import {
  localVectorProviderFromEnv,
} from './providers/local_vector.js'

/**
 * createComposableHost creates a composable host that can attach capabilities
 * and surfaces additively around a stable runtime core.
 *
 * Design principles:
 * - Runtime stays authoritative (orchestrates, governs deterministic flow)
 * - Capabilities stay ordinary (explicit composition, no framework magic)
 * - Surfaces are attachable (same runtime can expose multiple protocols)
 *
 * Usage:
 *   const host = createComposableHost({ workspaceDir })
 *   host.attachSurface(wsSurface())
 *   host.attachCapability(storageCapability({ provider }))
 *   await host.start()
 */
export function createComposableHost({
  workspaceDir,
  port = 4190,
  autoAttachCapabilitiesFromWorkspace = false,
  repoRoot = null,
  callAgent = null,
  defaultModel = '',
  slowAgentWarningMs = 15000,
  parallelMaxConcurrency = null,
} = {}) {
  // Resolve repo root if not provided
  const resolvedRepoRoot = repoRoot || resolveDefaultRepoRoot()

  // Storage for attached capabilities and surfaces
  const attachedCapabilities = []
  const attachedSurfaces = []

  // Runtime lifecycle state
  let runtimeCore = null
  let httpServer = null
  let wsurfaceInstance = null
  let activeWsPath = '/api/runtime/ws'
  let lifecycleState = 'idle' // idle, starting, running, stopping, stopped, error
  let instantiatedCapabilities = [] // Store capability instances for later teardown

  function resolveDefaultRepoRoot() {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    // src/host_core/composable_host.js -> src/host_core -> src -> repo_root
    return resolve(join(__dirname, '..', '..'))
  }

  function attachCapability(capabilityFactory) {
    if (typeof capabilityFactory !== 'function') {
      throw new Error('attachCapability requires a function that returns a capability object')
    }
    attachedCapabilities.push(capabilityFactory)
    return this // Enable chaining
  }

  function attachSurface(surfaceDescriptor) {
    if (!surfaceDescriptor || typeof surfaceDescriptor !== 'object') {
      throw new Error('attachSurface requires a surface descriptor object')
    }
    attachedSurfaces.push(surfaceDescriptor)
    return this // Enable chaining
  }

  function buildCapabilityFactoryFromModuleProvider(provider, moduleConfig = {}, moduleName = '') {
    const normalizedProvider = String(provider ?? '').trim().toLowerCase()

    if (normalizedProvider === 'memory-pgvector') {
      return () => storageCapability({
        provider: localVectorProviderFromEnv(),
      })
    }

    if (normalizedProvider === 'speech-surface') {
      return () => speechCapability()
    }

    if (normalizedProvider === 'mcp' || normalizedProvider === 'mcp-client') {
      const servers = Array.isArray(moduleConfig.servers) ? moduleConfig.servers : []
      return () => mcpCapability({ servers })
    }

    throw new Error(`Unsupported workspace module provider "${provider}" for module "${moduleName}"`)
  }

  function resolveWorkspaceCapabilityEntries(workspaceConfig) {
    const requiredCapabilities = getRequiredCapabilities(workspaceConfig)
    const configuredModules = getConfiguredModules(workspaceConfig)
    const entries = []

    for (const [capabilityName, requirement] of Object.entries(requiredCapabilities)) {
      if (requirement?.required === false) continue

      const moduleName = String(requirement?.provider ?? capabilityName).trim() || capabilityName
      const moduleConfig = configuredModules[moduleName]

      if (!moduleConfig || typeof moduleConfig !== 'object') {
        throw new Error(`Missing module config for required capability "${capabilityName}" (expected module "${moduleName}")`)
      }

      if (String(moduleConfig.mode ?? 'embedded').toLowerCase() === 'external') {
        continue
      }

      const provider = String(moduleConfig.provider ?? '').trim()
      if (!provider) {
        throw new Error(`Module "${moduleName}" must declare a provider`) 
      }

      entries.push({
        capabilityName,
        moduleName,
        provider,
        mode: String(moduleConfig.mode ?? 'embedded').toLowerCase(),
        factory: buildCapabilityFactoryFromModuleProvider(provider, moduleConfig, moduleName),
      })
    }

    return entries
  }

  function buildCapabilityResolution(resolvers) {
    const factories = []
    const workspaceCapabilities = []

    if (autoAttachCapabilitiesFromWorkspace) {
      const resolvedWorkspaceDir = resolvers.resolveWorkspaceDirectory(workspaceDir)
      const workspaceConfig = resolvers.loadWorkspaceConfig(resolvedWorkspaceDir)
      const entries = resolveWorkspaceCapabilityEntries(workspaceConfig)
      for (const entry of entries) {
        factories.push(entry.factory)
        workspaceCapabilities.push({
          capabilityName: entry.capabilityName,
          moduleName: entry.moduleName,
          provider: entry.provider,
          mode: entry.mode,
        })
      }
    }

    factories.push(...attachedCapabilities)
    return {
      factories,
      workspaceCapabilities,
    }
  }

  async function validateWorkspaceCapabilities() {
    const resolvers = createRuntimeResolvers({ repoRoot: resolvedRepoRoot })
    const resolution = buildCapabilityResolution(resolvers)
    const capabilityFactories = resolution.factories

    const summary = {
      capabilities: capabilityFactories.length,
      toolProviders: 0,
      ingressConnectors: 0,
      effectRealizers: 0,
      workspaceCapabilities: resolution.workspaceCapabilities,
    }

    for (const capabilityFactory of capabilityFactories) {
      const capability = await capabilityFactory()
      if (!capability || typeof capability !== 'object') {
        throw new Error('Capability factory must return an object')
      }

      summary.toolProviders += Array.isArray(capability.toolProviders) ? capability.toolProviders.length : 0
      summary.ingressConnectors += Array.isArray(capability.ingressConnectors) ? capability.ingressConnectors.length : 0
      summary.effectRealizers += Array.isArray(capability.effectRealizers) ? capability.effectRealizers.length : 0
    }

    return summary
  }

  async function start() {
    if (lifecycleState !== 'idle' && lifecycleState !== 'stopped') {
      throw new Error(`Cannot start host in state: ${lifecycleState}`)
    }

    lifecycleState = 'starting'
    try {
      const resolvers = createRuntimeResolvers({ repoRoot: resolvedRepoRoot })
      const capabilityResolution = buildCapabilityResolution(resolvers)
      const capabilityFactories = capabilityResolution.factories

      // 1. Instantiate all capabilities and collect their providers
      const allToolProviders = []
      const allIngressConnectors = []
      const allEffectRealizers = []
      const setupHooks = []

      instantiatedCapabilities = [] // Reset for this startup

      for (const capabilityFactory of capabilityFactories) {
        const capability = await capabilityFactory()

        if (!capability || typeof capability !== 'object') {
          throw new Error('Capability factory must return an object')
        }

        instantiatedCapabilities.push(capability) // Store for teardown later

        if (Array.isArray(capability.toolProviders)) {
          allToolProviders.push(...capability.toolProviders)
        }

        if (Array.isArray(capability.ingressConnectors)) {
          allIngressConnectors.push(...capability.ingressConnectors)
        }

        if (Array.isArray(capability.effectRealizers)) {
          allEffectRealizers.push(...capability.effectRealizers)
        }

        if (typeof capability.setup === 'function') {
          setupHooks.push(capability.setup)
        }
      }

      // 2. Run all capability setup hooks
      for (const setupHook of setupHooks) {
        await setupHook()
      }

      // 3. Assemble the three runtimes
      const toolRuntime = allToolProviders.length > 0
        ? createToolRuntime({ providers: allToolProviders })
        : null

      const ingressRuntime = allIngressConnectors.length > 0
        ? createIngressConnectorRuntime({ connectors: allIngressConnectors })
        : null

      const effectRuntime = allEffectRealizers.length > 0
        ? createEffectRealizerRuntime({ realizers: allEffectRealizers })
        : null

      // 4. Create runtime core
      runtimeCore = createRuntimeCore({
        resolvers,
        toolRuntime,
        ingressRuntime,
        effectRuntime,
        callAgent: callAgent || (() => {
          throw new Error('agent transport not configured')
        }),
        defaultModel,
        slowAgentWarningMs,
        parallelMaxConcurrency,
      })

      // 5. Create HTTP server (needed for WS surface)
      httpServer = createServer()

      // 6. Attach surfaces
      for (const surfaceDescriptor of attachedSurfaces) {
        if (surfaceDescriptor.type === 'ws') {
          const wsOptions = surfaceDescriptor.options || {}
          const wsPath = wsOptions.path || '/api/runtime/ws'
          activeWsPath = wsPath

          wsurfaceInstance = createRuntimeWebSocketSurface({
            server: httpServer,
            runtimeCore,
            path: wsPath,
            createSessionId: wsOptions.createSessionId,
          })
        } else {
          // Support extensible surface types in the future
          throw new Error(`Unsupported surface type: ${surfaceDescriptor.type}`)
        }
      }

      // 7. Start the runtime
      await runtimeCore.start({ workspaceDir })

      // 8. Listen on port
      await new Promise((resolve, reject) => {
        httpServer.listen(port, '127.0.0.1', () => {
          resolve()
        })
        httpServer.on('error', reject)
      })

      lifecycleState = 'running'

      return {
        port,
        wsPath: activeWsPath,
        runtimeCore,
        server: httpServer,
      }
    } catch (err) {
      lifecycleState = 'error'
      // Attempt cleanup on startup failure
      try {
        await shutdown()
      } catch {}
      throw err
    }
  }

  async function shutdown() {
    if (lifecycleState === 'idle' || lifecycleState === 'stopped') {
      return // Already shut down
    }

    lifecycleState = 'stopping'

    try {
      // 1. Close surfaces
      if (wsurfaceInstance) {
        try {
          wsurfaceInstance.close()
        } catch {}
      }

      // 2. Stop runtime
      if (runtimeCore && runtimeCore.isActive()) {
        try {
          runtimeCore.stop()
        } catch {}
      }

      // 3. Close HTTP server
      if (httpServer) {
        httpServer.closeAllConnections?.() // Close all connections
        await new Promise((resolve) => {
          httpServer.close(() => resolve())
        })
      }

      // 4. Run all capability teardown hooks in reverse order
      for (const capability of [...instantiatedCapabilities].reverse()) {
        if (typeof capability?.teardown === 'function') {
          try {
            await capability.teardown()
          } catch (err) {
            // Suppress teardown errors to allow other teardowns to run
            console.error('Capability teardown error:', err?.message ?? err)
          }
        }
      }

      lifecycleState = 'stopped'
    } catch (err) {
      lifecycleState = 'stopped'
      throw err
    }
  }

  function getStatus() {
    return {
      state: lifecycleState,
      port,
      workspaceDir,
      runtimeActive: runtimeCore?.isActive() ?? false,
    }
  }

  return Object.freeze({
    attachCapability,
    attachSurface,
    validateWorkspaceCapabilities,
    start,
    shutdown,
    getStatus,
  })
}
