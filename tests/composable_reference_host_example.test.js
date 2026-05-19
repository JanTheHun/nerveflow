import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(process.cwd())

test('composable reference host fails clearly when memory capability is declared without MEMORY_DB_URL', async () => {
  const workspaceRoot = await mkdtemp(join(REPO_ROOT, '.tmp-composable-reference-'))
  const workspaceRelativePath = relative(REPO_ROOT, workspaceRoot).replace(/\\/g, '/')

  const nextvConfig = {
    entrypointPath: 'entry.nrv',
    externals: ['user_message'],
    requires: {
      memory: {
        required: true,
        provider: 'memory',
      },
    },
    modules: {
      memory: {
        provider: 'memory-pgvector',
        mode: 'embedded',
      },
    },
  }

  await writeFile(join(workspaceRoot, 'nextv.json'), `${JSON.stringify(nextvConfig, null, 2)}\n`, 'utf8')
  await writeFile(join(workspaceRoot, 'entry.nrv'), 'on external "user_message"\n  output text "ok"\nend\n', 'utf8')

  const env = {
    ...process.env,
    WORKSPACE_DIR: workspaceRelativePath,
    MEMORY_DB_URL: '',
  }

  try {
    const result = spawnSync(
      process.execPath,
      ['examples/composable-reference-host/server.js'],
      {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
      },
    )

    assert.equal(result.status, 1)
    assert.match(
      result.stderr,
      /createMemoryProvider: pgUrl required via config or MEMORY_DB_URL env/i,
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
