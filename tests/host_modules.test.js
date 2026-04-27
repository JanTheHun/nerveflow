import test from 'node:test'
import assert from 'node:assert'
import { loadHostModules } from '../src/host_modules/index.js'
import { createToolRuntime } from '../src/host_core/index.js'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')

test('loadHostModules loads builtin providers', async (t) => {
  const providers = await loadHostModules({ builtinOnly: true })
  assert(Array.isArray(providers), 'providers must be an array')
  assert(providers.length > 0, 'should have at least builtin provider')

  const builtin = providers[0]
  assert(builtin.get_time, 'builtin should have get_time')
  assert(builtin.http_fetch, 'builtin should have http_fetch')
  assert(builtin.rss_fetch, 'builtin should have rss_fetch')
})

test('loadHostModules includes public shared providers', async () => {
  const providers = await loadHostModules({ workspaceDir: repoRoot })
  assert(Array.isArray(providers), 'providers must be an array')
  const hasStoreTool = providers.some((provider) => (
    provider && typeof provider === 'object' && typeof provider.store_file_json === 'function'
  ))
  assert.equal(hasStoreTool, true, 'public provider should expose store_file_json')
})

test('loadHostModules with missing workspaceDir is non-fatal', async (t) => {
  const providers = await loadHostModules({ workspaceDir: '/nonexistent/path' })
  assert(Array.isArray(providers), 'should still return providers array')
  assert(providers.length > 0, 'builtin provider should be included')
})

test('loadHostModules with builtinOnly skips workspace discovery', async (t) => {
  const providers = await loadHostModules({
    workspaceDir: repoRoot,
    builtinOnly: true,
  })
  assert(Array.isArray(providers), 'providers must be an array')
  // Builtin only, so exactly one provider
  assert(providers.length === 1, 'should have only builtin provider when builtinOnly=true')
})

test('tool runtime dispatches through composed providers (builtin)', async (t) => {
  const providers = await loadHostModules({ builtinOnly: true })
  const toolRuntime = createToolRuntime({ providers })

  const result = await toolRuntime.call({
    name: 'get_time',
  })

  assert(result.iso, 'get_time should return iso timestamp')
  assert(result.epochMs, 'get_time should return epochMs')
  assert(result.timeZone === 'UTC', 'get_time should default to UTC')
})

test('tool runtime throws for unknown tool from composed providers', async (t) => {
  const providers = await loadHostModules({ builtinOnly: true })
  const toolRuntime = createToolRuntime({ providers })

  try {
    await toolRuntime.call({
      name: 'unknown_tool',
    })
    assert.fail('should have thrown unknown-tool error')
  } catch (error) {
    assert(error.message.includes('not available'), 'error should mention tool not available')
  }
})

test('provider ordering: first provider wins for duplicate tool names', async (t) => {
  // Create two providers with overlapping tool names
  const provider1 = {
    test_tool: async ({ name }) => ({ source: 'provider1' }),
  }

  const provider2 = {
    test_tool: async ({ name }) => ({ source: 'provider2' }),
  }

  const toolRuntime = createToolRuntime({ providers: [provider1, provider2] })

  const result = await toolRuntime.call({
    name: 'test_tool',
  })

  assert.strictEqual(result.source, 'provider1', 'first provider should win')
})

