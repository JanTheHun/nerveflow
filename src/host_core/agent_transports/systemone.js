/**
 * TypeSafe System One-compatible typed decision transport. It works with
 * Ollama decision models and compatible System One services.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl='http://127.0.0.1:11434']
 * @param {string} [opts.apiKey]
 * @param {number} [opts.timeoutMs=60000]
 * @returns {function} callAgent({ model, systemOne, transport })
 */
export function createSystemOneTransport(opts = {}) {
  const defaultBaseUrl = String(opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const defaultApiKey = String(opts.apiKey ?? '').trim()
  const defaultTimeoutMs = normalizeTimeoutMs(opts.timeoutMs, 60000)

  const callSystemOneAgent = async function callSystemOneAgent({ model, systemOne, transport }) {
    const callTransport = transport && typeof transport === 'object' && !Array.isArray(transport)
      ? transport
      : {}
    const baseUrl = String(callTransport.baseUrl ?? defaultBaseUrl).replace(/\/+$/, '')
    const apiKey = String(callTransport.apiKey ?? defaultApiKey).trim()
    const timeoutMs = normalizeTimeoutMs(callTransport.timeoutMs ?? callTransport.timeout_ms, defaultTimeoutMs)
    const descriptor = normalizeSystemOneDescriptor(systemOne)
    const url = `${baseUrl}/v1/systemone`
    const requestPayload = {
      model: String(model ?? '').trim(),
      state: descriptor.state,
      questions: descriptor.questions,
    }

    if (descriptor.images.length > 0) requestPayload.images = descriptor.images

    if (callTransport.keep_alive != null) {
      requestPayload.keep_alive = callTransport.keep_alive
    }

    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error(`System One decision timed out after ${timeoutMs}ms`)
        timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
        throw timeoutErr
      }
      throw err
    }

    if (!response.ok) {
      let bodyText = ''
      try {
        bodyText = await response.text()
      } catch (err) {
        if (err?.name === 'AbortError') {
          const timeoutErr = new Error(`System One decision timed out after ${timeoutMs}ms`)
          timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
          throw timeoutErr
        }
      } finally {
        clearTimeout(timeout)
      }
      const requestErr = new Error(`System One decision failed (${response.status}): ${bodyText || response.statusText}`)
      requestErr.code = 'SYSTEMONE_HTTP_ERROR'
      requestErr.status = response.status
      throw requestErr
    }

    let payload
    try {
      payload = await response.json()
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error(`System One decision timed out after ${timeoutMs}ms`)
        timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
        throw timeoutErr
      }
      const responseErr = new Error('System One decision returned invalid JSON.')
      responseErr.code = 'SYSTEMONE_INVALID_RESPONSE'
      throw responseErr
    } finally {
      clearTimeout(timeout)
    }

    const answers = normalizeSystemOneAnswers(payload?.answers, descriptor.questions)

    const promptTokens = finiteNumberOrNull(payload?.usage?.input_tokens)
    const completionTokens = finiteNumberOrNull(payload?.usage?.output_tokens)
    const totalTokens = Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
      ? promptTokens + completionTokens
      : null

    const legacyAnswer = answers.decision
    return {
      text: descriptor.legacy ? legacyAnswer.choice : JSON.stringify(answers),
      value: descriptor.legacy ? legacyAnswer.choice : answers,
      metadata: {
        provider: 'experimental.systemone',
        model: String(payload?.model ?? model ?? '').trim(),
        usage: { promptTokens, completionTokens, totalTokens },
        requestId: String(response.headers?.get?.('x-typesafe-request-id') ?? '').trim(),
        ...(descriptor.legacy ? { decision: legacyAnswer } : { decisions: answers }),
        rawProvider: {
          answers: payload.answers,
        },
      },
    }
  }

  callSystemOneAgent.capabilities = { supports_preload: false, experimentalSystemOne: true }
  return callSystemOneAgent
}

function normalizeSystemOneDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createSystemOneConfigError('System One transport requires a decision descriptor.')
  }

  if (Array.isArray(value.options)) {
    const state = String(value.state ?? '').trim()
    const instructions = String(value.instructions ?? '').trim()
    const options = value.options.map((option) => String(option ?? '').trim()).filter(Boolean)
    if (!state) throw createSystemOneConfigError('System One transport requires non-empty decision state.')
    if (!instructions) throw createSystemOneConfigError('System One transport requires explicit decision instructions.')
    if (options.length < 2 || options.length > 26) {
      throw createSystemOneConfigError('System One transport requires 2 to 26 decision options.')
    }
    return {
      legacy: true,
      state,
      images: [],
      questions: {
        decision: {
          type: 'choice',
          instructions,
          criteria: Object.fromEntries(options.map((option) => [option, null])),
        },
      },
    }
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'state') || value.state == null || (typeof value.state !== 'string' && !Array.isArray(value.state) && (typeof value.state !== 'object' || value.state === null))) {
    throw createSystemOneConfigError('System One transport requires state as a string, object, or array.')
  }
  if (!value.questions || typeof value.questions !== 'object' || Array.isArray(value.questions)) {
    throw createSystemOneConfigError('System One transport requires named questions.')
  }
  const entries = Object.entries(value.questions)
  if (entries.length < 1 || entries.length > 64) {
    throw createSystemOneConfigError('System One transport requires 1 to 64 named questions.')
  }

  const questions = {}
  for (const [nameRaw, rawQuestion] of entries) {
    const name = String(nameRaw).trim()
    if (!name || !rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
      throw createSystemOneConfigError(`System One question "${nameRaw}" must be a named object.`)
    }
    const type = String(rawQuestion.type ?? '').trim().toLowerCase()
    const instructions = String(rawQuestion.instructions ?? '').trim()
    if (!['choice', 'noul', 'score'].includes(type) || !instructions) {
      throw createSystemOneConfigError(`System One question "${name}" requires a supported type and instructions.`)
    }
    const question = { type, instructions }
    if (type === 'choice') {
      if (!rawQuestion.criteria || typeof rawQuestion.criteria !== 'object' || Array.isArray(rawQuestion.criteria)) {
        throw createSystemOneConfigError(`System One choice question "${name}" requires criteria.`)
      }
      const criteria = Object.entries(rawQuestion.criteria)
      if (criteria.length < 2 || criteria.length > 26 || criteria.some(([key, description]) => !String(key).trim() || (description !== null && typeof description !== 'string'))) {
        throw createSystemOneConfigError(`System One choice question "${name}" requires 2 to 26 criteria.`)
      }
      question.criteria = Object.fromEntries(criteria)
    } else if (type === 'score') {
      if (!Array.isArray(rawQuestion.criteria) || rawQuestion.criteria.length < 2 || rawQuestion.criteria.length > 26 || rawQuestion.criteria.some((level) => typeof level !== 'string' || !level.trim())) {
        throw createSystemOneConfigError(`System One score question "${name}" requires 2 to 26 string levels.`)
      }
      question.criteria = [...rawQuestion.criteria]
    } else if (rawQuestion.criteria != null) {
      const criteriaKeys = rawQuestion.criteria && typeof rawQuestion.criteria === 'object' && !Array.isArray(rawQuestion.criteria)
        ? Object.keys(rawQuestion.criteria)
        : []
      if (!rawQuestion.criteria || typeof rawQuestion.criteria !== 'object' || Array.isArray(rawQuestion.criteria) || criteriaKeys.length !== 2 || !Object.prototype.hasOwnProperty.call(rawQuestion.criteria, 'true') || !Object.prototype.hasOwnProperty.call(rawQuestion.criteria, 'false') || Object.values(rawQuestion.criteria).some((description) => typeof description !== 'string' || !description.trim())) {
        throw createSystemOneConfigError(`System One noul question "${name}" has invalid criteria.`)
      }
      question.criteria = { ...rawQuestion.criteria }
    }
    questions[name] = question
  }

  const images = value.images == null ? [] : value.images
  if (!Array.isArray(images) || images.some((image) => typeof image !== 'string' || !image.trim())) {
    throw createSystemOneConfigError('System One images must be non-empty base64 strings.')
  }
  return { legacy: false, state: value.state, questions, images: [...images] }
}

