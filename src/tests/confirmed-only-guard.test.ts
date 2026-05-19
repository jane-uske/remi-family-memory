import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { BabyEvent, BabyProfile } from '../types.js'
import { SCHEMA_VERSION } from '../types.js'

// --- Test Isolation: all data writes go to a temp directory ---

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-confirmed-guard-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

const EVENTS_DIR = path.join(TEST_DATA_DIR, 'events')
const EVENTS_FILE = path.join(EVENTS_DIR, 'events.json')
const PROFILE_DIR = path.join(TEST_DATA_DIR, 'profile')
const PROFILE_FILE = path.join(PROFILE_DIR, 'baby.json')
const MEMORY_DIR = path.join(TEST_DATA_DIR, 'memory')
const CONTEXT_DIR = path.join(TEST_DATA_DIR, 'context')
const REPORTS_DIR = path.join(TEST_DATA_DIR, 'reports')

// --- Test Fixtures ---

const CONFIRMED_EVENT: BabyEvent = {
  id: 'confirmed-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-10T00:00:00.000Z',
  type: 'pregnancy_checkup',
  title: '13周孕检',
  summary: 'B超正常，胎儿发育良好',
  source: { kind: 'folder', path: 'data/inbox/notes/13w-checkup.md' },
  people: ['妈妈', '爸爸'],
  tags: ['孕检', '13周'],
  sensitivity: 'normal',
  confirmedByParent: true,
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
}

const UNCONFIRMED_EVENT: BabyEvent = {
  id: 'unconfirmed-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-12T00:00:00.000Z',
  type: 'pregnancy_checkup',
  title: 'UNCONFIRMED_15周孕检',
  summary: 'UNCONFIRMED_SUMMARY_应该不可见',
  source: { kind: 'folder', path: 'data/inbox/notes/15w-unconfirmed.md' },
  people: ['妈妈'],
  tags: ['孕检', '15周'],
  sensitivity: 'normal',
  confirmedByParent: false,
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
}

const BLOCKED_CONFIRMED_EVENT: BabyEvent = {
  id: 'blocked-confirmed-001',
  childId: 'baby-001',
  schemaVersion: SCHEMA_VERSION,
  occurredAt: '2026-05-14T00:00:00.000Z',
  type: 'medical_record',
  title: 'BLOCKED_BUT_CONFIRMED',
  summary: 'This is blocked even though confirmed',
  source: { kind: 'manual', path: 'data/inbox/notes/blocked.md' },
  people: ['妈妈'],
  tags: ['private'],
  sensitivity: 'blocked_from_ai',
  confirmedByParent: true,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
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

function setupFixtures() {
  mkdirSync(EVENTS_DIR, { recursive: true })
  mkdirSync(PROFILE_DIR, { recursive: true })
  mkdirSync(MEMORY_DIR, { recursive: true })
  mkdirSync(CONTEXT_DIR, { recursive: true })
  mkdirSync(REPORTS_DIR, { recursive: true })

  writeFileSync(
    EVENTS_FILE,
    JSON.stringify([CONFIRMED_EVENT, UNCONFIRMED_EVENT, BLOCKED_CONFIRMED_EVENT], null, 2),
    'utf-8',
  )
  writeFileSync(PROFILE_FILE, JSON.stringify(TEST_PROFILE, null, 2), 'utf-8')
}

function cleanupTempDir() {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true })
}

// --- Confirmed-Only Guard Tests ---

