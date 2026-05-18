import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { validateVlmOutput, callVlm, getVlmConfig } from '../local_vlm_extractor.js'
import type { VlmDraftOutput, FetchFn } from '../local_vlm_extractor.js'

function makeValidOutput(): VlmDraftOutput {
  return {
    inferredDate: '2026-05-15',
    inferredType: 'pregnancy_checkup',
    inferredTitle: '13周孕检报告',
    inferredSummary: '超声检查报告，显示胎儿头臀长等数据',
    facts: ['CRL: 7.2cm', 'NT: 1.2mm', '胎心: 158bpm'],
    inferredTags: ['孕检', '超声'],
    uncertainFields: [],
    warnings: [],
    needsParentReview: true,
  }
}

describe('validateVlmOutput', () => {
  it('passes clean output with no warnings', () => {
    const output = makeValidOutput()
    const warnings = validateVlmOutput(output)
    assert.equal(warnings.length, 0)
  })

  it('forces needsParentReview to true', () => {
    const output = makeValidOutput()
    ;(output as any).needsParentReview = false
    const warnings = validateVlmOutput(output)
    assert.equal(output.needsParentReview, true)
    assert.ok(warnings.some((w) => w.includes('needsParentReview')))
  })

  it('nullifies invalid inferredType and adds to uncertainFields', () => {
    const output = makeValidOutput()
    output.inferredType = 'invalid_type'
    const warnings = validateVlmOutput(output)
    assert.equal(output.inferredType, null)
    assert.ok(output.uncertainFields.includes('inferredType'))
    assert.ok(warnings.some((w) => w.includes('invalid_type')))
  })

  it('nullifies invalid inferredDate and adds to uncertainFields', () => {
    const output = makeValidOutput()
    output.inferredDate = 'not-a-date'
    const warnings = validateVlmOutput(output)
    assert.equal(output.inferredDate, null)
    assert.ok(output.uncertainFields.includes('inferredDate'))
    assert.ok(warnings.some((w) => w.includes('not valid ISO date')))
  })

  it('coerces non-array fields to empty arrays', () => {
    const output = makeValidOutput()
    ;(output as any).facts = 'not an array'
    ;(output as any).uncertainFields = null
    ;(output as any).warnings = undefined
    ;(output as any).inferredTags = 123
    validateVlmOutput(output)
    assert.ok(Array.isArray(output.facts))
    assert.ok(Array.isArray(output.uncertainFields))
    assert.ok(Array.isArray(output.warnings))
    assert.ok(Array.isArray(output.inferredTags))
  })

  it('detects banned medical patterns', () => {
    const output = makeValidOutput()
    output.inferredSummary = '宝宝很健康，一切正常'
    const warnings = validateVlmOutput(output)
    assert.ok(warnings.some((w) => w.includes('医学结论化表达')))
  })

  it('warns when uncertainFields empty but content is uncertain', () => {
    const output = makeValidOutput()
    output.inferredDate = null
    output.uncertainFields = []
    const warnings = validateVlmOutput(output)
    assert.ok(warnings.some((w) => w.includes('不确定性')))
  })

  it('keeps valid event types unchanged', () => {
    const output = makeValidOutput()
    output.inferredType = 'medical_record'
    const warnings = validateVlmOutput(output)
    assert.equal(output.inferredType, 'medical_record')
    assert.ok(!warnings.some((w) => w.includes('inferredType')))
  })
})

describe('callVlm', () => {
  const testConfig = { baseUrl: 'http://localhost:1234/v1', model: 'test-model', timeoutMs: 5000 }
  const testBuffer = Buffer.from('fake-image-data')

  it('returns ok:true with parsed output on success', async () => {
    const validOutput = makeValidOutput()
    const mockFetch: FetchFn = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validOutput) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const result = await callVlm(testBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.output.inferredTitle, '13周孕检报告')
      assert.equal(result.output.needsParentReview, true)
      assert.ok(result.rawResponseLength > 0)
    }
  })

  it('handles two-stage JSON parse (text wrapped around JSON)', async () => {
    const validOutput = makeValidOutput()
    const wrappedResponse = `Here is the extracted data:\n${JSON.stringify(validOutput)}\nDone.`
    const mockFetch: FetchFn = async () => new Response(JSON.stringify({
      choices: [{ message: { content: wrappedResponse } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const result = await callVlm(testBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.output.inferredTitle, '13周孕检报告')
    }
  })

  it('returns parse_error when response is not JSON', async () => {
    const mockFetch: FetchFn = async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Sorry, I cannot process this image.' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const result = await callVlm(testBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'parse_error')
    }
  })

  it('returns http_error on non-2xx status', async () => {
    const mockFetch: FetchFn = async () => new Response('Bad Request', { status: 400 })

    const result = await callVlm(testBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'http_error')
      assert.ok(result.message.includes('400'))
    }
  })

  it('returns connection_refused on network error', async () => {
    const mockFetch: FetchFn = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), { code: 'ECONNREFUSED' })
    }

    const result = await callVlm(testBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'connection_refused')
    }
  })

  it('returns timeout on AbortError', async () => {
    const mockFetch: FetchFn = async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }

    const result = await callVlm(testBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'timeout')
    }
  })

  it('returns parse_error for oversized images', async () => {
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024)
    const mockFetch: FetchFn = async () => new Response('should not be called')

    const result = await callVlm(bigBuffer, 'image/png', testConfig, mockFetch)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'parse_error')
      assert.ok(result.message.includes('10MB'))
    }
  })
})

describe('getVlmConfig', () => {
  it('returns null when VLM_MODEL is not set', () => {
    const original = process.env.VLM_MODEL
    delete process.env.VLM_MODEL
    const config = getVlmConfig()
    assert.equal(config, null)
    if (original) process.env.VLM_MODEL = original
  })

  it('returns config when VLM_MODEL is set', () => {
    const original = process.env.VLM_MODEL
    process.env.VLM_MODEL = 'test-model'
    const config = getVlmConfig()
    assert.ok(config)
    assert.equal(config.model, 'test-model')
    assert.equal(config.baseUrl, 'http://localhost:1234/v1')
    assert.equal(config.timeoutMs, 120_000)
    if (original) { process.env.VLM_MODEL = original } else { delete process.env.VLM_MODEL }
  })
})
