import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-daily-flow-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

const PROFILE_DIR = path.join(TEST_DATA_DIR, 'profile')
const PROFILE_FILE = path.join(PROFILE_DIR, 'baby.json')

import { writeParentCapture } from '../capture.js'
import { loadPendingDrafts, saveDraft, ensureDraftDirs } from '../drafts.js'
import type { BabyProfile, DraftNote } from '../types.js'

const TEST_PROFILE: BabyProfile = {
  babyId: 'baby-test-001',
  nickname: '小豆',
  expectedBirthDate: '2026-11-15',
  parents: [{ role: 'father', name: '吴健' }, { role: 'mother', name: '小丽' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
}

before(() => {
  mkdirSync(PROFILE_DIR, { recursive: true })
  writeFileSync(PROFILE_FILE, JSON.stringify(TEST_PROFILE, null, 2), 'utf-8')
  ensureDraftDirs()
})

describe('v1.5: Parent Quick Capture', () => {
  it('captures text and writes to inbox', () => {
    const result = writeParentCapture({ text: '今天做了四维彩超，宝宝很健康' })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.ok(result.noteId)
      assert.ok(result.filePath.includes('parent-'))
      assert.equal(result.lifecycle, 'captured_to_inbox')
    }
  })

  it('sets confirmedByParent: true in generated file', () => {
    const result = writeParentCapture({ text: '孕期第16周检查正常' })
    assert.equal(result.ok, true)
    if (result.ok) {
      const fullPath = path.resolve(result.filePath)
      assert.ok(existsSync(fullPath))
      const content = readFileSync(fullPath, 'utf-8')
      assert.ok(content.includes('confirmedByParent: true'))
      assert.ok(content.includes("source: parent_web"))
      assert.ok(content.includes("captureSource: review_page"))
    }
  })

  it('rejects empty text', () => {
    const result = writeParentCapture({ text: '' })
    assert.equal(result.ok, false)
  })

  it('rejects whitespace-only text', () => {
    const result = writeParentCapture({ text: '   ' })
    assert.equal(result.ok, false)
  })

  it('blocks privacy-marked content', () => {
    const result = writeParentCapture({ text: '这件事不要给AI看' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'privacy_blocked')
  })

  it('applies stage guardrail', () => {
    const result = writeParentCapture({ text: '宝宝今天翻身了' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'stage_guardrail')
  })

  it('uses provided date', () => {
    const result = writeParentCapture({ text: '今天胎动很明显', date: '2026-05-15' })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.ok(result.filePath.includes('2026-05-15'))
    }
  })

  it('does not bypass parent confirmation gate (no auto-confirm path)', () => {
    const result = writeParentCapture({ text: '一条普通的孕期记录' })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.lifecycle, 'captured_to_inbox')
      assert.ok(result.message.includes('sync'))
    }
  })
})

describe('v1.5: Dashboard Stats', () => {
  it('loadPendingDrafts returns correct count after adding test drafts', () => {
    const draft1: DraftNote = {
      draftId: 'test-dash-1',
      batchId: 'test-batch',
      status: 'pending',
      inferredDate: '2026-05-19',
      inferredTitle: '16周孕检报告',
      inferredType: 'pregnancy_checkup',
      attachmentIds: ['att-1'],
      originalFilenames: ['report.pdf'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: [],
      ocrStatus: 'extracted',
      createdAt: new Date().toISOString(),
    }

    const draft2: DraftNote = {
      draftId: 'test-dash-2',
      batchId: 'test-batch',
      status: 'pending',
      inferredDate: '2026-05-19',
      inferredTitle: null,
      inferredType: null,
      attachmentIds: ['att-2'],
      originalFilenames: ['unknown.jpg'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      ocrStatus: 'error',
      createdAt: new Date().toISOString(),
    }

    saveDraft(draft1)
    saveDraft(draft2)

    const pending = loadPendingDrafts()
    assert.ok(pending.length >= 2)

    const needsTitle = pending.filter(d => !d.inferredTitle)
    assert.ok(needsTitle.length >= 1)

    const ocrError = pending.filter(d => d.ocrStatus === 'error')
    assert.ok(ocrError.length >= 1)

    const ready = pending.filter(d => d.inferredTitle && d.inferredDate)
    assert.ok(ready.length >= 1)
  })
})

describe('v1.5: Confirmed-only gate preserved', () => {
  it('quick capture goes to inbox not directly to memories', () => {
    const result = writeParentCapture({ text: '今天感受到胎动了' })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.lifecycle, 'captured_to_inbox')
      assert.ok(!result.filePath.includes('memory'))
      assert.ok(result.filePath.includes('inbox'))
    }
  })
})
