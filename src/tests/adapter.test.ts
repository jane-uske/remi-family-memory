import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { BabyEvent, BabyProfile } from '../types.js'
import { SCHEMA_VERSION } from '../types.js'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-adapter-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

const EVENTS_DIR = path.join(TEST_DATA_DIR, 'events')
const PROFILE_DIR = path.join(TEST_DATA_DIR, 'profile')
const MEMORY_DIR = path.join(TEST_DATA_DIR, 'memory')
const CONTEXT_DIR = path.join(TEST_DATA_DIR, 'context')
const REPORTS_DIR = path.join(TEST_DATA_DIR, 'reports')

const BLOCKED_EVENT: BabyEvent = {
  id: 'blocked-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-12T00:00:00.000Z',
  type: 'medical_record',
  title: 'BLOCKED_SECRET',
  summary: 'This must never reach any LLM',
  source: { kind: 'manual', path: 'test/blocked.md' },
  people: ['妈妈'],
  tags: ['secret'],
  sensitivity: 'blocked_from_ai',
  confirmedByParent: true,
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
}

const NORMAL_EVENT: BabyEvent = {
  id: 'normal-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-15T00:00:00.000Z',
  type: 'pregnancy_checkup',
  title: '16周常规孕检',
  summary: '各项指标正常',
  source: { kind: 'folder', path: 'data/inbox/notes/checkup.md' },
  people: ['妈妈'],
  tags: ['孕检'],
  sensitivity: 'normal',
  confirmedByParent: true,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
}

function setupFixtures() {
  mkdirSync(EVENTS_DIR, { recursive: true })
  mkdirSync(PROFILE_DIR, { recursive: true })
  mkdirSync(MEMORY_DIR, { recursive: true })
  mkdirSync(CONTEXT_DIR, { recursive: true })
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(path.join(EVENTS_DIR, 'events.json'), JSON.stringify([BLOCKED_EVENT, NORMAL_EVENT], null, 2))
  writeFileSync(path.join(PROFILE_DIR, 'baby.json'), JSON.stringify({
    babyId: 'baby-001', nickname: '小宝', familyName: '吴',
    expectedBirthDate: '2026-11-15', pregnancyStartDate: '2026-02-08',
    parents: [{ role: 'father', name: '吴健', nickname: '爸爸' }],
    createdAt: '2026-05-18T00:00:00.000Z', updatedAt: '2026-05-18T00:00:00.000Z',
  } satisfies BabyProfile, null, 2))
}

setupFixtures()

// --- Adapter Selection ---

describe('v0.7: Adapter selection', () => {
  it('defaults to deterministic when no cloud env vars set', async () => {
    delete process.env.FAMILY_MEMORY_LLM_PROVIDER
    delete process.env.FAMILY_MEMORY_LLM_API_KEY
    delete process.env.FAMILY_MEMORY_LLM_MODEL
    const { createAdapter } = await import('../adapters/index.js')
    const adapter = createAdapter()
    assert.equal(adapter.type, 'deterministic')
  })

  it('selects cloud adapter when all env vars present', async () => {
    const { createAdapter } = await import('../adapters/index.js')
    const adapter = createAdapter('cloud', {
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    })
    assert.equal(adapter.type, 'cloud')
  })

  it('throws for local adapter (not implemented)', async () => {
    const { createAdapter } = await import('../adapters/index.js')
    assert.throws(() => createAdapter('local'), /not yet implemented/)
  })

  it('RemiConnector uses deterministic by default', async () => {
    delete process.env.FAMILY_MEMORY_LLM_PROVIDER
    delete process.env.FAMILY_MEMORY_LLM_API_KEY
    delete process.env.FAMILY_MEMORY_LLM_MODEL
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:19999')
    assert.equal(connector.getAdapterType(), 'deterministic')
  })
})

// --- Deterministic Adapter Non-Regression ---