describe('Confirmed-only guard: unconfirmed events excluded from AI', () => {
  before(() => setupFixtures())
  after(() => cleanupTempDir())

  it('listAISafeEvents() excludes unconfirmed events', async () => {
    const { listAISafeEvents } = await import('../store.js')
    const events = listAISafeEvents()

    const unconfirmed = events.find((e) => e.id === UNCONFIRMED_EVENT.id)
    assert.equal(unconfirmed, undefined, 'unconfirmed event must not appear in AI-safe events')
  })

  it('listAISafeEvents() includes confirmed events', async () => {
    const { listAISafeEvents } = await import('../store.js')
    const events = listAISafeEvents()

    const confirmed = events.find((e) => e.id === CONFIRMED_EVENT.id)
    assert.ok(confirmed, 'confirmed event should appear in AI-safe events')
  })

  it('listAISafeEvents() still excludes blocked_from_ai even if confirmed', async () => {
    const { listAISafeEvents } = await import('../store.js')
    const events = listAISafeEvents()

    const blocked = events.find((e) => e.id === BLOCKED_CONFIRMED_EVENT.id)
    assert.equal(blocked, undefined, 'blocked_from_ai event must not appear even if confirmed')
  })

  it('listEvents() returns all events regardless of confirmation status', async () => {
    const { listEvents } = await import('../store.js')
    const events = listEvents()

    assert.equal(events.length, 3, 'listEvents should return all 3 events')
    const unconfirmed = events.find((e) => e.id === UNCONFIRMED_EVENT.id)
    assert.ok(unconfirmed, 'listEvents should include unconfirmed for owner access')
  })
})

describe('Confirmed-only guard: buildMemories skips unconfirmed', () => {
  before(() => setupFixtures())

  it('buildMemories() does not create memory for unconfirmed events', async () => {
    const { buildMemories, loadMemories } = await import('../memory.js')
    buildMemories()
    const memories = loadMemories()

    const unconfirmedMemory = memories.find((m) => m.sourceEventId === UNCONFIRMED_EVENT.id)
    assert.equal(
      unconfirmedMemory,
      undefined,
      'unconfirmed event must not generate a memory record',
    )
  })

  it('buildMemories() creates memory for confirmed events', async () => {
    const { loadMemories } = await import('../memory.js')
    const memories = loadMemories()

    const confirmedMemory = memories.find((m) => m.sourceEventId === CONFIRMED_EVENT.id)
    assert.ok(confirmedMemory, 'confirmed event should generate a memory record')
    assert.equal(confirmedMemory.title, '13周孕检')
  })

  it('buildMemories() skips blocked_from_ai events', async () => {
    const { loadMemories } = await import('../memory.js')
    const memories = loadMemories()

    const blockedMemory = memories.find((m) => m.sourceEventId === BLOCKED_CONFIRMED_EVENT.id)
    assert.equal(blockedMemory, undefined, 'blocked event must not generate memory')
  })
})

describe('Confirmed-only guard: aiSearch excludes unconfirmed', () => {
  before(() => setupFixtures())

  it('aiSearch() does not return unconfirmed event content', async () => {
    const { aiSearch } = await import('../search.js')

    const results = aiSearch('UNCONFIRMED')
    const unconfirmed = results.find((r) => r.title === UNCONFIRMED_EVENT.title)
    assert.equal(unconfirmed, undefined, 'aiSearch must not find unconfirmed events')
  })

  it('aiSearch() does not return unconfirmed event by tag', async () => {
    const { aiSearch } = await import('../search.js')

    const results = aiSearch('15周')
    const unconfirmed = results.find((r) => r.title === UNCONFIRMED_EVENT.title)
    assert.equal(unconfirmed, undefined, 'aiSearch must not find unconfirmed events by tag')
  })

  it('aiSearch() returns confirmed event content', async () => {
    const { aiSearch } = await import('../search.js')
    const { buildMemories } = await import('../memory.js')
    buildMemories()

    const results = aiSearch('13周')
    assert.ok(results.length > 0, 'aiSearch should find confirmed events')
    const confirmed = results.find(
      (r) => r.title === CONFIRMED_EVENT.title || r.title === '13周孕检',
    )
    assert.ok(confirmed, 'aiSearch should return confirmed event')
  })
})

