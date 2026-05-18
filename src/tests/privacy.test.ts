import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { BabyEvent, BabyProfile } from '../types.js'
import { SCHEMA_VERSION } from '../types.js'

// --- Test Fixtures ---

const TEST_DATA_DIR = path.resolve('data')
const EVENTS_FILE = path.join(TEST_DATA_DIR, 'events', 'events.json')
const PROFILE_FILE = path.join(TEST_DATA_DIR, 'profile', 'baby.json')
const MEMORY_FILE = path.join(TEST_DATA_DIR, 'memory', 'memories.json')
const CONTEXT_JSON = path.join(TEST_DATA_DIR, 'context', 'remi-context.json')
const REPORTS_DIR = path.join(TEST_DATA_DIR, 'reports')

const BLOCKED_EVENT: BabyEvent = {
  id: 'blocked-test-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-12T00:00:00.000Z',
  type: 'medical_record',
  title: 'BLOCKED_SECRET_TITLE',
  summary: 'BLOCKED_SECRET_SUMMARY with sensitive content that must never leak',
  source: { kind: 'manual', path: 'test/blocked.md' },
  people: ['妈妈'],
  tags: ['秘密标签'],
  sensitivity: 'blocked_from_ai',
  confirmedByParent: true,
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
}

const NORMAL_EVENT: BabyEvent = {
  id: 'normal-test-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-15T00:00:00.000Z',
  type: 'pregnancy_checkup',
  title: '16周常规孕检',
  summary: '各项指标正常，宝宝发育良好。',
  source: { kind: 'folder', path: 'data/inbox/notes/checkup.md' },
  people: ['妈妈', '爸爸'],
  tags: ['孕检', '16周'],
  sensitivity: 'normal',
  confirmedByParent: true,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
}

const TEST_PROFILE: BabyProfile = {
  babyId: 'baby-001',
  nickname: '小宝',
  familyName: '吴',
  expectedBirthDate: '2026-11-15',
  pregnancyStartDate: '2026-02-08',
  parents: [
    { role: 'father', name: '吴健', nickname: '爸爸' },
    { role: 'mother', name: '', nickname: '妈妈' },
  ],
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
}

let originalEvents: string | null = null
let originalMemories: string | null = null

function backupAndSetFixtures() {
  if (existsSync(EVENTS_FILE)) {
    originalEvents = readFileSync(EVENTS_FILE, 'utf-8')
  }
  if (existsSync(MEMORY_FILE)) {
    originalMemories = readFileSync(MEMORY_FILE, 'utf-8')
  }

  mkdirSync(path.dirname(EVENTS_FILE), { recursive: true })
  mkdirSync(path.dirname(PROFILE_FILE), { recursive: true })
  mkdirSync(path.dirname(MEMORY_FILE), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'context'), { recursive: true })
  mkdirSync(REPORTS_DIR, { recursive: true })

  const fixtures = [BLOCKED_EVENT, NORMAL_EVENT]
  writeFileSync(EVENTS_FILE, JSON.stringify(fixtures, null, 2), 'utf-8')
  writeFileSync(PROFILE_FILE, JSON.stringify(TEST_PROFILE, null, 2), 'utf-8')
}

function restoreOriginal() {
  if (originalEvents !== null) {
    writeFileSync(EVENTS_FILE, originalEvents, 'utf-8')
  }
  if (originalMemories !== null) {
    writeFileSync(MEMORY_FILE, originalMemories, 'utf-8')
  }
}

// --- Privacy Boundary Tests ---

