import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { saveOcrSidecar } from '../drafts.js'
import { buildDraftReviewEvidence, extractOcrKeyLines, isUsefulVlmFact } from '../review_evidence.js'
import type { Attachment, DraftNote } from '../types.js'

process.env.REMI_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-review-evidence-'))

describe('review evidence helpers', () => {
  it('filters obvious garbage VLM facts', () => {
    assert.equal(isUsefulVlmFact('1234567890'), false)
    assert.equal(isUsefulVlmFact('abcdefghijklmnopqrstuvwxyz'), false)
    assert.equal(isUsefulVlmFact('NT 1.3mm'), true)
    assert.equal(isUsefulVlmFact('胎心 159次/分'), true)
  })

  it('extracts confirmable OCR key lines', () => {
    const lines = extractOcrKeyLines(`
      浙江大学医学院附属妇产科医院
      日期：2026-04-30
      影像所见：
      经腹超声：宫腔内见一胎儿，头臀高4.8cm，胎心胎动可及。
      普通噪声
    `)

    assert.ok(lines.some((line) => line.includes('2026-04-30')))
    assert.ok(lines.some((line) => line.includes('头臀高4.8cm')))
  })

  it('does not suggest OCR boilerplate as facts', () => {
    const draft: DraftNote = {
      draftId: 'draft-review-facts',
      batchId: 'batch-review-facts',
      createdAt: '2026-05-19T00:00:00.000Z',
      source: 'asset_intake',
      status: 'pending',
      attachmentIds: ['att-review-facts'],
      originalFilenames: ['checkup.png'],
      inferredDate: '2026-05-19',
      inferredTitle: null,
      inferredType: 'pregnancy_checkup',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: [],
      extractedFacts: ['1234567890'],
      ocrStatus: 'extracted',
    }
    const attachments: Attachment[] = [{
      attachmentId: 'att-review-facts',
      type: 'image',
      mimeType: 'image/png',
      originalFilename: 'checkup.png',
      storedPath: '/tmp/checkup.png',
      sha256: 'abc',
      size: 1,
      createdAt: '2026-05-19T00:00:00.000Z',
      importedAt: '2026-05-19T00:00:00.000Z',
      schemaVersion: '1.1.1.1',
    }]
    saveOcrSidecar({
      attachmentId: 'att-review-facts',
      attachmentType: 'image',
      extractorId: 'test',
      status: 'extracted',
      charCount: 120,
      extractedAt: '2026-05-19T00:00:00.000Z',
      schemaVersion: '1.1.1.1',
    }, `
      X 报告详情
      NO 项目/单位 结果/参考
      检验时间 2026-05-19 09:00:44
      1 25-羟基维生素D 13.650
      2 乙肝表面抗原 阴性
    `)

    const evidence = buildDraftReviewEvidence(draft, attachments)

    assert.deepEqual(evidence.usefulVlmFacts, [])
    assert.ok(!evidence.suggestedFacts.some((fact) => fact.includes('报告详情')))
    assert.ok(!evidence.suggestedFacts.some((fact) => /NO\s*项目/.test(fact)))
    assert.ok(evidence.suggestedFacts.some((fact) => fact.includes('检验时间 2026-05-19')))
    assert.ok(evidence.suggestedFacts.some((fact) => fact.includes('25-羟基维生素D')))
  })
})
