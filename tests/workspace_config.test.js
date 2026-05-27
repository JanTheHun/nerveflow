import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getConfiguredExternals,
  getConfiguredModelsMap,
  getConfiguredAgentProfiles,
  getConfiguredRuntimePreload,
  getConfiguredTransportsMap,
  loadWorkspaceNextVConfig,
  validateConfigReferences,
  validateNoForbiddenAgentFields,
} from '../src/host_core/workspace_config.js'

function toWorkspaceDisplayPathFactory(workspaceDir) {
  return (targetPath) => relative(workspaceDir.absolutePath, targetPath).replace(/\\/g, '/')
}

function resolvePathFromBaseDirectory(baseDir, rawPath) {
  const absolutePath = resolve(baseDir, String(rawPath ?? ''))
  return {
    absolutePath,
    relativePath: relative(baseDir, absolutePath).replace(/\\/g, '/'),
  }
}

function readJsonObjectFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function createWorkspace(files) {
  const dir = mkdtempSync(join(tmpdir(), 'nextv-workspace-config-'))
  for (const [name, content] of Object.entries(files)) {
    const targetPath = join(dir, name)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, content, 'utf8')
  }
  return {
    absolutePath: dir,
    relativePath: '.',
  }
}

function loadConfig(workspaceDir) {
  return loadWorkspaceNextVConfig({
    workspaceDir,
    toWorkspaceDisplayPath: toWorkspaceDisplayPathFactory(workspaceDir),
    resolvePathFromBaseDirectory,
    readJsonObjectFile,
  })
}