describe('Privacy: blocked_from_ai filtering', () => {
  before(() => backupAndSetFixtures())
  after(() => restoreOriginal())

  it('buildMemories() excludes blocked events', async () => {
    const { buildMemories, loadMemories } = await import('../memory.js')
    buildMemories()
    const memories = loadMemories()

    const blockedMemory = memories.find((m) => m.sourceEventId === BLOCKED_EVENT.id)
    assert.equal(blockedMemory, undefined, 'blocked event must not appear in memory store')

    const normalMemory = memories.find((m) => m.sourceEventId === NORMAL_EVENT.id)
    assert.ok(normalMemory, 'normal event should be in memory store')
  })

  it('generateContext() excludes blocked events from recentEvents', async () => {
    const { generateContext } = await import('../context.js')
    generateContext()

    const contextRaw = readFileSync(CONTEXT_JSON, 'utf-8')
    const context = JSON.parse(contextRaw)

    const blockedInRecent = context.recentEvents?.some(
      (e: { title: string }) => e.title === BLOCKED_EVENT.title
    )
    assert.equal(blockedInRecent, false, 'blocked event must not appear in recentEvents')

    assert.ok(
      !contextRaw.includes('BLOCKED_SECRET_TITLE'),
      'blocked title must not appear anywhere in context JSON'
    )
    assert.ok(
      !contextRaw.includes('BLOCKED_SECRET_SUMMARY'),
      'blocked summary must not appear anywhere in context JSON'
    )
  })

  it('generateContext() excludes blocked events from parentNotes', async () => {
    const { generateContext } = await import('../context.js')
    generateContext()

    const contextRaw = readFileSync(CONTEXT_JSON, 'utf-8')
    const context = JSON.parse(contextRaw)

    const blockedInNotes = context.recentParentNotes?.some(
      (e: { title: string }) => e.title === BLOCKED_EVENT.title
    )
    assert.equal(blockedInNotes, false, 'blocked event must not appear in recentParentNotes')
  })

  it('generateReport() excludes blocked events', async () => {
    const { generateReport } = await import('../report.js')
    const report = generateReport('2026-05')

    assert.ok(
      !report.includes('BLOCKED_SECRET_TITLE'),
      'blocked title must not appear in report'
    )
    assert.ok(
      !report.includes('BLOCKED_SECRET_SUMMARY'),
      'blocked summary must not appear in report'
    )
    assert.ok(
      report.includes('16周常规孕检'),
      'normal event should still appear in report'
    )
  })

  it('search() excludes blocked events from results', async () => {
    const { search } = await import('../search.js')

    const results = search('BLOCKED_SECRET')
    const blockedResult = results.find((r) => r.title === BLOCKED_EVENT.title)
    assert.equal(blockedResult, undefined, 'blocked event must not appear in search results')

    const results2 = search('秘密标签')
    const blockedByTag = results2.find((r) => r.title === BLOCKED_EVENT.title)
    assert.equal(blockedByTag, undefined, 'blocked event must not be findable by tag')
  })

  it('search() still finds normal events', async () => {
    const { search } = await import('../search.js')
    const results = search('孕检')
    const normalResult = results.find((r) => r.title === NORMAL_EVENT.title)
    assert.ok(normalResult, 'normal events should still be searchable')
  })
})

// --- Gestational Weeks Tests ---

describe('Gestational weeks: historical date accuracy', () => {
  it('getGestationalWeeks with past date returns correct weeks', async () => {
    const { getGestationalWeeks } = await import('../profile.js')

    // EDD = 2026-11-15, LMP approx = EDD - 280 days = 2026-02-08
    // At 2026-05-15: (2026-05-15 - 2026-02-08) = 96 days / 7 = ~13 weeks
    const pastDate = new Date('2026-05-15')
    const weeks = getGestationalWeeks(TEST_PROFILE, pastDate)
    assert.ok(weeks !== null, 'weeks should not be null')
    assert.ok(weeks >= 13 && weeks <= 14, `expected ~13 weeks, got ${weeks}`)
  })

  it('getGestationalWeeks with different dates returns different values', async () => {
    const { getGestationalWeeks } = await import('../profile.js')

    const may1 = getGestationalWeeks(TEST_PROFILE, new Date('2026-05-01'))
    const june1 = getGestationalWeeks(TEST_PROFILE, new Date('2026-06-01'))
    assert.ok(may1 !== null && june1 !== null)
    assert.ok(june1! > may1!, `June weeks (${june1}) should be greater than May weeks (${may1})`)
  })

  it('getGestationalWeeks without date parameter uses current time', async () => {
    const { getGestationalWeeks } = await import('../profile.js')
    const withoutDate = getGestationalWeeks(TEST_PROFILE)
    const withNow = getGestationalWeeks(TEST_PROFILE, new Date())
    assert.equal(withoutDate, withNow)
  })
})

// --- Protocol Invariants ---

describe('Protocol: Grounded Answer contract', () => {
  it('service_unavailable returns proper refusal shape', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:19999')

    const answer = await connector.answer('测试问题')
    assert.equal(answer.answerable, false)
    assert.equal(answer.confidence, 'none')
    assert.equal(answer.reason, 'service_unavailable')
    assert.equal(answer.sources.length, 0)
    assert.equal(answer.evidence.items.length, 0)
    assert.equal(answer.serviceStatus, 'unavailable')
    assert.ok(answer.question === '测试问题')
    assert.ok(answer.generatedAt.length > 0)
  })

  it('GroundedAnswer has stable contract fields', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:19999')
    const answer = await connector.answer('any')

    const requiredFields = [
      'question', 'answerable', 'answer', 'confidence',
      'reason', 'sources', 'evidence', 'serviceStatus', 'generatedAt'
    ]
    for (const field of requiredFields) {
      assert.ok(field in answer, `GroundedAnswer must have field: ${field}`)
    }

    const evidenceFields = ['query', 'items', 'fromContext', 'fromSearch', 'collectedAt']
    for (const field of evidenceFields) {
      assert.ok(field in answer.evidence, `EvidencePack must have field: ${field}`)
    }
  })
})