describe('Confirmed-only guard: generateContext excludes unconfirmed', () => {
  before(() => setupFixtures())

  it('context JSON does not contain unconfirmed event data', async () => {
    const { generateContext } = await import('../context.js')
    generateContext()

    const contextJsonPath = path.join(CONTEXT_DIR, 'remi-context.json')
    const contextRaw = readFileSync(contextJsonPath, 'utf-8')

    assert.ok(
      !contextRaw.includes('UNCONFIRMED_15周孕检'),
      'unconfirmed event title must not appear in context',
    )
    assert.ok(
      !contextRaw.includes('UNCONFIRMED_SUMMARY'),
      'unconfirmed event summary must not appear in context',
    )
  })

  it('context JSON includes confirmed event data', async () => {
    const contextJsonPath = path.join(CONTEXT_DIR, 'remi-context.json')
    const contextRaw = readFileSync(contextJsonPath, 'utf-8')

    assert.ok(
      contextRaw.includes('13周孕检'),
      'confirmed event should appear in context',
    )
  })

  it('context markdown does not leak unconfirmed event', async () => {
    const contextMdPath = path.join(CONTEXT_DIR, 'remi-context.md')
    const mdRaw = readFileSync(contextMdPath, 'utf-8')

    assert.ok(
      !mdRaw.includes('UNCONFIRMED_15周孕检'),
      'unconfirmed event title must not appear in context markdown',
    )
    assert.ok(
      !mdRaw.includes('UNCONFIRMED_SUMMARY'),
      'unconfirmed event summary must not appear in context markdown',
    )
  })
})

describe('Confirmed-only guard: owner-facing APIs still show all', () => {
  before(() => setupFixtures())

  it('listEvents() returns unconfirmed events for owner', async () => {
    const { listEvents } = await import('../store.js')
    const events = listEvents()

    const unconfirmed = events.find((e) => e.id === UNCONFIRMED_EVENT.id)
    assert.ok(unconfirmed, 'owner-facing listEvents must include unconfirmed')
  })

  it('search() returns unconfirmed events for owner', async () => {
    const { search } = await import('../search.js')
    const results = search('UNCONFIRMED')

    const found = results.find((r) => r.title === UNCONFIRMED_EVENT.title)
    assert.ok(found, 'owner-facing search must include unconfirmed events')
  })
})

// ============================================================
// E2E: Full pipeline with mock VLM — subdirectory scan → enrich → confirm → memory
// ============================================================