test('loads tools allow-list and aliases from nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      tools: {
        allow: ['tool_a', 'tool_b'],
        aliases: {
          helper: 'tool_a',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.tools.status, 'loaded')
    assert.deepEqual(Array.from(config.tools.allow), ['tool_a', 'tool_b'])
    assert.deepEqual(config.tools.aliases, { helper: 'tool_a' })
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads workspace config from nerve.json when nextv.json is absent', () => {
  const workspaceDir = createWorkspace({
    'nerve.json': JSON.stringify({
      tools: {
        allow: ['tool_from_nerve'],
      },
      models: {
        base: {
          model: 'llama3.2',
          transport: 'ollama',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.nextv.status, 'loaded')
    assert.equal(config.nextv.file, 'nerve.json')
    assert.deepEqual(Array.from(config.tools.allow), ['tool_from_nerve'])
    assert.equal(config.models.map.base.model, 'llama3.2')
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('prefers nerve.json over nextv.json when both are present', () => {
  const workspaceDir = createWorkspace({
    'nerve.json': JSON.stringify({
      transports: {
        ollama: {
          provider: 'ollama',
          base_url: 'http://nerve:11434',
        },
      },
    }),
    'nextv.json': JSON.stringify({
      transports: {
        ollama: {
          provider: 'ollama',
          base_url: 'http://nextv:11434',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    const transports = getConfiguredTransportsMap(config)
    assert.equal(config.nextv.file, 'nerve.json')
    assert.equal(transports.ollama.base_url, 'http://nerve:11434')
    assert.match(config.transports.source, /nerve\.json#transports/)
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('nextv.json toolsConfig overrides inline tools block', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      tools: {
        allow: ['inline_tool'],
        aliases: {
          helper: 'inline_tool',
        },
      },
      toolsConfig: './tools.custom.json',
    }),
    'tools.custom.json': JSON.stringify({
      allow: ['external_tool'],
      aliases: {
        helper: 'external_tool',
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.deepEqual(Array.from(config.tools.allow), ['external_tool'])
    assert.deepEqual(config.tools.aliases, { helper: 'external_tool' })
    assert.equal(config.tools.source, 'tools.custom.json')
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('nextv.json toolsConfig supports alias chains', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      tools: {
        allow: ['inline_tool'],
        aliases: {
          helper: 'inline_tool',
        },
      },
      toolsConfig: './tools.custom.json',
    }),
    'tools.custom.json': JSON.stringify({
      allow: ['leaf_tool'],
      aliases: {
        alias_a: 'alias_b',
        alias_b: 'leaf_tool',
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.deepEqual(Array.from(config.tools.allow), ['leaf_tool'])
    assert.deepEqual(config.tools.aliases, {
      alias_a: 'alias_b',
      alias_b: 'leaf_tool',
    })
    assert.equal(config.tools.source, 'tools.custom.json')
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects invalid tools allow-list shape', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      tools: {
        allow: { bad: true },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#tools: allow\/tools must be an array of strings\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects tools aliases with cycles', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      tools: {
        aliases: {
          a: 'b',
          b: 'a',
        },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /aliases contain a cycle/,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects tools aliases with self-reference', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      tools: {
        aliases: {
          loop: 'loop',
        },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /aliases contain a cycle/,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads minimal effects declaration from nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      effects: ['heartbeat', 'gpio_write'],
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.effects.status, 'loaded')
    assert.deepEqual(Object.keys(config.effects.map), ['heartbeat', 'gpio_write'])
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads bound effects declaration from nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      effects: {
        heartbeat: {
          kind: 'mqtt',
          topic: 'pulse',
          format: 'text',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.effects.status, 'loaded')
    assert.equal(config.effects.map.heartbeat.kind, 'mqtt')
    assert.equal(config.effects.map.heartbeat.topic, 'pulse')
    assert.equal(config.effects.map.heartbeat.format, 'text')
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects invalid effects declaration format', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      effects: {
        heartbeat: {
          format: 'html',
        },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#effects: effect channel "heartbeat\.format" must be one of text, console, voice, visual, json, interaction\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('normalizes effectsPolicy from nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      effectsPolicy: '  STRICT  ',
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.nextv.config.effectsPolicy, 'strict')
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects invalid effectsPolicy in nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      effectsPolicy: 'ignore',
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#effectsPolicy must be either "warn" or "strict" when provided\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads capability requirements from nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      requires: {
        speech_to_text: true,
        text_to_speech: 'piper',
        email: {
          required: false,
          provider: 'smtp',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.requires.status, 'loaded')
    assert.deepEqual(config.requires.map, {
      speech_to_text: {
        required: true,
        provider: null,
      },
      text_to_speech: {
        required: true,
        provider: 'piper',
      },
      email: {
        required: false,
        provider: 'smtp',
      },
    })
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects invalid requires declaration shape', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      requires: ['speech_to_text'],
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#requires must be an object map of capability -> requirement\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads workspace module bindings from nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        whisper: {
          mode: 'EXTERNAL',
          endpoint: '${WHISPER_HOST}',
        },
        piper: {
          mode: 'embedded',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.modules.status, 'loaded')
    assert.deepEqual(config.modules.map, {
      whisper: {
        mode: 'external',
        endpoint: '${WHISPER_HOST}',
      },
      piper: {
        mode: 'embedded',
      },
    })
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects invalid module mode in nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        whisper: {
          mode: 'daemon',
        },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#modules: module "whisper\.mode" must be either "embedded" or "external"\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads mcp module config from nextv.json configPath reference', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        mcp: {
          provider: 'mcp',
          mode: 'embedded',
          detectToolConflicts: true,
          configPath: './capabilities/mcp/mcp.json',
        },
      },
    }),
    'capabilities/mcp/mcp.json': JSON.stringify({
      servers: [
        {
          name: 'local-mcp',
          transport: 'stdio',
          config: {
            command: 'node',
            args: ['./capabilities/mcp/servers/local-mcp.mjs'],
          },
        },
      ],
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.modules.status, 'loaded')
    assert.deepEqual(config.modules.map.mcp, {
      provider: 'mcp',
      mode: 'embedded',
      detectToolConflicts: true,
      configPath: './capabilities/mcp/mcp.json',
      servers: [
        {
          name: 'local-mcp',
          transport: 'stdio',
          config: {
            command: 'node',
            args: ['./capabilities/mcp/servers/local-mcp.mjs'],
          },
        },
      ],
    })
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('loads mcp module config from nextv.json legacy config string reference', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        mcp: {
          provider: 'mcp',
          mode: 'embedded',
          detectToolConflicts: true,
          config: './capabilities/mcp/mcp.json',
        },
      },
    }),
    'capabilities/mcp/mcp.json': JSON.stringify({
      servers: [],
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    assert.equal(config.modules.status, 'loaded')
    assert.equal(config.modules.map.mcp.provider, 'mcp')
    assert.equal(config.modules.map.mcp.configPath, './capabilities/mcp/mcp.json')
    assert.equal(Object.prototype.hasOwnProperty.call(config.modules.map.mcp, 'config'), false)
    assert.equal(config.modules.map.mcp.mode, 'embedded')
    assert.equal(config.modules.map.mcp.detectToolConflicts, true)
    assert.deepEqual(config.modules.map.mcp.servers, [])
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects inline mcp fields when external module config reference is used', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        mcp: {
          provider: 'mcp',
          configPath: './capabilities/mcp/mcp.json',
          servers: [],
        },
      },
    }),
    'capabilities/mcp/mcp.json': JSON.stringify({
      servers: [],
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#modules: module "mcp" must not define inline MCP fields \(servers\) when external config is used\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects missing module configPath file', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        mcp: {
          provider: 'mcp',
          configPath: './missing-mcp.json',
        },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#modules: module "mcp\.configPath" file not found: missing-mcp\.json/,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('rejects non-server fields in external MCP module config', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      modules: {
        mcp: {
          provider: 'mcp',
          mode: 'embedded',
          detectToolConflicts: true,
          configPath: './capabilities/mcp/mcp.json',
        },
      },
    }),
    'capabilities/mcp/mcp.json': JSON.stringify({
      detectToolConflicts: true,
      servers: [],
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /nextv\.json#modules: module "mcp\.configPath" for MCP supports only "servers"; found: detectToolConflicts\./,
    )
  } finally {
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('getConfiguredExternals returns normalized nextv.json externals only', () => {
  const workspaceConfig = {
    nextv: {
      config: {
        externals: [' user_message ', 'reset_chat', '', 'user_message', null],
      },
      timers: [
        { event: 'timer_tick', interval: 1000 },
      ],
    },
  }

  assert.deepEqual(getConfiguredExternals(workspaceConfig), ['user_message', 'reset_chat'])
})

test('getConfiguredExternals returns empty list when externals are missing', () => {
  assert.deepEqual(getConfiguredExternals({ nextv: { config: {} } }), [])
  assert.deepEqual(getConfiguredExternals(null), [])
})

test('loads models layer from nextv.json with valid structure', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      models: {
        'local-llama': {
          model: 'llama2',
          transport: 'ollama',
        },
        'remote-openai': {
          model: 'gpt-4-turbo',
          transport: 'openai',
        },
      },
    }),
  })

  const config = loadConfig(workspaceDir)
  const modelsMap = getConfiguredModelsMap(config)

  assert.deepEqual(Object.keys(modelsMap).sort(), ['local-llama', 'remote-openai'])
  assert.equal(modelsMap['local-llama'].model, 'llama2')
  assert.equal(modelsMap['local-llama'].transport, 'ollama')
  assert.equal(modelsMap['remote-openai'].model, 'gpt-4-turbo')
  assert.equal(modelsMap['remote-openai'].transport, 'openai')
})

test('loads agent profiles with model references', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      models: {
        'local-llama': {
          model: 'llama2',
          transport: 'ollama',
        },
      },
      agents: {
        profiles: {
          qa_agent: {
            model: 'local-llama',
            instructions: 'You are a QA expert.',
            tools: ['get_test_status', 'run_test'],
          },
        },
      },
    }),
  })

  const config = loadConfig(workspaceDir)
  const profiles = getConfiguredAgentProfiles(config)

  assert(profiles.qa_agent)
  assert.equal(profiles.qa_agent.model, 'local-llama')
  assert.equal(profiles.qa_agent.instructions, 'You are a QA expert.')
  assert.deepEqual(profiles.qa_agent.tools, ['get_test_status', 'run_test'])
})

