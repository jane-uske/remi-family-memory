import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// --- Test Isolation ---

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-capture-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

const PROFILE_DIR = path.join(TEST_DATA_DIR, 'profile')
const PROFILE_FILE = path.join(PROFILE_DIR, 'baby.json')

import { detectRecordIntent, detectPrivacyBlock, writeInboxNote, checkStageGuardrail, getCurrentStage } from '../capture.js'
import type { BabyProfile } from '../types.js'

// --- Test Profile (pregnancy, expected Nov 2026) ---

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
})

// --- v0.9.2: Stage-Aware Guardrail ---

describe('v0.9.2: Stage-Aware Capture Guardrail', () => {
  it('getCurrentStage returns 孕期 for pregnancy profile', () => {
    const stage = getCurrentStage()
    assert.equal(stage, '孕期')
  })

  it('blocks post-birth milestones during pregnancy', () => {
    const result = checkStageGuardrail('今天宝宝第一次翻身了')
    assert.equal(result.blocked, true)
    if (result.blocked) {
      assert.equal(result.reason, 'post_birth_content_during_pregnancy')
      assert.ok(result.keywords.includes('翻身'))
    }
  })

  it('blocks walking milestone during pregnancy', () => {
    const result = checkStageGuardrail('宝宝学走路了')
    assert.equal(result.blocked, true)
    if (result.blocked) {
      assert.ok(result.keywords.includes('走路'))
    }
  })

  it('blocks speaking milestone during pregnancy', () => {
    const result = checkStageGuardrail('宝宝会叫妈妈了')
    assert.equal(result.blocked, true)
    if (result.blocked) {
      assert.ok(result.keywords.includes('说话'))
    }
  })

  it('blocks school-related during pregnancy', () => {
    const result = checkStageGuardrail('宝宝上幼儿园了')
    assert.equal(result.blocked, true)
    if (result.blocked) {
      assert.ok(result.keywords.includes('上学'))
    }
  })

  it('blocks vaccine (post-birth) during pregnancy', () => {
    const result = checkStageGuardrail('出生后打了第一针疫苗')
    assert.equal(result.blocked, true)
    if (result.blocked) {
      assert.ok(result.keywords.includes('出生后疫苗'))
    }
  })

  it('does not block pregnancy-appropriate content', () => {
    const result = checkStageGuardrail('今天胎动很频繁')
    assert.equal(result.blocked, false)
  })

  it('does not block general parent notes during pregnancy', () => {
    const result = checkStageGuardrail('今天去公园散步了')
    assert.equal(result.blocked, false)
  })

  it('does not block when stage is 已出生', () => {
    const result = checkStageGuardrail('今天宝宝翻身了', '已出生')
    assert.equal(result.blocked, false)
  })

  it('does not block when stage is unknown', () => {
    const result = checkStageGuardrail('今天宝宝翻身了', 'unknown')
    assert.equal(result.blocked, false)
  })

  it('detects multiple milestones in one text', () => {
    const result = checkStageGuardrail('宝宝又翻身又走路了')
    assert.equal(result.blocked, true)
    if (result.blocked) {
      assert.ok(result.keywords.includes('翻身'))
      assert.ok(result.keywords.includes('走路'))
    }
  })
})

// --- v0.9.2: writeInboxNote stage guardrail ---

describe('v0.9.2: writeInboxNote with Stage Guardrail', () => {
  it('rejects post-birth content during pregnancy with stage_guardrail error', () => {
    const result = writeInboxNote({
      text: '宝宝第一次翻身了',
      confirmedByParent: true,
      source: 'remi',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'stage_guardrail')
      assert.ok(result.message.includes('翻身'))
      assert.ok(result.message.includes('孕期'))
    }
  })

  it('allows pregnancy-appropriate content', () => {
    const result = writeInboxNote({
      text: '今天孕检一切正常',
      date: '2026-05-18',
      confirmedByParent: true,
      source: 'remi',
    })
    assert.equal(result.ok, true)
  })
})

// --- v0.9.2: Enhanced Note Metadata ---

describe('v0.9.2: Enhanced Note Metadata', () => {
  it('written note contains capturedBy, captureSource, captureStatus, confirmedAt', () => {
    const result = writeInboxNote({
      text: '今天感觉宝宝胎动了',
      date: '2026-05-18',
      confirmedByParent: true,
      source: 'remi',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      const absPath = path.resolve(result.filePath)
      const content = readFileSync(absPath, 'utf-8')
      assert.ok(content.includes('capturedBy: remi'))
      assert.ok(content.includes('captureSource: websocket'))
      assert.ok(content.includes('captureStatus: captured_to_inbox'))
      assert.ok(content.includes('confirmedAt:'))
    }
  })

  it('result includes lifecycle field', () => {
    const result = writeInboxNote({
      text: '今天去医院了',
      date: '2026-05-18',
      confirmedByParent: true,
      source: 'remi',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.lifecycle, 'captured_to_inbox')
    }
  })
})

// --- v0.9.2: Capture Lifecycle States ---

describe('v0.9.2: Capture Lifecycle', () => {
  it('success message indicates captured_to_inbox state', () => {
    const result = writeInboxNote({
      text: '今天第一次感受到胎动',
      date: '2026-05-18',
      confirmedByParent: true,
      source: 'remi',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.ok(result.message.includes('收件箱'))
      assert.equal(result.lifecycle, 'captured_to_inbox')
    }
  })
})
