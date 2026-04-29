import test from 'node:test'
import assert from 'node:assert'
import { createMemoryProvider, createMemoryTable, embedText } from '../src/host_modules/public/memory_provider.js'
import pg from 'pg'

const { Pool } = pg

const TEST_PG_URL = process.env.TEST_PG_URL || 'postgres://localhost/nerveflow_test'
let testPool = null

// Helper: connect and cleanup test DB
async function setupTestPool() {
  try {
    testPool = new Pool({ connectionString: TEST_PG_URL })
    // Test connection
    const result = await testPool.query('SELECT 1')
    return true
  } catch (err) {
    console.log(`⚠️  Skipping memory provider tests (PG unavailable: ${err?.message})`)
    return false
  }
}

async function cleanupTestPool() {
  if (testPool) {
    try {
      await testPool.query('DROP TABLE IF EXISTS memory')
      await testPool.end()
    } catch (err) {
      // ignore cleanup errors
    }
    testPool = null
  }
}

// Skip wrapper
function skipIfNoPg(testFn) {
  return async (t) => {
    const pgAvailable = await setupTestPool()
    if (!pgAvailable) {
      t.skip('PG unavailable')
      return
    }
    try {
      await testFn()
    } finally {
      await cleanupTestPool()
    }
  }
}

test('memory provider: embedText parses Ollama embedding response', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { embeddings: [[0.1, 0.2, 0.3]] }
    },
  })

  try {
    const result = await embedText('semantic recall', 'mxbai-embed-large', 'http://127.0.0.1:11434')
    assert.deepEqual(result, [0.1, 0.2, 0.3])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('memory provider: auto-embeds on store and retrieve when embedder is provided', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingDimensions: 384,
    embedText: async () => Array(384).fill(0.25),
  })

  const stored = await provider.memory_store({
    args: {
      text: 'Semantic memory with auto embeddings',
      metadata: { topic: 'memory' },
    },
  })

  assert.equal(stored.ok, true)

  const retrieved = await provider.memory_retrieve({
    args: {
      query_text: 'auto embeddings',
      limit: 5,
    },
  })

  assert.equal(retrieved.ok, true)
  assert.equal(retrieved.count, 1)
  assert.match(retrieved.items[0].text, /Semantic memory/)
}))

test('memory provider: table creation is idempotent', skipIfNoPg(async () => {
  await createMemoryTable(testPool)
  await createMemoryTable(testPool) // should not throw
  
  const result = await testPool.query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory')")
  assert.strictEqual(result.rows[0].exists, true)
}))

test('memory provider: memory_store stores text with embedding and metadata', skipIfNoPg(async () => {
  await createMemoryTable(testPool)
  
  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  // Provide explicit embedding (384 dims, all zeros for test)
  const testEmbedding = Array(384).fill(0.1)
  
  const result = await provider.memory_store({
    args: {
      text: 'PostgreSQL with pgvector is great',
      embedding: testEmbedding,
      metadata: { source: 'docs', topic: 'database' },
    },
  })

  assert.strictEqual(result.ok, true)
  assert(result.id, 'should return id')
  assert(result.stored_at, 'should return stored_at timestamp')
  assert.match(result.text_preview, /PostgreSQL/)
  
  // Verify stored in DB
  const dbResult = await testPool.query('SELECT COUNT(*) FROM memory')
  assert.strictEqual(dbResult.rows[0].count, '1')
}))

test('memory provider: memory_retrieve returns ranked results', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  const testEmbedding = Array(384).fill(0.1)
  
  // Store two items with similar embeddings
  await provider.memory_store({
    args: {
      text: 'PostgreSQL with vector search',
      embedding: testEmbedding,
      metadata: { topic: 'database' },
    },
  })

  await provider.memory_store({
    args: {
      text: 'Machine learning embeddings',
      embedding: testEmbedding,
      metadata: { topic: 'ml' },
    },
  })

  // Retrieve with same embedding (should find both, similar scores)
  const result = await provider.memory_retrieve({
    args: {
      query_text: 'vector search',
      embedding: testEmbedding,
      limit: 10,
    },
  })

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.count, 2)
  assert(result.items.length === 2)
  assert(result.items[0].similarity, 'should have similarity score')
  assert(Number(result.items[0].similarity) >= 0 && Number(result.items[0].similarity) <= 1)
}))