test('validateConfigReferences reports invalid transport names in models', () => {
  // When a transports registry is loaded, unknown labels are always errors.
  const config = {
    models: {
      map: {
        'model-a': { model: 'a', transport: 'ollama' },
        'model-b': { model: 'b', transport: 'invalid-transport' },
      },
      status: 'ok',
      source: 'nextv.json',
    },
    transports: {
      map: { ollama: { provider: 'ollama' } },
      status: 'ok',
      source: 'transports.json',
    },
    agents: { profiles: {} },
  }

  const issues = validateConfigReferences(config)

  const invalidTransport = issues.find((i) => i.code === 'TRANSPORT_NOT_FOUND')
  assert(invalidTransport)
  assert.equal(invalidTransport.model, 'model-b')
  assert.equal(invalidTransport.transport, 'invalid-transport')
})

test('validateConfigReferences allows agents to reference unregistered model names', () => {
  const config = {
    models: {
      map: {
        'model-a': { model: 'a', transport: 'ollama' },
      },
      status: 'ok',
      source: 'nextv.json',
    },
    agents: {
      profiles: {
        'agent-1': { model: 'model-a', instructions: 'test', tools: [] },
        'agent-2': { model: 'direct-model-name', instructions: 'test', tools: [] },
      },
      status: 'ok',
      source: 'agents.json',
    },
  }

  const issues = validateConfigReferences(config)
  // Should not report errors for unregistered models (they can be used as direct names)
  const modelRefErrors = issues.filter((i) => i.code === 'AGENT_INVALID_MODEL')
  assert.equal(modelRefErrors.length, 0)
})