describe('E2E: full pipeline scan → intake → enrich → confirm → memory (mock VLM)', () => {
  const E2E_DIR = mkdtempSync(path.join(tmpdir(), 'remi-e2e-pipeline-'))
  let savedDataDir: string
  let draftId: string

  const MOCK_VLM_FACTS = ['13周孕检', 'B超正常', 'NT: 1.2mm']

  const mockVlmFetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          inferredDate: '2026-04-15',
          inferredType: 'pregnancy_checkup',
          inferredTitle: '13周超声检查',
          inferredSummary: 'NT筛查超声报告',
          facts: MOCK_VLM_FACTS,
          inferredTags: ['孕检', '超声'],
          uncertainFields: [],
          warnings: [],
          needsParentReview: true,
        }),
      },
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  before(() => {
    savedDataDir = process.env.REMI_DATA_DIR!
    process.env.REMI_DATA_DIR = E2E_DIR
    process.env.VLM_MODEL = 'mock-model'

    mkdirSync(path.join(E2E_DIR, 'inbox/assets/13w-checkup'), { recursive: true })
    mkdirSync(path.join(E2E_DIR, 'inbox/notes'), { recursive: true })
    mkdirSync(path.join(E2E_DIR, 'events'), { recursive: true })
    mkdirSync(path.join(E2E_DIR, 'profile'), { recursive: true })
    mkdirSync(path.join(E2E_DIR, 'memory'), { recursive: true })

    writeFileSync(path.join(E2E_DIR, 'profile/baby.json'), JSON.stringify({
      babyId: 'baby-e2e',
      nickname: '小豆',
      expectedBirthDate: '2026-11-15',
      parents: [{ role: 'father', name: '吴健' }, { role: 'mother', name: '小丽' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    }, null, 2), 'utf-8')

    // Minimal valid PNG (1x1 pixel, RGB)
    writeFileSync(path.join(E2E_DIR, 'inbox/assets/13w-checkup/IMG_6663.png'), Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]))
    // Minimal valid PNG (1x1 pixel, grayscale — different sha256)
    writeFileSync(path.join(E2E_DIR, 'inbox/assets/13w-checkup/IMG_6664.png'), Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x00, 0x00, 0x00, 0x00, 0x3a, 0x7e, 0x9b, 0x55, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0x60, 0x00, 0x00, 0x00,
      0x02, 0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]))
  })

  after(() => {
    process.env.REMI_DATA_DIR = savedDataDir
    delete process.env.VLM_MODEL
  })

  it('scan-assets picks up both PNGs from 13w-checkup/', async () => {
    const { scanAssets, loadAttachments } = await import('../attachments.js')
    const result = scanAssets()
    assert.equal(result.added, 2)

    const attachments = loadAttachments()
    const relPaths = attachments.map((a) => a.originalRelativePath).sort()
    assert.ok(relPaths.includes('13w-checkup/IMG_6663.png'))
    assert.ok(relPaths.includes('13w-checkup/IMG_6664.png'))
  })

  it('intake-assets groups both images into one pending draft', async () => {
    const { intakeAssets } = await import('../intake.js')
    const result = await intakeAssets()
    assert.equal(result.draftsCreated, 1)

    const { loadPendingDrafts } = await import('../drafts.js')
    const pending = loadPendingDrafts()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].attachmentIds.length, 2)
    assert.equal(pending[0].inferredTitle, '13w-checkup 资料')
    assert.ok(pending[0].originalRelativePaths?.includes('13w-checkup/IMG_6663.png'))
    assert.ok(pending[0].originalRelativePaths?.includes('13w-checkup/IMG_6664.png'))
    draftId = pending[0].draftId
  })

  it('pending draft NOT visible in events, memory, or search', async () => {
    const { listEvents } = await import('../store.js')
    const { buildMemories, loadMemories } = await import('../memory.js')
    const { search } = await import('../search.js')

    assert.equal(listEvents().length, 0)
    buildMemories()
    assert.equal(loadMemories().length, 0)

    const results = search('13周孕检')
    assert.equal(results.filter((r) => r.matchedText.includes('13周孕检')).length, 0)
  })

  it('enrichDraft with mock VLM writes extractedFacts to pending draft', async () => {
    const { enrichDraft } = await import('../draft_enrichment.js')
    const result = await enrichDraft(draftId, mockVlmFetch)
    assert.equal(result.ok, true)

    const { loadPendingDrafts } = await import('../drafts.js')
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === draftId)
    assert.ok(draft)
    assert.deepEqual(draft.extractedFacts, MOCK_VLM_FACTS)
    assert.equal(draft.extractionMetadata?.model, 'mock-model')
    assert.equal(draft.status, 'pending')
  })

  it('after enrichment, facts still NOT in events/memory/search', async () => {
    const { listEvents } = await import('../store.js')
    const { buildMemories, loadMemories } = await import('../memory.js')
    const { search } = await import('../search.js')

    assert.equal(listEvents().length, 0)
    buildMemories()
    assert.equal(loadMemories().length, 0)
    assert.equal(search('NT: 1.2mm').filter((r) => r.matchedText.includes('NT')).length, 0)
  })

  it('confirmDraft with parent facts override replaces VLM candidates', async () => {
    const { confirmDraft } = await import('../drafts.js')
    const result = confirmDraft(draftId, {
      title: '13周NT筛查',
      date: '2026-04-15',
      type: 'pregnancy_checkup',
      summary: '一切顺利',
      facts: ['NT: 1.2mm（正常范围）', '胎心率正常'],
      tags: ['孕检'],
    })

    assert.equal(result.ok, true)
    if (result.ok) {
      const content = readFileSync(path.resolve(result.filePath), 'utf-8')
      assert.ok(content.includes('NT: 1.2mm（正常范围）'))
      assert.ok(content.includes('胎心率正常'))
      assert.ok(!content.includes('B超正常'), 'VLM candidate fact should be overridden')
    }
  })

  it('scan processes note into event with parent-approved facts', async () => {
    const { scanInbox } = await import('../scanner.js')
    const { listEvents } = await import('../store.js')
    scanInbox()

    const events = listEvents()
    const event = events.find((e) => e.title === '13周NT筛查')
    assert.ok(event)
    assert.equal(event.confirmedByParent, true)
    assert.ok(event.facts)
    assert.ok(event.facts!.includes('NT: 1.2mm（正常范围）'))
    assert.ok(event.facts!.includes('胎心率正常'))
    assert.ok(!event.facts!.includes('B超正常'))
  })

  it('buildMemories includes parent-approved facts in MemoryRecord', async () => {
    const { buildMemories, loadMemories } = await import('../memory.js')
    buildMemories()

    const memories = loadMemories()
    const mem = memories.find((m) => m.title === '13周NT筛查')
    assert.ok(mem)
    assert.ok(mem.facts.includes('NT: 1.2mm（正常范围）'))
    assert.ok(mem.facts.includes('胎心率正常'))
    assert.ok(!mem.facts.includes('B超正常'))
  })

  it('search now finds confirmed facts', async () => {
    const { search } = await import('../search.js')
    const results = search('NT: 1.2mm')
    assert.ok(results.length > 0)
  })

  it('originalRelativePath preserved through the full pipeline', async () => {
    const { loadAttachments } = await import('../attachments.js')
    const attachments = loadAttachments()
    assert.ok(attachments.find((a) => a.originalRelativePath === '13w-checkup/IMG_6663.png'))
    assert.ok(attachments.find((a) => a.originalRelativePath === '13w-checkup/IMG_6664.png'))
  })
})

