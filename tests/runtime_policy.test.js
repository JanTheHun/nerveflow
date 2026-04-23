import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeEffectsPolicy,
  validateDeclaredEffectBindings,
} from '../src/host_core/runtime_policy.js'

test('normalizeEffectsPolicy defaults to warn when missing', () => {
  assert.equal(normalizeEffectsPolicy(undefined), 'warn')
  assert.equal(normalizeEffectsPolicy(null), 'warn')
  assert.equal(normalizeEffectsPolicy(''), 'warn')
})

test('normalizeEffectsPolicy accepts warn and strict values', () => {
  assert.equal(normalizeEffectsPolicy('warn'), 'warn')
  assert.equal(normalizeEffectsPolicy('strict'), 'strict')
  assert.equal(normalizeEffectsPolicy('  STRICT  '), 'strict')
})

test('normalizeEffectsPolicy rejects unsupported values', () => {
  assert.throws(
    () => normalizeEffectsPolicy('ignore'),
    /effectsPolicy must be either "warn" or "strict"/i,
  )
})

test('validateDeclaredEffectBindings ignores channels without kind', () => {
  const issues = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { format: 'text' },
      telemetry: {},
    },
  })

  assert.deepEqual(issues, [])
})

test('validateDeclaredEffectBindings reports missing validator for kind channels', () => {
  const issues = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    },
  })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].reason, 'missing_validator')
  assert.equal(issues[0].channelId, 'heartbeat')
})

test('validateDeclaredEffectBindings accepts true or undefined validator results', () => {
  const accepted = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    },
    validateEffectBindings: () => true,
  })
  assert.deepEqual(accepted, [])

  const acceptedByDefault = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    },
    validateEffectBindings: () => undefined,
  })
  assert.deepEqual(acceptedByDefault, [])
})

test('validateDeclaredEffectBindings supports string and object validator failures', () => {
  const stringIssues = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    },
    validateEffectBindings: () => 'unsupported in host',
  })

  assert.equal(stringIssues.length, 1)
  assert.equal(stringIssues[0].reason, 'unsupported_binding')
  assert.equal(stringIssues[0].message, 'unsupported in host')

  const objectIssues = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    },
    validateEffectBindings: () => ({
      ok: false,
      reason: 'missing_topic',
      message: 'topic required',
    }),
  })

  assert.equal(objectIssues.length, 1)
  assert.equal(objectIssues[0].reason, 'missing_topic')
  assert.equal(objectIssues[0].message, 'topic required')
})

test('validateDeclaredEffectBindings captures validator exceptions', () => {
  const issues = validateDeclaredEffectBindings({
    declaredEffectChannels: {
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    },
    validateEffectBindings: () => {
      throw new Error('validator exploded')
    },
  })

  assert.equal(issues.length, 1)
  assert.equal(issues[0].reason, 'validator_error')
  assert.equal(issues[0].message, 'validator exploded')
})