function normalizeSystemOneAnswers(rawAnswers, questions) {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    throw createSystemOneResponseError('System One response is missing answers.')
  }

  const answers = {}
  for (const [name, question] of Object.entries(questions)) {
    const rawAnswer = rawAnswers[name]
    if (!rawAnswer || typeof rawAnswer !== 'object' || Array.isArray(rawAnswer)) {
      throw createSystemOneResponseError(`System One response is missing answers.${name}.`)
    }
    const type = String(rawAnswer.type ?? '').trim().toLowerCase()
    if (type !== question.type) {
      throw createSystemOneResponseError(`System One response answers.${name} has type "${type || 'missing'}"; expected "${question.type}".`)
    }
    if (type === 'choice') {
      const choice = typeof rawAnswer.choice === 'string' ? rawAnswer.choice.trim() : ''
      if (!choice || !Object.prototype.hasOwnProperty.call(question.criteria, choice)) {
        throw createSystemOneResponseError(`System One response answers.${name}.choice is not a declared criterion.`)
      }
      answers[name] = {
        type,
        choice,
        confidence: normalizeProbability(rawAnswer.confidence, `answers.${name}.confidence`, true),
        probabilities: normalizeProbabilities(rawAnswer.probabilities, Object.keys(question.criteria), `answers.${name}.probabilities`),
      }
    } else if (type === 'noul') {
      answers[name] = { type, noul: normalizeProbability(rawAnswer.noul, `answers.${name}.noul`) }
    } else {
      const score = finiteNumberOrNull(rawAnswer.score)
      if (score == null || score < 0 || score > question.criteria.length - 1) {
        throw createSystemOneResponseError(`System One response answers.${name}.score is outside the declared score range.`)
      }
      answers[name] = {
        type,
        score,
        legend: normalizeScoreLegend(rawAnswer.legend, question.criteria, name),
        confidence: normalizeProbability(rawAnswer.confidence, `answers.${name}.confidence`, true),
        probabilities: normalizeProbabilities(rawAnswer.probabilities, question.criteria.map((_, index) => String(index)), `answers.${name}.probabilities`),
      }
    }
  }
  return answers
}

function normalizeProbability(value, field, optional = false) {
  if (value == null && optional) return null
  const probability = finiteNumberOrNull(value)
  if (probability == null || probability < 0 || probability > 1) {
    throw createSystemOneResponseError(`System One response ${field} must be a number from 0 to 1.`)
  }
  return probability
}

function normalizeScoreLegend(value, criteria, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.fromEntries(criteria.map((level, index) => [String(index), level]))
  const expected = Object.fromEntries(criteria.map((level, index) => [String(index), level]))
  if (Object.keys(expected).some((key) => value[key] !== expected[key])) {
    throw createSystemOneResponseError(`System One response answers.${name}.legend does not match the declared score criteria.`)
  }
  return expected
}

function normalizeTimeoutMs(value, fallback) {
  const timeoutMs = Number(value)
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : fallback
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeProbabilities(value, allowedKeys, field) {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createSystemOneResponseError(`System One response ${field} must be an object.`)
  }
  const probabilities = {}
  for (const [key, probability] of Object.entries(value)) {
    if (!allowedKeys.includes(key)) {
      throw createSystemOneResponseError(`System One response ${field} contains undeclared criterion "${key}".`)
    }
    probabilities[key] = normalizeProbability(probability, `${field}.${key}`)
  }
  return probabilities
}

function createSystemOneConfigError(message) {
  const err = new Error(message)
  err.code = 'SYSTEMONE_INVALID_CALL_CONFIG'
  return err
}

function createSystemOneResponseError(message) {
  const err = new Error(message)
  err.code = 'SYSTEMONE_INVALID_RESPONSE'
  return err
}