import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadWorkspaceNextVConfig } from '../src/host_core/workspace_config.js'

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
    writeFileSync(join(dir, name), content, 'utf8')
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