test('memory provider: memory_retrieve filters by metadata', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  const testEmbedding = Array(384).fill(0.1)

  // Store items with different metadata
  await provider.memory_store({
    args: {
      text: 'Database article',
      embedding: testEmbedding,
      metadata: { topic: 'database', source: 'docs' },
    },
  })

  await provider.memory_store({
    args: {
      text: 'ML article',
      embedding: testEmbedding,
      metadata: { topic: 'ml', source: 'docs' },
    },
  })

  // Filter by topic
  const result = await provider.memory_retrieve({
    args: {
      query_text: 'topic',
      embedding: testEmbedding,
      limit: 10,
      filter_metadata: { topic: 'database' },
    },
  })

  assert.strictEqual(result.count, 1)
  assert.match(result.items[0].text, /Database/)
}))

test('memory provider: memory_delete removes a stored record by id', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  const testEmbedding = Array(384).fill(0.1)

  const stored = await provider.memory_store({
    args: {
      text: 'Delete me from memory',
      embedding: testEmbedding,
      metadata: { topic: 'music' },
    },
  })

  const deleted = await provider.memory_delete({
    args: {
      id: stored.id,
    },
  })

  assert.strictEqual(deleted.ok, true)
  assert.strictEqual(deleted.deleted, true)
  assert.strictEqual(deleted.id, stored.id)

  const dbResult = await testPool.query('SELECT COUNT(*) FROM memory WHERE id = $1', [stored.id])
  assert.strictEqual(dbResult.rows[0].count, '0')
}))

test('memory provider: memory_update updates text and metadata by id', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  const testEmbedding = Array(384).fill(0.1)
  const updatedEmbedding = Array(384).fill(0.2)

  const stored = await provider.memory_store({
    args: {
      text: 'Original record text',
      embedding: testEmbedding,
      metadata: { topic: 'music', tag: 'original' },
    },
  })

  const updated = await provider.memory_update({
    args: {
      id: stored.id,
      text: 'Updated record text',
      embedding: updatedEmbedding,
      metadata: { topic: 'music', tag: 'updated' },
    },
  })

  assert.strictEqual(updated.ok, true)
  assert.strictEqual(updated.updated, true)
  assert.strictEqual(updated.id, stored.id)

  const dbResult = await testPool.query('SELECT text, metadata FROM memory WHERE id = $1', [stored.id])
  assert.strictEqual(dbResult.rowCount, 1)
  assert.strictEqual(dbResult.rows[0].text, 'Updated record text')
  assert.strictEqual(dbResult.rows[0].metadata.tag, 'updated')
}))

test('memory provider: memory_store rejects missing text', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  const testEmbedding = Array(384).fill(0.1)

  try {
    await provider.memory_store({
      args: {
        text: '',
        embedding: testEmbedding,
      },
    })
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(String(err), /text is required/)
  }
}))

test('memory provider: memory_store rejects invalid embedding dimension', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  try {
    await provider.memory_store({
      args: {
        text: 'test',
        embedding: Array(256).fill(0.1), // wrong dimension
      },
    })
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(String(err), /embedding dimension mismatch/)
  }
}))

test('memory provider: memory_retrieve rejects missing query_text', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  try {
    await provider.memory_retrieve({
      args: {
        query_text: '',
      },
    })
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(String(err), /query_text is required/)
  }
}))

test('memory provider: memory_retrieve clamps limit between 1 and 50', skipIfNoPg(async () => {
  await createMemoryTable(testPool)

  const provider = createMemoryProvider({
    pgUrl: TEST_PG_URL,
    embeddingModel: 'mistral-embed',
  })

  const testEmbedding = Array(384).fill(0.1)

  // Store one item
  await provider.memory_store({
    args: {
      text: 'test',
      embedding: testEmbedding,
    },
  })

  // Retrieve with invalid limit (too high)
  const result = await provider.memory_retrieve({
    args: {
      query_text: 'test',
      embedding: testEmbedding,
      limit: 1000, // should clamp to 50
    },
  })

  assert.strictEqual(result.ok, true)
  assert(result.count <= 50)
}))

test('memory provider: factory rejects missing pgUrl', () => {
  try {
    createMemoryProvider({
      pgUrl: '',
    })
    assert.fail('should have thrown')
  } catch (err) {
    assert.match(String(err), /pgUrl required/)
  }
})