test('validateNoForbiddenAgentFields rejects transport in agent profiles', () => {
  const config = {
    agents: {
      profiles: {
        'agent-1': {
          model: 'model-a',
          transport: 'ollama',
          instructions: 'test',
          tools: [],
        },
      },
    },
  }

  const issues = validateNoForbiddenAgentFields(config)
  assert(issues.length > 0)
  const forbidden = issues.find((i) => i.agent === 'agent-1')
  assert(forbidden)
  assert.equal(forbidden.field, 'transport')
  assert.equal(forbidden.code, 'AGENT_INVALID_FIELD')
})

test('validateNoForbiddenAgentFields passes when only allowed fields are present', () => {
  const config = {
    agents: {
      profiles: {
        'agent-1': {
          model: 'model-a',
          instructions: 'test',
          tools: [],
        },
      },
    },
  }

  const issues = validateNoForbiddenAgentFields(config)
  assert.equal(issues.length, 0)
})

test('getConfiguredModelsMap returns empty map when models section missing', () => {
  const config = {
    agents: { profiles: {} },
  }

  const modelsMap = getConfiguredModelsMap(config)
  assert.deepEqual(modelsMap, {})
})

test('getConfiguredAgentProfiles returns empty profiles when agents section missing', () => {
  const config = {
    models: { map: {} },
  }

  const profiles = getConfiguredAgentProfiles(config)
  assert.deepEqual(profiles, {})
})

test('loads transports layer from inline nextv.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      transports: {
        ollama: { provider: 'ollama', base_url: 'http://localhost:11434', timeout_ms: 30000 },
        'llama.cpp': { provider: 'llama.cpp', endpoint: 'http://localhost:8080' },
      },
    }),
  })

  const config = loadConfig(workspaceDir)
  const transports = getConfiguredTransportsMap(config)

  assert.deepEqual(Object.keys(transports).sort(), ['llama.cpp', 'ollama'])
  assert.equal(transports.ollama.provider, 'ollama')
  assert.equal(transports.ollama.timeout_ms, 30000)
  assert.equal(transports['llama.cpp'].provider, 'llama.cpp')
  assert.equal(config.transports.status, 'loaded')
  assert.match(config.transports.source, /nextv\.json#transports/)
})

test('loads transports layer from standalone transports.json', () => {
  const workspaceDir = createWorkspace({
    'transports.json': JSON.stringify({
      transports: {
        openai: { provider: 'openai', timeout_ms: 20000 },
      },
    }),
  })

  const config = loadConfig(workspaceDir)
  const transports = getConfiguredTransportsMap(config)

  assert.equal(transports.openai.provider, 'openai')
  assert.equal(config.transports.status, 'loaded')
  assert.match(config.transports.source, /transports\.json/)
})

test('transports.json bare map (without wrapper key) is also accepted', () => {
  const workspaceDir = createWorkspace({
    'transports.json': JSON.stringify({
      ollama: { provider: 'ollama' },
    }),
  })

  const config = loadConfig(workspaceDir)
  const transports = getConfiguredTransportsMap(config)

  assert.equal(transports.ollama.provider, 'ollama')
})

test('transports parser rejects missing provider field', () => {
  const workspaceDir = createWorkspace({
    'transports.json': JSON.stringify({
      'bad-transport': { timeout_ms: 5000 },
    }),
  })

  assert.throws(() => loadConfig(workspaceDir), /provider.*must be a non-empty string/)
})

test('validateConfigReferences uses loaded transports registry when present', () => {
  const config = {
    models: { map: { 'm': { model: 'x', transport: 'custom' } } },
    transports: { map: { custom: { provider: 'custom-provider' } } },
    agents: { profiles: {} },
  }
  const issues = validateConfigReferences(config)
  assert.equal(issues.length, 0, 'custom transport defined in registry should not produce issues')
})

test('validateConfigReferences falls back to builtin set when transports registry is absent', () => {
  const config = {
    models: { map: { 'm': { model: 'x', transport: 'ollama' } } },
    agents: { profiles: {} },
  }
  const issues = validateConfigReferences(config)
  assert.equal(issues.length, 0, 'ollama is a builtin transport')
})

