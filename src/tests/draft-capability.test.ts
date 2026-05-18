import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-draft-cap-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

import { DraftCapability } from '../draft-capability.js'
import { saveDraft, ensureDraftDirs, pendingDir } from '../drafts.js'
import type { DraftNote } from '../types.js'

function makeDraft(id: string, date: string, filename: string): DraftNote {
  return {
    draftId: id,
    batchId: 'batch-cap-test',
    status: 'pending',
    inferredDate: date,
    inferredTitle: null,
    inferredType: null,
    attachmentIds: [`att-${id}`],
    originalFilenames: [filename],
    source: 'asset_intake',
    reviewStatus: 'draft',
    captureStatus: 'pending_parent_review',
    uncertainFields: ['title', 'type'],
    createdAt: new Date().toISOString(),
  }
}

function clearPending() {
  const dir = pendingDir()
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
}

before(() => {
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/notes'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'events'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'profile'), { recursive: true })
  writeFileSync(path.join(TEST_DATA_DIR, 'profile/baby.json'), JSON.stringify({
    babyId: 'baby-cap-test',
    nickname: '小豆',
    expectedBirthDate: '2026-11-15',
    parents: [{ role: 'father', name: '吴健' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  }, null, 2), 'utf-8')
  ensureDraftDirs()
})

describe('DraftCapability: service unavailable', () => {
  it('returns handled=true with unavailable message', () => {
    const cap = new DraftCapability()
    cap.setServiceAvailable(false)
    const r = cap.handle('有什么待确认的？')
    assert.equal(r.handled, true)
    assert.equal(r.response, '家庭记忆服务暂不可用')
  })
})

describe('DraftCapability: list pending ("有什么待确认的？")', () => {
  let cap: DraftCapability

  before(() => {
    clearPending()
    saveDraft(makeDraft('cap-list-001', '2026-05-10', '2026-05-10-checkup.pdf'))
    saveDraft(makeDraft('cap-list-002', '2026-05-12', '20260512_ultrasound.jpg'))
    cap = new DraftCapability()
  })

  it('"有什么待确认的？" returns numbered list', () => {
    const r = cap.handle('有什么待确认的？')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('待确认 draft'))
    assert.ok(r.response.includes('1.'))
    assert.ok(r.response.includes('2.'))
    assert.ok(r.response.includes('2026-05-10'))
    assert.ok(r.response.includes('请先选择编号'))
    assert.equal(r.pendingCount, 2)
  })
})

describe('DraftCapability: multi-draft bare confirm is rejected', () => {
  let cap: DraftCapability

  before(() => {
    clearPending()
    saveDraft(makeDraft('cap-multi-001', '2026-05-10', '2026-05-10-checkup.pdf'))
    saveDraft(makeDraft('cap-multi-002', '2026-05-12', '20260512_ultrasound.jpg'))
    cap = new DraftCapability()
  })

  it('"确认" with >1 pending and no selection is rejected', () => {
    const r = cap.handle('确认')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('请先选择编号'))
    assert.ok(r.response.includes('不能直接确认'))
    assert.equal(r.activeDraftId, null)
  })
})

describe('DraftCapability: select → summary → confirm flow', () => {
  let cap: DraftCapability

  before(() => {
    clearPending()
    saveDraft(makeDraft('cap-flow-001', '2026-05-10', '2026-05-10-checkup.pdf'))
    saveDraft(makeDraft('cap-flow-002', '2026-05-12', '20260512_ultrasound.jpg'))
    cap = new DraftCapability()
  })

  it('"选择 1" selects the first draft', () => {
    const r = cap.handle('选择 1')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('已选择第 1 条'))
    assert.ok(r.response.includes('2026-05-10'))
    assert.equal(r.activeDraftId, 'cap-flow-001')
  })

  it('"补充摘要：这是22周孕检，医生建议补铁" updates summary', () => {
    const r = cap.handle('补充摘要：这是22周孕检，医生建议补铁')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('摘要已更新'))
    assert.ok(r.response.includes('这是22周孕检，医生建议补铁'))
    assert.equal(r.activeSummary, '这是22周孕检，医生建议补铁')
  })

  it('"确认" with active selection succeeds', () => {
    const r = cap.handle('确认')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('已确认'))
    assert.ok(r.response.includes('npm run sync'))
    assert.ok(r.response.includes('正式时间线'))
    assert.ok(r.response.includes('Remi 可查询记忆'))
  })
})

describe('DraftCapability: skip (跳过)', () => {
  let cap: DraftCapability

  before(() => {
    clearPending()
    saveDraft(makeDraft('cap-skip-001', '2026-05-15', '2026-05-15-photo.png'))
    cap = new DraftCapability()
  })

  it('single draft "跳过" rejects it', () => {
    const r = cap.handle('跳过')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('已跳过'))
    assert.equal(r.pendingCount, 0)
  })
})

describe('DraftCapability: single draft allows direct confirm', () => {
  let cap: DraftCapability

  before(() => {
    clearPending()
    saveDraft(makeDraft('cap-single-001', '2026-05-18', '2026-05-18-note.pdf'))
    cap = new DraftCapability()
  })

  it('"有什么待确认的？" with 1 draft auto-selects and says can confirm directly', () => {
    const r = cap.handle('有什么待确认的？')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('只有一条'))
    assert.ok(r.response.includes('直接'))
    assert.equal(r.pendingCount, 1)
    assert.equal(r.activeDraftId, 'cap-single-001')
  })

  it('"确认" with 1 draft succeeds without select', () => {
    const r = cap.handle('确认')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('已确认'))
    assert.ok(r.response.includes('npm run sync'))
  })
})

describe('DraftCapability: intent detection', () => {
  it('detects draft-related intents', () => {
    const cap = new DraftCapability()
    assert.equal(cap.isDraftIntent('有什么待确认的？'), true)
    assert.equal(cap.isDraftIntent('确认'), true)
    assert.equal(cap.isDraftIntent('跳过'), true)
    assert.equal(cap.isDraftIntent('选择 2'), true)
    assert.equal(cap.isDraftIntent('补充摘要：xxx'), true)
    assert.equal(cap.isDraftIntent('宝宝什么时候胎动的？'), false)
    assert.equal(cap.isDraftIntent('你好'), false)
  })
})

describe('DraftCapability: empty state', () => {
  before(() => {
    clearPending()
  })

  it('"确认" with no drafts returns appropriate message', () => {
    const cap = new DraftCapability()
    const r = cap.handle('确认')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('没有待确认'))
  })

  it('"有什么待确认的？" with no drafts', () => {
    const cap = new DraftCapability()
    const r = cap.handle('有什么待确认的？')
    assert.equal(r.handled, true)
    assert.ok(r.response.includes('没有待确认'))
    assert.equal(r.pendingCount, 0)
  })
})