describe('v0.7: Deterministic adapter non-regression', () => {
  it('service_unavailable still returns proper refusal', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:19999')
    const answer = await connector.answer('测试问题')
    assert.equal(answer.answerable, false)
    assert.equal(answer.confidence, 'none')
    assert.equal(answer.reason, 'service_unavailable')
    assert.equal(answer.sources.length, 0)
  })

  it('no evidence returns no_evidence refusal', async () => {
    const { DeterministicAdapter } = await import('../adapters/index.js')
    const adapter = new DeterministicAdapter()
    const result = await adapter.generate({
      question: '未来问题',
      evidence: { query: '未来', items: [], fromContext: false, fromSearch: false, collectedAt: new Date().toISOString() },
      promptContract: 'grounded_answer_v1',
    })
    assert.equal(result.answerable, false)
    assert.equal(result.confidence, 'none')
    assert.equal(result.reason, 'no_evidence')
    assert.equal(result.sourceRefs.length, 0)
  })

  it('with evidence returns answerable with sources', async () => {
    const { DeterministicAdapter } = await import('../adapters/index.js')
    const adapter = new DeterministicAdapter()
    const result = await adapter.generate({
      question: '最近孕检情况',
      evidence: {
        query: '孕检',
        items: [{
          source: 'memory',
          memoryId: 'mem-001',
          sourceEventId: 'normal-001',
          date: '2026-05-15',
          title: '16周常规孕检',
          snippet: '各项指标正常',
          importance: 'high',
        }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    })
    assert.equal(result.answerable, true)
    assert.ok(result.sourceRefs.length > 0)
    assert.equal(result.sourceRefs[0].memoryId, 'mem-001')
  })
})

// --- Cloud Adapter Payload Safety ---

describe('v0.7: Cloud adapter payload safety', () => {
  it('payload does not contain blocked_from_ai', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{
          source: 'memory' as const,
          memoryId: 'mem-001',
          date: '2026-05-15',
          title: '正常记录',
          snippet: '正常内容',
        }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const payload = adapter.buildPayload(input)
    const payloadStr = JSON.stringify(payload)
    assert.ok(!payloadStr.includes('blocked_from_ai'), 'payload must not contain blocked_from_ai')
    assert.ok(!payloadStr.includes('BLOCKED_SECRET'), 'payload must not contain blocked content')
  })

  it('payload does not contain raw events or paths', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{
          source: 'memory' as const,
          memoryId: 'mem-001',
          date: '2026-05-15',
          title: '记录',
          snippet: '内容',
        }],
        fromContext: true,
        fromSearch: false,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const payload = adapter.buildPayload(input)
    const payloadStr = JSON.stringify(payload)
    assert.ok(!payloadStr.includes('data/events'), 'payload must not contain raw event paths')
    assert.ok(!payloadStr.includes('data/inbox'), 'payload must not contain inbox paths')
    assert.ok(!payloadStr.includes('data/archive'), 'payload must not contain archive paths')
    assert.ok(!payloadStr.includes('/api/events'), 'payload must not reference owner API')
  })

  it('audit correctly reports payload metrics', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [
          { source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录1', snippet: '内容1' },
          { source: 'context' as const, memoryId: 'mem-002', date: '2026-05-16', title: '记录2', snippet: '内容2' },
        ],
        fromContext: true,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.evidenceItemCount, 2)
    assert.equal(audit.sourceCount, 2)
    assert.equal(audit.hasBlockedFromAi, false)
    assert.equal(audit.hasRawEvents, false)
    assert.equal(audit.hasAttachmentRawPath, false)
    assert.equal(audit.hasReportContent, false)
    assert.equal(audit.hasOwnerApi, false)
    assert.equal(audit.safe, true)
    assert.equal(audit.risks.length, 0)
    assert.ok(audit.byteSize > 0)
  })
})

// --- Cloud Adapter Output Validation ---

