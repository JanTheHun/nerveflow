import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json')

function readPackageJson() {
  const raw = readFileSync(PACKAGE_JSON_PATH, 'utf8')
  return JSON.parse(raw)
}

test('package exports include documented subpaths', () => {
  const pkg = readPackageJson()
  const exportsMap = pkg?.exports ?? {}

  assert.equal(exportsMap['.'], './src/index.js')
  assert.equal(exportsMap['./runtime'], './src/runtime/index.js')
  assert.equal(exportsMap['./host_core'], './src/host_core/index.js')
  assert.equal(exportsMap['./host_core/protocol'], './src/host_core/protocol.js')
  assert.equal(exportsMap['./host-modules'], './src/host_modules/index.js')
})

test('runtime websocket dependency is published as runtime dependency', () => {
  const pkg = readPackageJson()

  assert.equal(typeof pkg?.dependencies?.ws, 'string')
  assert.equal(pkg?.devDependencies?.ws, undefined)
})

test('published cli bin map excludes repository-only dev launcher', () => {
  const pkg = readPackageJson()
  const binMap = pkg?.bin ?? {}

  assert.equal(typeof binMap['nerve-runtime'], 'string')
  assert.equal(typeof binMap['nerve-attach'], 'string')
  assert.equal(typeof binMap['nerve-model-check'], 'string')
  assert.equal(typeof binMap['nerve-compose'], 'string')
  assert.equal(binMap['nerve-dev-remote'], undefined)
})
