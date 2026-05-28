import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync as readFileSyncNative, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  extractComposedInput,
  normalizeComposedTextInput,
  resolveComposedTextParts,
} from '../src/host_core/structured_inputs.js'

test('extractComposedInput rejects mixed legacy and parts keys', () => {
  assert.throws(
    () => extractComposedInput(
      { prompt: 'legacy', promptParts: ['structured'] },
      { legacyKey: 'prompt', partsKey: 'promptParts', fieldName: 'prompt' },
    ),
    /prompt and promptParts cannot both be set/i,
  )
})

test('normalizeComposedTextInput accepts include objects in arrays', () => {
  const normalized = normalizeComposedTextInput(['hello', { include: 'docs/rules.md' }], {
    fieldName: 'instructions',
  })

  assert.equal(normalized.isStructured, true)
  assert.equal(normalized.parts.length, 2)
  assert.deepEqual(normalized.parts[0], { type: 'text', text: 'hello' })
  assert.deepEqual(normalized.parts[1], { type: 'include', path: 'docs/rules.md' })
})

test('resolveComposedTextParts reads include file content', () => {
  const tempWorkspace = mkdtempSync(join(process.cwd(), '.tmp-structured-inputs-'))
  try {
    writeFileSync(join(tempWorkspace, 'rules.txt'), 'rule one', 'utf8')
    const resolved = resolveComposedTextParts(
      [{ type: 'text', text: 'hello' }, { type: 'include', path: 'rules.txt' }],
      {
        workspaceDir: { absolutePath: tempWorkspace, relativePath: '.' },
        resolvePathFromBaseDirectory: (baseDirectoryAbsolutePath, inputPath) => ({
          absolutePath: join(baseDirectoryAbsolutePath, inputPath),
          relativePath: inputPath,
        }),
        readFileSync: (path, encoding) => {
          if (encoding !== 'utf8') throw new Error('unexpected encoding')
          return String(readFileSyncNative(path, encoding))
        },
      },
    )

    assert.deepEqual(resolved.segments, ['hello', 'rule one'])
    assert.deepEqual(resolved.includes, ['rules.txt'])
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test('resolveComposedTextParts rejects too many include entries', () => {
  const tempWorkspace = mkdtempSync(join(process.cwd(), '.tmp-structured-inputs-'))
  try {
    writeFileSync(join(tempWorkspace, 'a.txt'), 'a', 'utf8')
    writeFileSync(join(tempWorkspace, 'b.txt'), 'b', 'utf8')

    assert.throws(
      () => resolveComposedTextParts(
        [{ type: 'include', path: 'a.txt' }, { type: 'include', path: 'b.txt' }],
        {
          workspaceDir: { absolutePath: tempWorkspace, relativePath: '.' },
          resolvePathFromBaseDirectory: (baseDirectoryAbsolutePath, inputPath) => ({
            absolutePath: join(baseDirectoryAbsolutePath, inputPath),
            relativePath: inputPath,
          }),
          readFileSync: (path, encoding) => {
            if (encoding !== 'utf8') throw new Error('unexpected encoding')
            return String(readFileSyncNative(path, encoding))
          },
          maxIncludeCount: 1,
        },
      ),
      /includes exceed the maximum allowed count/i,
    )
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test('resolveComposedTextParts rejects aggregate include size overflow', () => {
  const tempWorkspace = mkdtempSync(join(process.cwd(), '.tmp-structured-inputs-'))
  try {
    writeFileSync(join(tempWorkspace, 'a.txt'), '12345', 'utf8')
    writeFileSync(join(tempWorkspace, 'b.txt'), '67890', 'utf8')

    assert.throws(
      () => resolveComposedTextParts(
        [{ type: 'include', path: 'a.txt' }, { type: 'include', path: 'b.txt' }],
        {
          workspaceDir: { absolutePath: tempWorkspace, relativePath: '.' },
          resolvePathFromBaseDirectory: (baseDirectoryAbsolutePath, inputPath) => ({
            absolutePath: join(baseDirectoryAbsolutePath, inputPath),
            relativePath: inputPath,
          }),
          readFileSync: (path, encoding) => {
            if (encoding !== 'utf8') throw new Error('unexpected encoding')
            return String(readFileSyncNative(path, encoding))
          },
          maxTotalIncludeBytes: 9,
        },
      ),
      /includes exceed the maximum allowed total size/i,
    )
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})