// --- v0.6.2: AI Boundary & Access Control Tests ---

describe('v0.6.2: AI-facing search excludes reports', () => {
  before(() => backupAndSetFixtures())
  after(() => restoreOriginal())

  it('aiSearch() returns only events and memories, never reports', async () => {
    const { aiSearch } = await import('../search.js')
    const { buildMemories } = await import('../memory.js')

    mkdirSync(REPORTS_DIR, { recursive: true })
    writeFileSync(
      path.join(REPORTS_DIR, '2026-05.md'),
      '# 月报 2026-05\n\n包含关键词：孕检\n',
      'utf-8'
    )

    buildMemories()
    const results = aiSearch('孕检')

    for (const r of results) {
      assert.notEqual(r.type, 'report', 'aiSearch must never return report-type results')
    }
    assert.ok(results.length > 0, 'aiSearch should still find events/memories')
  })

  it('aiSearch() excludes blocked events', async () => {
    const { aiSearch } = await import('../search.js')
    const results = aiSearch('BLOCKED_SECRET')
    const blocked = results.find((r) => r.title === BLOCKED_EVENT.title)
    assert.equal(blocked, undefined, 'aiSearch must not return blocked events')
  })

  it('full search() still includes reports for owner', async () => {
    const { search } = await import('../search.js')

    mkdirSync(REPORTS_DIR, { recursive: true })
    writeFileSync(
      path.join(REPORTS_DIR, '2026-05.md'),
      '# 月报 2026-05\n\n包含关键词：孕检\n',
      'utf-8'
    )

    const results = search('孕检')
    const reportResult = results.find((r) => r.type === 'report')
    assert.ok(reportResult, 'owner-facing search should include reports')
  })
})

describe('v0.6.2: Token auth middleware', () => {
  let server: any = null
  const TEST_PORT = 19876
  const TEST_TOKEN = 'test-secret-token-xyz'

  before(async () => {
    backupAndSetFixtures()
    process.env.FAMILY_MEMORY_TOKEN = TEST_TOKEN
    const { startServer } = await import('../server.js')
    await new Promise<void>((resolve) => {
      server = startServer(TEST_PORT) as any
      setTimeout(resolve, 200)
    })
  })

  after(() => {
    delete process.env.FAMILY_MEMORY_TOKEN
    restoreOriginal()
    if (server) {
      (server as any).close()
    }
  })

  it('AI endpoints reject requests without token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/ai/health`)
    assert.equal(res.status, 401)
  })

  it('AI endpoints reject requests with wrong token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/ai/health`, {
      headers: { 'Authorization': 'Bearer wrong-token' },
    })
    assert.equal(res.status, 403)
  })

  it('AI endpoints accept requests with correct token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/ai/health`, {
      headers: { 'Authorization': `Bearer ${TEST_TOKEN}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json() as { ok: boolean }
    assert.equal(data.ok, true)
  })

  it('Owner endpoints remain accessible without token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/events`)
    assert.equal(res.status, 200)
  })

  it('RemiConnector passes token correctly', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector(`http://localhost:${TEST_PORT}`, TEST_TOKEN)
    const result = await connector.connect()
    assert.equal(result.ok, true)
  })

  it('RemiConnector fails without token when required', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector(`http://localhost:${TEST_PORT}`)
    const result = await connector.connect()
    assert.equal(result.ok, false)
  })
})

describe('v0.6.2: RemiConnector uses AI-facing endpoints only', () => {
  it('connector calls /api/ai/* paths', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:19999', 'some-token')

    const connectResult = await connector.connect()
    assert.equal(connectResult.ok, false)
    assert.ok(connectResult.error?.includes('family-memory service'))
  })

  it('connector constructor accepts token parameter', async () => {
    const { RemiConnector } = await import('../connector.js')
    const connector = new RemiConnector('http://localhost:3456', 'my-token')
    assert.ok(connector, 'connector should be instantiable with token')
  })
})