test('loadHostModules loads workspace provider from host_modules/index.js', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nerveflow-host-modules-'))
  const hostModulesDir = path.join(tempRoot, 'host_modules')
  await fs.mkdir(hostModulesDir, { recursive: true })
  await fs.writeFile(
    path.join(hostModulesDir, 'index.js'),
    [
      'export default function createWorkspaceProvider() {',
      '  return {',
      '    workspace_tool: async () => ({ source: "workspace" }),',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8'
  )

  try {
    const providers = await loadHostModules({ workspaceDir: tempRoot })
    assert(providers.length >= 2, 'should include builtin and workspace providers')

    const toolRuntime = createToolRuntime({ providers })
    const result = await toolRuntime.call({ name: 'workspace_tool' })
    assert.strictEqual(result.source, 'workspace', 'workspace tool should be callable')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('loadHostModules preserves builtin-first ordering over workspace collisions', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nerveflow-host-modules-order-'))
  const hostModulesDir = path.join(tempRoot, 'host_modules')
  await fs.mkdir(hostModulesDir, { recursive: true })
  await fs.writeFile(
    path.join(hostModulesDir, 'index.js'),
    [
      'export default function createWorkspaceProvider() {',
      '  return {',
      '    get_time: async () => ({ source: "workspace" }),',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8'
  )

  try {
    const providers = await loadHostModules({ workspaceDir: tempRoot })
    const toolRuntime = createToolRuntime({ providers })
    const result = await toolRuntime.call({ name: 'get_time' })

    assert(result.iso, 'builtin get_time should remain first and return iso timestamp')
    assert.notStrictEqual(result.source, 'workspace', 'workspace collision should not override builtin')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('news-agent workspace provider exposes poll_next_article tool', async () => {
  const workspaceDir = path.join(repoRoot, 'examples', 'news-agent')
  const relativeStorePath = `.data/test-news-store-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`
  const absoluteStorePath = path.join(workspaceDir, relativeStorePath)
  const previousStorePath = process.env.NEWS_AGENT_STORE_PATH
  process.env.NEWS_AGENT_STORE_PATH = relativeStorePath

  try {
    const providers = await loadHostModules({ workspaceDir })
    const toolRuntime = createToolRuntime({ providers })

    const firstArticle = await toolRuntime.call({
      name: 'poll_next_article',
      args: {
        feeds: ['http://127.0.0.1:1/rss.xml'],
      },
    })

    const secondArticle = await toolRuntime.call({
      name: 'poll_next_article',
      args: {
        feeds: ['http://127.0.0.1:1/rss.xml'],
      },
    })

    assert(firstArticle && typeof firstArticle === 'object', 'poll_next_article should return an article object')
    assert.strictEqual(typeof firstArticle.id, 'string', 'article.id should be a string')
    assert.strictEqual(typeof firstArticle.title, 'string', 'article.title should be a string')
    assert(secondArticle && typeof secondArticle === 'object', 'poll_next_article should return subsequent article object')
    assert.notStrictEqual(secondArticle.id, firstArticle.id, 'poll_next_article should advance deterministically without duplicates')
  } finally {
    if (previousStorePath == null) {
      delete process.env.NEWS_AGENT_STORE_PATH
    } else {
      process.env.NEWS_AGENT_STORE_PATH = previousStorePath
    }
    await fs.rm(absoluteStorePath, { force: true })
  }
})

test('news-agent workspace provider exposes poll_new_articles batch tool and stores unread rows', async () => {
  const workspaceDir = path.join(repoRoot, 'examples', 'news-agent')
  const relativeStorePath = `.data/test-news-store-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`
  const storePath = path.join(workspaceDir, relativeStorePath)
  const previousStorePath = process.env.NEWS_AGENT_STORE_PATH
  process.env.NEWS_AGENT_STORE_PATH = relativeStorePath

  try {
    const providers = await loadHostModules({ workspaceDir })
    const toolRuntime = createToolRuntime({ providers })

    const batch = await toolRuntime.call({
      name: 'poll_new_articles',
      args: {
        feeds: ['http://127.0.0.1:1/rss.xml'],
        limit: 5,
      },
    })

    assert(batch && typeof batch === 'object', 'poll_new_articles should return a result object')
    assert(Number.isInteger(batch.count), 'poll_new_articles should include count')
    assert(Array.isArray(batch.articles), 'poll_new_articles should include articles array')
    assert(batch.count === batch.articles.length, 'count should match articles length')
    assert(batch.count === 0, 'poll_new_articles should return zero when feed sources have no reachable new items')

    const unread = await toolRuntime.call({
      name: 'query_articles',
      args: {
        unread: true,
        limit: 50,
      },
    })

    assert(unread && typeof unread === 'object', 'query_articles should return object')
    assert(Array.isArray(unread.articles), 'query_articles should return article rows')
    assert(unread.articles.length >= batch.count, 'batch-ingested unread rows should be visible in store')

    const persisted = JSON.parse(await fs.readFile(storePath, 'utf8'))
    assert(typeof persisted === 'object' && persisted != null, 'news-agent store should persist to disk')
    assert(typeof persisted.state === 'object' && persisted.state != null, 'persisted store should include state entry')
    assert(Array.isArray(persisted.state.articleStore), 'persisted state entry should include articleStore array')
  } finally {
    if (previousStorePath == null) {
      delete process.env.NEWS_AGENT_STORE_PATH
    } else {
      process.env.NEWS_AGENT_STORE_PATH = previousStorePath
    }
    await fs.rm(storePath, { force: true })
  }
})

test('public store_file_json supports put/get/list_keys/delete operations', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nerveflow-public-store-'))

  try {
    const providers = await loadHostModules({ workspaceDir: tempRoot })
    const toolRuntime = createToolRuntime({ providers })

    await toolRuntime.call({
      name: 'store_file_json',
      args: {
        store: '.data/test-store.json',
        op: 'put',
        key: 'article-1',
        value: { title: 'hello' },
      },
    })

    await toolRuntime.call({
      name: 'store_file_json',
      args: {
        store: '.data/test-store.json',
        op: 'put',
        key: 'article-2',
        value: { title: 'world' },
      },
    })

    const fetched = await toolRuntime.call({
      name: 'store_file_json',
      args: {
        store: '.data/test-store.json',
        op: 'get',
        key: 'article-1',
      },
    })

    assert.equal(fetched.found, true)
    assert.deepEqual(fetched.value, { title: 'hello' })

    const listed = await toolRuntime.call({
      name: 'store_file_json',
      args: {
        store: '.data/test-store.json',
        op: 'list_keys',
      },
    })

    assert.equal(listed.count, 2)
    assert.equal(listed.keys.includes('article-1'), true)
    assert.equal(listed.keys.includes('article-2'), true)

    const removed = await toolRuntime.call({
      name: 'store_file_json',
      args: {
        store: '.data/test-store.json',
        op: 'delete',
        key: 'article-1',
      },
    })

    assert.equal(removed.deleted, true)

    const missing = await toolRuntime.call({
      name: 'store_file_json',
      args: {
        store: '.data/test-store.json',
        op: 'get',
        key: 'article-1',
      },
    })

    assert.equal(missing.found, false)
    assert.equal(missing.value, null)
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('public store_file_json rejects store paths outside workspace root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nerveflow-public-store-guard-'))

  try {
    const providers = await loadHostModules({ workspaceDir: tempRoot })
    const toolRuntime = createToolRuntime({ providers })

    await assert.rejects(
      () => toolRuntime.call({
        name: 'store_file_json',
        args: {
          store: '../escape.json',
          op: 'put',
          key: 'x',
          value: 1,
        },
      }),
      /within the workspace directory/,
    )
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