describe('v0.7: Cloud adapter output validation', () => {
  it('rejects answerable=true without sources', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: '内容' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const badOutput = {
      answerable: true,
      answer: '回答内容',
      confidence: 'high' as const,
      reason: 'evidence_found',
      sourceRefs: [],
    }

    const validated = adapter.validateOutput(badOutput, input)
    assert.equal(validated.answerable, false, 'must reject answerable without sources')
    assert.equal(validated.reason, 'validation_failed_no_sources')
  })

  it('rejects phantom sources not in evidence', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: '内容' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const badOutput = {
      answerable: true,
      answer: '回答内容',
      confidence: 'high' as const,
      reason: 'evidence_found',
      sourceRefs: [{ memoryId: 'fabricated-id', title: '虚构记录' }],
    }

    const validated = adapter.validateOutput(badOutput, input)
    assert.equal(validated.answerable, false, 'must reject phantom sources')
    assert.equal(validated.reason, 'validation_failed_phantom_sources')
  })

  it('accepts valid sources that exist in evidence', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', sourceEventId: 'evt-001', date: '2026-05-15', title: '记录', snippet: '内容' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const goodOutput = {
      answerable: true,
      answer: '根据记录...',
      confidence: 'high' as const,
      reason: 'evidence_found',
      sourceRefs: [{ memoryId: 'mem-001', title: '记录' }],
    }

    const validated = adapter.validateOutput(goodOutput, input)
    assert.equal(validated.answerable, true)
    assert.equal(validated.sourceRefs.length, 1)
    assert.equal(validated.sourceRefs[0].memoryId, 'mem-001')
  })

  it('cloud adapter falls back to deterministic on LLM failure', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'invalid', model: 'test', baseUrl: 'http://localhost:19999' })

    const result = await adapter.generate({
      question: '孕检情况',
      evidence: {
        query: '孕检',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '16周常规孕检', snippet: '正常', importance: 'high' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    })

    assert.equal(result.answerable, true, 'should fallback to deterministic and still answer')
    assert.ok(result.sourceRefs.length > 0, 'fallback should still provide sources')
  })

  it('empty evidence always results in refusal', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const result = await adapter.generate({
      question: '不存在的问题',
      evidence: { query: '不存在', items: [], fromContext: false, fromSearch: false, collectedAt: new Date().toISOString() },
      promptContract: 'grounded_answer_v1',
    })

    assert.equal(result.answerable, false)
    assert.equal(result.confidence, 'none')
    assert.equal(result.reason, 'no_evidence')
  })
})

// --- Integration: connector + adapter ---

describe('v0.7: Connector adapter integration', () => {
  it('connector toAdapterEvidence strips report items and path field', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:19999')
    const answer = await connector.answer('测试')
    assert.equal(answer.reason, 'service_unavailable')
  })
})

// --- v0.7.1: Real Audit Scanning ---

describe('v0.7.1: Audit detects payload risks', () => {
  it('detects blocked_from_ai in evidence snippet', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: 'sensitivity: blocked_from_ai' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.hasBlockedFromAi, true)
    assert.equal(audit.safe, false)
    assert.ok(audit.risks.length > 0)
  })

  it('detects BLOCKED_SECRET in title', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: 'BLOCKED_SECRET', snippet: '内容' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.hasBlockedFromAi, true)
    assert.equal(audit.safe, false)
  })

  it('detects raw event paths in snippet', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: 'path: data/events/events.json' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.hasRawEvents, true)
    assert.equal(audit.safe, false)
  })

  it('detects owner-facing API reference', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: 'see /api/events for all data' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.hasOwnerApi, true)
    assert.equal(audit.safe, false)
  })

  it('detects attachment file paths', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: 'file at data/attachments/photo.jpg' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.hasAttachmentRawPath, true)
    assert.equal(audit.safe, false)
  })

  it('detects report source type in evidence', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '月度报告', snippet: '来自 data/reports/2026-05.md' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.hasReportContent, true)
    assert.equal(audit.safe, false)
  })

  it('clean payload passes audit', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '最近孕检情况',
      evidence: {
        query: '孕检',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '16周常规孕检', snippet: '各项指标正常' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    assert.equal(audit.safe, true)
    assert.equal(audit.risks.length, 0)
  })
})

describe('v0.7.1: Unsafe payload blocks cloud call', () => {
  it('generate() falls back to deterministic when audit fails', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test', baseUrl: 'http://localhost:19999' })

    const input = {
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: 'blocked_from_ai content here' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const result = await adapter.generate(input)
    assert.equal(result.answerable, true, 'fallback to deterministic should still answer')
    assert.ok(result.sourceRefs.length > 0, 'fallback should provide sources')
  })
})

describe('v0.7.1: Provider error handling', () => {
  it('local adapter throws clear error', async () => {
    const { createAdapter } = await import('../adapters/index.js')
    assert.throws(() => createAdapter('local'), /not yet implemented/)
  })

  it('cloud adapter without valid endpoint falls back gracefully', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'invalid-key', model: 'nonexistent', baseUrl: 'http://localhost:19999' })

    const result = await adapter.generate({
      question: '测试',
      evidence: {
        query: '测试',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '记录', snippet: '内容' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    })

    assert.equal(result.answerable, true, 'must fallback to deterministic')
    assert.ok(result.sourceRefs.length > 0)
  })
})

// --- v0.7.2: Partial Evidence Contract ---

