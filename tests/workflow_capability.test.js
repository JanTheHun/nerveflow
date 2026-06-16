import { test } from 'node:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { createComposableHost } from '../src/host_core/composable_host.js'

const REPO_ROOT = resolve(process.cwd())

async function createTempWorkspace({ nextvConfig, entrySource, extraFiles = [] }) {
  const workspaceRoot = await mkdtemp(join(REPO_ROOT, '.tmp-workflow-capability-'))
  const workspaceRelativePath = relative(REPO_ROOT, workspaceRoot).replace(/\\/g, '/')
  await writeFile(join(workspaceRoot, 'nextv.json'), `${JSON.stringify(nextvConfig, null, 2)}\n`, 'utf8')
  await writeFile(join(workspaceRoot, 'entry.nrv'), entrySource, 'utf8')

  for (const file of extraFiles) {
    if (!file || typeof file !== 'object') continue
    const relativePath = String(file.path ?? '').trim()
    if (!relativePath) continue
    const absolutePath = join(workspaceRoot, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, String(file.content ?? ''), 'utf8')
  }

  return {
    workspaceRoot,
    workspaceRelativePath,
  }
}

async function waitForCondition(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const startMs = Date.now()
  while (Date.now() - startMs < timeoutMs) {
    if (predicate()) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs))
  }
  throw new Error('Condition not met before timeout')
}

test('workflow capability module validates and wires tool provider', { timeout: 10000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        'music.study_artist': {
          required: true,
          provider: 'music-study-artist',
        },
      },
      modules: {
        'music-study-artist': {
          provider: 'workflow',
          mode: 'embedded',
          entrypointPath: './capabilities/workflows/study_artist.nrv',
        },
      },
    },
    entrySource: 'on external "user_message"\n  output text "ok"\nend\n',
    extraFiles: [
      {
        path: 'capabilities/workflows/study_artist.nrv',
        content: [
          'on external "tool_workflow"',
          '  return {',
          '    status: "ready",',
          '    action: null,',
          '    data: { source: "workflow" }',
          '  }',
          'end',
        ].join('\n'),
      },
    ],
  })

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port: 41984,
  })

  try {
    const summary = await host.validateWorkspaceCapabilities()
    assert.equal(summary.toolProviders > 0, true)
    assert.equal(
      summary.workspaceCapabilities.some((entry) => entry.capabilityName === 'music.study_artist' && entry.provider === 'workflow'),
      true,
    )
  } finally {
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('workflow capability recursion is blocked with deterministic error code', { timeout: 10000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        'music.study_artist': {
          required: true,
          provider: 'music-study-artist',
        },
      },
      modules: {
        'music-study-artist': {
          provider: 'workflow',
          mode: 'embedded',
          entrypointPath: './capabilities/workflows/study_artist.nrv',
        },
      },
    },
    entrySource: [
      'on external "user_message"',
      '  response = tool("music.study_artist", { artist: event.value })',
      '  output text "ok"',
      'end',
    ].join('\n'),
    extraFiles: [
      {
        path: 'capabilities/workflows/study_artist.nrv',
        content: [
          'on external "tool_workflow"',
          '  nested = tool("music.study_artist", { artist: "recursive" })',
          '  return {',
          '    status: "ready",',
          '    action: null,',
          '    data: nested',
          '  }',
          'end',
        ].join('\n'),
      },
    ],
  })

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port: 41985,
  })

  const runtimeErrors = []

  try {
    const result = await host.start()
    result.runtimeCore.eventBus.subscribe((eventName, payload) => {
      if (eventName === 'nextv_error') {
        runtimeErrors.push(payload)
      }
    })

    result.runtimeCore.enqueue({
      type: 'user_message',
      source: 'external',
      value: 'trigger recursion',
    })

    await waitForCondition(() => runtimeErrors.length > 0, { timeoutMs: 5000, intervalMs: 50 })

    assert.equal(
      runtimeErrors.some((entry) => String(entry?.code ?? '').trim() === 'WORKFLOW_TOOL_RECURSION'),
      true,
    )
  } finally {
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('workflow capability depth limit is blocked with deterministic error code', { timeout: 10000 }, async () => {
  const previousDepthEnv = process.env.NERVEFLOW_WORKFLOW_TOOL_MAX_DEPTH
  process.env.NERVEFLOW_WORKFLOW_TOOL_MAX_DEPTH = '3'

  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        'da.step': { required: true, provider: 'da-step' },
        'db.step': { required: true, provider: 'db-step' },
        'dc.step': { required: true, provider: 'dc-step' },
        'dd.step': { required: true, provider: 'dd-step' },
      },
      modules: {
        'da-step': {
          provider: 'workflow',
          mode: 'embedded',
          entrypointPath: './capabilities/workflows/da_step.nrv',
        },
        'db-step': {
          provider: 'workflow',
          mode: 'embedded',
          entrypointPath: './capabilities/workflows/db_step.nrv',
        },
        'dc-step': {
          provider: 'workflow',
          mode: 'embedded',
          entrypointPath: './capabilities/workflows/dc_step.nrv',
        },
        'dd-step': {
          provider: 'workflow',
          mode: 'embedded',
          entrypointPath: './capabilities/workflows/dd_step.nrv',
        },
      },
    },
    entrySource: [
      'on external "user_message"',
      '  response = tool("da.step", { message: event.value })',
      '  output text "ok"',
      'end',
    ].join('\n'),
    extraFiles: [
      {
        path: 'capabilities/workflows/da_step.nrv',
        content: [
          'on external "tool_workflow"',
          '  nested = tool("db.step", { step: "two" })',
          '  return { status: "ready", action: null, data: nested }',
          'end',
        ].join('\n'),
      },
      {
        path: 'capabilities/workflows/db_step.nrv',
        content: [
          'on external "tool_workflow"',
          '  nested = tool("dc.step", { step: "three" })',
          '  return { status: "ready", action: null, data: nested }',
          'end',
        ].join('\n'),
      },
      {
        path: 'capabilities/workflows/dc_step.nrv',
        content: [
          'on external "tool_workflow"',
          '  nested = tool("dd.step", { step: "four" })',
          '  return { status: "ready", action: null, data: nested }',
          'end',
        ].join('\n'),
      },
      {
        path: 'capabilities/workflows/dd_step.nrv',
        content: [
          'on external "tool_workflow"',
          '  return { status: "ready", action: null, data: { depth: 4 } }',
          'end',
        ].join('\n'),
      },
    ],
  })

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port: 41986,
  })

  const runtimeErrors = []

  try {
    const result = await host.start()
    result.runtimeCore.eventBus.subscribe((eventName, payload) => {
      if (eventName === 'nextv_error') {
        runtimeErrors.push(payload)
      }
    })

    result.runtimeCore.enqueue({
      type: 'user_message',
      source: 'external',
      value: 'trigger depth overflow',
    })

    await waitForCondition(() => runtimeErrors.length > 0, { timeoutMs: 5000, intervalMs: 50 })

    assert.equal(
      runtimeErrors.some((entry) => String(entry?.code ?? '').trim() === 'WORKFLOW_TOOL_DEPTH_EXCEEDED'),
      true,
    )
  } finally {
    if (previousDepthEnv == null) {
      delete process.env.NERVEFLOW_WORKFLOW_TOOL_MAX_DEPTH
    } else {
      process.env.NERVEFLOW_WORKFLOW_TOOL_MAX_DEPTH = previousDepthEnv
    }
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})