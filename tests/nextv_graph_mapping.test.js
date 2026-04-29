import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

function loadGraphMappingApi() {
  const scriptPath = resolve(process.cwd(), 'nerve-studio/public/nextv_graph_mapping.js')
  const source = readFileSync(scriptPath, 'utf8')

  const sandbox = { globalThis: {} }
  vm.runInNewContext(source, sandbox, { filename: scriptPath })

  const api = sandbox.globalThis.nextVGraphMapping
  assert.ok(api, 'expected nextVGraphMapping to be attached to globalThis')
  return api
}

test('nextVGraphMapping normalizes provenance labels', () => {
  const api = loadGraphMappingApi()

  assert.equal(api.getControlProvenanceClass('bounded'), 'bounded')
  assert.equal(api.getControlProvenanceClass('unbounded'), 'unbounded')
  assert.equal(api.getControlProvenanceClass('mixed'), 'mixed')
  assert.equal(api.getControlProvenanceClass('unknown'), 'unknown')
  assert.equal(api.getControlProvenanceClass('  BOUNDED  '), 'bounded')
  assert.equal(api.getControlProvenanceClass('else'), 'unknown')
  assert.equal(api.getControlProvenanceClass(null), 'unknown')
})

test('nextVGraphMapping builds control graph artifacts and ignores malformed edges', () => {
  const api = loadGraphMappingApi()
  const inputEdges = [
    {
      eventType: 'route',
      from: 'handler:route',
      to: 'branch:route:10:if_true',
      type: 'control',
      branch: 'if_true',
      provenance: 'bounded',
      boundedControl: true,
      line: 10,
      statement: 'if decision.intent == "chat"',
      sourcePath: 'entry.nrv',
      sourceLine: 3,
    },
    {
      eventType: 'route',
      from: 'handler:route',
      to: 'branch:route:10:if_false',
      type: 'control',
      branch: 'if_false',
      provenance: 'unbounded',
      boundedControl: false,
      line: 10,
      statement: 'if decision.intent == "chat"',
    },
    {
      eventType: 'route',
      from: 'handler:route',
      to: 'branch:route:10:if_true',
      type: 'control',
      branch: 'if_true',
      provenance: 'bounded',
      boundedControl: true,
      line: 10,
      statement: 'duplicate node id should dedupe control node',
      sourcePath: 'entry.nrv',
      sourceLine: 3,
    },
    {
      eventType: 'bad',
      from: '',
      to: 'branch:bad:1:if_true',
      provenance: 'mixed',
    },
    {
      eventType: 'bad',
      from: 'handler:bad',
      to: '',
      provenance: 'mixed',
    },
  ]

  const result = api.buildControlGraphArtifacts(inputEdges)
  assert.ok(Array.isArray(result.controlNodes))
  assert.ok(Array.isArray(result.controlGraphEdges))

  // One duplicate node id is intentionally provided; nodes are deduped by id.
  assert.equal(result.controlNodes.length, 2)
  assert.equal(result.controlGraphEdges.length, 3)

  const nodeById = new Map(result.controlNodes.map((node) => [node.id, node]))
  const trueNode = nodeById.get('branch:route:10:if_true')
  assert.ok(trueNode)
  assert.equal(trueNode.kind, 'control_branch')
  assert.equal(trueNode.provenance, 'bounded')
  assert.equal(trueNode.sourcePath, 'entry.nrv')
  assert.equal(trueNode.sourceLine, 3)

  const falseNode = nodeById.get('branch:route:10:if_false')
  assert.ok(falseNode)
  assert.equal(falseNode.provenance, 'unbounded')

  for (const edge of result.controlGraphEdges) {
    assert.equal(edge.type, 'control')
    assert.equal(typeof edge.from, 'string')
    assert.equal(typeof edge.to, 'string')
    assert.ok(edge.from.length > 0)
    assert.ok(edge.to.length > 0)
    assert.ok(['bounded', 'unbounded', 'mixed', 'unknown'].includes(edge.provenance))
  }
})