describe('E2E: rejected enriched draft is never queryable', () => {
  const REJECT_DIR = mkdtempSync(path.join(tmpdir(), 'remi-e2e-reject-'))
  let savedDataDir: string
  let rejectDraftId: string

  before(async () => {
    savedDataDir = process.env.REMI_DATA_DIR!
    process.env.REMI_DATA_DIR = REJECT_DIR
    process.env.VLM_MODEL = 'mock-model'

    mkdirSync(path.join(REJECT_DIR, 'inbox/assets/rejected-checkup'), { recursive: true })
    mkdirSync(path.join(REJECT_DIR, 'inbox/notes'), { recursive: true })
    mkdirSync(path.join(REJECT_DIR, 'events'), { recursive: true })
    mkdirSync(path.join(REJECT_DIR, 'profile'), { recursive: true })
    mkdirSync(path.join(REJECT_DIR, 'memory'), { recursive: true })

    writeFileSync(path.join(REJECT_DIR, 'profile/baby.json'), JSON.stringify({
      babyId: 'baby-reject-e2e',
      nickname: '小豆',
      expectedBirthDate: '2026-11-15',
      parents: [{ role: 'father', name: '吴健' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    }, null, 2), 'utf-8')

    writeFileSync(path.join(REJECT_DIR, 'inbox/assets/rejected-checkup/reject-img.png'), 'unique-reject-e2e-content')

    const { scanAssets } = await import('../attachments.js')
    const { intakeAssets } = await import('../intake.js')
    scanAssets()
    await intakeAssets()

    const { loadPendingDrafts, saveDraft } = await import('../drafts.js')
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.originalFilenames.includes('reject-img.png'))
    assert.ok(draft)
    rejectDraftId = draft.draftId
    draft.extractedFacts = ['不应出现的rejected事实', 'reject-secret-data']
    saveDraft(draft)
  })

  after(() => {
    process.env.REMI_DATA_DIR = savedDataDir
    delete process.env.VLM_MODEL
  })

  it('rejectDraft succeeds', async () => {
    const { rejectDraft } = await import('../drafts.js')
    const result = rejectDraft(rejectDraftId)
    assert.equal(result.ok, true)
  })

  it('rejected facts never appear in events', async () => {
    const { listEvents } = await import('../store.js')
    const events = listEvents()
    for (const e of events) {
      if (e.facts) {
        assert.ok(!e.facts.includes('不应出现的rejected事实'))
      }
    }
  })

  it('rejected facts never appear in memory', async () => {
    const { buildMemories, loadMemories } = await import('../memory.js')
    buildMemories()
    const memories = loadMemories()
    for (const m of memories) {
      assert.ok(!m.facts.includes('不应出现的rejected事实'))
      assert.ok(!m.facts.includes('reject-secret-data'))
    }
  })

  it('rejected facts never appear in search', async () => {
    const { search } = await import('../search.js')
    const results = search('不应出现的rejected事实')
    assert.equal(results.length, 0)
    const results2 = search('reject-secret-data')
    assert.equal(results2.length, 0)
  })
})