test('validateConfigReferences detects unknown transport without registry', () => {
  const config = {
    models: { map: { 'm': { model: 'x', transport: 'typo-transport' } } },
    agents: { profiles: {} },
  }
  const issues = validateConfigReferences(config)
  assert.equal(issues.filter((i) => i.code === 'TRANSPORT_NOT_FOUND').length, 1)
})

test('getConfiguredTransportsMap returns empty map when transports section missing', () => {
  const config = { models: { map: {} }, agents: { profiles: {} } }
  assert.deepEqual(getConfiguredTransportsMap(config), {})
})

test('inline nextv.json transports take precedence over transports.json', () => {
  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      transports: { ollama: { provider: 'ollama', base_url: 'http://inline:11434' } },
    }),
    'transports.json': JSON.stringify({
      transports: { ollama: { provider: 'ollama', base_url: 'http://file:11434' } },
    }),
  })

  const config = loadConfig(workspaceDir)
  const transports = getConfiguredTransportsMap(config)
  assert.equal(transports.ollama.base_url, 'http://inline:11434')
  assert.match(config.transports.source, /nextv\.json#transports/)
})

test('getConfiguredRuntimePreload defaults to none when not specified', () => {
  const config = loadConfig(createWorkspace({ 'nextv.json': JSON.stringify({ entrypointPath: 'entry.nrv' }) }))
  assert.equal(getConfiguredRuntimePreload(config), 'none')
})

test('getConfiguredRuntimePreload reads valid value from nextv.json', () => {
  const config = loadConfig(createWorkspace({
    'nextv.json': JSON.stringify({ entrypointPath: 'entry.nrv', runtime: { preload: 'marked' } }),
  }))
  assert.equal(getConfiguredRuntimePreload(config), 'marked')
})

test('getConfiguredRuntimePreload ignores invalid value', () => {
  const config = loadConfig(createWorkspace({
    'nextv.json': JSON.stringify({ entrypointPath: 'entry.nrv', runtime: { preload: 'bogus' } }),
  }))
  assert.equal(getConfiguredRuntimePreload(config), 'none')
})

test('nextv.json supports env placeholders in transport fields', () => {
  const previous = process.env.NEXTV_TEST_API_KEY
  process.env.NEXTV_TEST_API_KEY = 'secret-value'

  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      transports: {
        groq: {
          provider: 'openai_compat',
          baseUrl: 'https://api.groq.com/openai',
          apiKey: '${env:NEXTV_TEST_API_KEY}',
        },
      },
      models: {
        m: {
          model: 'openai/gpt-oss-20b',
          transport: 'groq',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    const transports = getConfiguredTransportsMap(config)
    assert.equal(transports.groq.apiKey, 'secret-value')
  } finally {
    if (previous == null) {
      delete process.env.NEXTV_TEST_API_KEY
    } else {
      process.env.NEXTV_TEST_API_KEY = previous
    }
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('nextv.json transport apiKey env placeholder falls back to empty when variable is missing', () => {
  const previous = process.env.NEXTV_TEST_MISSING
  delete process.env.NEXTV_TEST_MISSING

  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      transports: {
        groq: {
          provider: 'openai_compat',
          baseUrl: 'https://api.groq.com/openai',
          apiKey: '${env:NEXTV_TEST_MISSING}',
        },
      },
    }),
  })

  try {
    const config = loadConfig(workspaceDir)
    const transports = getConfiguredTransportsMap(config)
    assert.equal(transports.groq.apiKey, '')
  } finally {
    if (previous == null) {
      delete process.env.NEXTV_TEST_MISSING
    } else {
      process.env.NEXTV_TEST_MISSING = previous
    }
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})

test('nextv.json non-transport env placeholder still throws when variable is missing', () => {
  const previous = process.env.NEXTV_TEST_MISSING_MODEL
  delete process.env.NEXTV_TEST_MISSING_MODEL

  const workspaceDir = createWorkspace({
    'nextv.json': JSON.stringify({
      models: {
        m: {
          model: '${env:NEXTV_TEST_MISSING_MODEL}',
          transport: 'ollama',
        },
      },
    }),
  })

  try {
    assert.throws(
      () => loadConfig(workspaceDir),
      /missing environment variable "NEXTV_TEST_MISSING_MODEL"/,
    )
  } finally {
    if (previous == null) {
      delete process.env.NEXTV_TEST_MISSING_MODEL
    } else {
      process.env.NEXTV_TEST_MISSING_MODEL = previous
    }
    rmSync(workspaceDir.absolutePath, { recursive: true, force: true })
  }
})