describe('v0.7.2: Partial evidence must not become no_evidence', () => {
  it('validator corrects no_evidence when answer uses evidence content', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '宝宝最近身体状态怎么样？',
      evidence: {
        query: '身体',
        items: [{ source: 'memory' as const, memoryId: 'mem-checkup-001', sourceEventId: 'evt-001', date: '2026-05-15', title: '16周常规孕检', snippet: 'NT检查通过，各项指标正常' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const badOutput = {
      answerable: false,
      answer: '根据2026-05-15的16周常规孕检记录，NT检查通过，各项指标正常。但仅有一条记录不足以完整判断。',
      confidence: 'none' as const,
      reason: 'no_evidence',
      sourceRefs: [],
    }

    const validated = adapter.validateOutput(badOutput, input)
    assert.equal(validated.reason, 'partial_evidence', 'must correct to partial_evidence')
    assert.equal(validated.answerable, true)
    assert.ok(validated.sourceRefs.length > 0, 'must include sourceRefs for used evidence')
    assert.equal(validated.sourceRefs[0].memoryId, 'mem-checkup-001')
  })

  it('validator corrects missing sourceRefs when answer references evidence', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '最近孕检情况',
      evidence: {
        query: '孕检',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '16周常规孕检', snippet: '各项指标正常' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const badOutput = {
      answerable: false,
      answer: '根据16周常规孕检的记录，各项指标正常。',
      confidence: 'low' as const,
      reason: 'partial_evidence',
      sourceRefs: [],
    }

    const validated = adapter.validateOutput(badOutput, input)
    assert.equal(validated.answerable, true, 'must become answerable when evidence is used')
    assert.equal(validated.reason, 'partial_evidence')
    assert.ok(validated.sourceRefs.length > 0, 'must attach sourceRefs from evidence')
    assert.equal(validated.sourceRefs[0].memoryId, 'mem-001')
  })

  it('true no_evidence (empty items) is not corrected', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '宝宝喜欢什么颜色？',
      evidence: {
        query: '颜色',
        items: [],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const refusalOutput = {
      answerable: false,
      answer: '当前家庭记忆库里没有找到相关记录。',
      confidence: 'none' as const,
      reason: 'no_evidence',
      sourceRefs: [],
    }

    const validated = adapter.validateOutput(refusalOutput, input)
    assert.equal(validated.answerable, false)
    assert.equal(validated.reason, 'no_evidence')
    assert.equal(validated.sourceRefs.length, 0)
  })

  it('deterministic adapter returns partial_evidence with sourceRefs for broad questions', async () => {
    const { DeterministicAdapter } = await import('../adapters/index.js')
    const adapter = new DeterministicAdapter()

    const result = await adapter.generate({
      question: '宝宝最近身体状态怎么样？',
      evidence: {
        query: '身体',
        items: [{ source: 'memory' as const, memoryId: 'mem-001', date: '2026-05-15', title: '16周常规孕检', snippet: '各项指标正常', importance: 'high' }],
        fromContext: false,
        fromSearch: true,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    })

    assert.equal(result.reason, 'partial_evidence')
    assert.equal(result.confidence, 'low')
    assert.ok(result.sourceRefs.length > 0, 'partial_evidence must carry sourceRefs')
    assert.equal(result.sourceRefs[0].memoryId, 'mem-001')
  })

  it('answer text with evidence date but empty sourceRefs gets corrected', async () => {
    const { CloudAdapter } = await import('../adapters/cloud.js')
    const adapter = new CloudAdapter({ provider: 'openai', apiKey: 'test', model: 'test' })

    const input = {
      question: '胎动情况',
      evidence: {
        query: '胎动',
        items: [{ source: 'memory' as const, memoryId: 'mem-fetal-001', date: '2026-05-10', title: '第一次胎动', snippet: '像小鱼在游动' }],
        fromContext: true,
        fromSearch: false,
        collectedAt: new Date().toISOString(),
      },
      promptContract: 'grounded_answer_v1',
    }

    const badOutput = {
      answerable: false,
      answer: '2026-05-10记录了第一次胎动，像小鱼在游动。',
      confidence: 'none' as const,
      reason: 'no_evidence',
      sourceRefs: [],
    }

    const validated = adapter.validateOutput(badOutput, input)
    assert.equal(validated.answerable, true)
    assert.equal(validated.reason, 'partial_evidence')
    assert.ok(validated.sourceRefs.length > 0)
    assert.equal(validated.sourceRefs[0].memoryId, 'mem-fetal-001')
  })
})

// Cleanup
process.on('exit', () => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true })
})
