import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-enrich-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

import { enrichDraft, enrichPendingDrafts } from '../draft_enrichment.js'
import { saveDraft, loadPendingDrafts, ensureDraftDirs } from '../drafts.js'
import { addAttachment } from '../attachments.js'
import type { FetchFn } from '../local_vlm_extractor.js'
import type { DraftNote, Attachment } from '../types.js'

const VALID_VLM_RESPONSE = {
  inferredDate: '2026-04-20',
  inferredType: 'pregnancy_checkup',
  inferredTitle: 'VLM推断的标题',
  inferredSummary: '超声检查报告',
  facts: ['CRL: 7.2cm', 'NT: 1.2mm'],
  inferredTags: ['孕检'],
  uncertainFields: ['inferredDate'],
  warnings: [],
  needsParentReview: true,
}

function makeMockFetch(output = VALID_VLM_RESPONSE): FetchFn {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(output) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const failedFetch: FetchFn = async () => {
  throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
}

before(() => {
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/notes'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'events'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'archive/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'profile'), { recursive: true })
  ensureDraftDirs()

  writeFileSync(path.join(TEST_DATA_DIR, 'profile/baby.json'), JSON.stringify({
    babyId: 'baby-test-enrich',
    nickname: '小豆',
    expectedBirthDate: '2026-11-15',
    parents: [{ role: 'father', name: '吴健' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  }, null, 2), 'utf-8')

  process.env.VLM_MODEL = 'test-model'
})

after(() => {
  delete process.env.VLM_MODEL
})

describe('enrichDraft error cases', () => {
  it('returns not_found for non-existent draftId', async () => {
    const result = await enrichDraft('nonexistent-id', makeMockFetch())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'not_found')
  })

  it('returns not_pending for confirmed draft', async () => {
    const draft: DraftNote = {
      draftId: 'confirmed-draft-test',
      batchId: 'batch-1',
      status: 'confirmed',
      inferredDate: null,
      inferredTitle: null,
      inferredType: null,
      attachmentIds: [],
      originalFilenames: [],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)

    const result = await enrichDraft('confirmed-draft-test', makeMockFetch())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'not_pending')
  })

  it('returns no_vlm_config when VLM_MODEL not set', async () => {
    const draft: DraftNote = {
      draftId: 'no-config-draft',
      batchId: 'batch-1',
      status: 'pending',
      inferredDate: null,
      inferredTitle: null,
      inferredType: null,
      attachmentIds: ['att-no-config'],
      originalFilenames: ['photo.png'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)

    const origModel = process.env.VLM_MODEL
    delete process.env.VLM_MODEL
    const result = await enrichDraft('no-config-draft', makeMockFetch())
    process.env.VLM_MODEL = origModel
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'no_vlm_config')
  })

  it('returns no_image_attachments for PDF-only draft', async () => {
    const pdfAtt: Attachment = {
      attachmentId: 'att-pdf-only',
      type: 'pdf',
      originalFilename: 'report.pdf',
      storedPath: path.join(TEST_DATA_DIR, 'archive/assets/att-pdf-only.pdf'),
      mimeType: 'application/pdf',
      size: 100,
      sha256: 'pdf-sha-enrich-test',
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      schemaVersion: '1.1.1.1',
    }
    addAttachment(pdfAtt)

    const draft: DraftNote = {
      draftId: 'pdf-only-draft',
      batchId: 'batch-1',
      status: 'pending',
      inferredDate: null,
      inferredTitle: null,
      inferredType: null,
      attachmentIds: ['att-pdf-only'],
      originalFilenames: ['report.pdf'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)

    const result = await enrichDraft('pdf-only-draft', makeMockFetch())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'no_image_attachments')
  })
})

describe('enrichDraft success', () => {
  const imageAttId = 'att-img-enrich-success'
  const draftId = 'enrich-success-draft'

  before(() => {
    const storedPath = path.join(TEST_DATA_DIR, 'archive/assets', `${imageAttId}.png`)
    writeFileSync(storedPath, 'fake-image-bytes-for-vlm-test')

    const imgAtt: Attachment = {
      attachmentId: imageAttId,
      type: 'image',
      originalFilename: 'IMG_001.png',
      storedPath,
      mimeType: 'image/png',
      size: 100,
      sha256: 'img-sha-enrich-success',
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      schemaVersion: '1.1.1.1',
    }
    addAttachment(imgAtt)

    const draft: DraftNote = {
      draftId,
      batchId: 'batch-enrich',
      status: 'pending',
      inferredDate: null,
      inferredTitle: null,
      inferredType: null,
      attachmentIds: [imageAttId],
      originalFilenames: ['IMG_001.png'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)
  })

  it('enriches draft with VLM output', async () => {
    const result = await enrichDraft(draftId, makeMockFetch())
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.enriched, true)
      assert.ok(result.message.includes('IMG_001.png'))
    }
  })

  it('draft on disk has extractedFacts and extractionMetadata', () => {
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === draftId)
    assert.ok(draft)
    assert.ok(draft.extractedFacts)
    assert.equal(draft.extractedFacts!.length, 2)
    assert.ok(draft.extractedFacts!.includes('CRL: 7.2cm'))
    assert.ok(draft.extractionMetadata)
    assert.equal(draft.extractionMetadata!.model, 'test-model')
    assert.equal(draft.extractionMetadata!.attachmentId, imageAttId)
    assert.ok(draft.extractionMetadata!.extractedAt)
  })

  it('fills null fields from VLM output', () => {
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === draftId)
    assert.ok(draft)
    assert.equal(draft.inferredDate, '2026-04-20')
    assert.equal(draft.inferredTitle, 'VLM推断的标题')
    assert.equal(draft.inferredType, 'pregnancy_checkup')
  })

  it('merges uncertainFields without duplicates', () => {
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === draftId)
    assert.ok(draft)
    assert.ok(draft.uncertainFields.includes('inferredDate'))
    assert.ok(draft.uncertainFields.includes('title'))
    assert.ok(draft.uncertainFields.includes('type'))
    const unique = new Set(draft.uncertainFields)
    assert.equal(unique.size, draft.uncertainFields.length)
  })

  it('does NOT overwrite existing non-null fields on re-enrichment', async () => {
    const altResponse = { ...VALID_VLM_RESPONSE, inferredTitle: '不同的标题', inferredDate: '2026-06-01' }
    const result = await enrichDraft(draftId, makeMockFetch(altResponse))
    assert.equal(result.ok, true)

    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === draftId)
    assert.ok(draft)
    assert.equal(draft.inferredTitle, 'VLM推断的标题')
    assert.equal(draft.inferredDate, '2026-04-20')
  })

  it('draft status remains pending after enrichment', () => {
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === draftId)
    assert.ok(draft)
    assert.equal(draft.status, 'pending')
  })
})

describe('enrichDraft VLM failure', () => {
  const failDraftId = 'enrich-fail-draft'
  const failAttId = 'att-img-fail'

  before(() => {
    const storedPath = path.join(TEST_DATA_DIR, 'archive/assets', `${failAttId}.png`)
    writeFileSync(storedPath, 'fake-image-for-fail')

    const imgAtt: Attachment = {
      attachmentId: failAttId,
      type: 'image',
      originalFilename: 'fail.png',
      storedPath,
      mimeType: 'image/png',
      size: 50,
      sha256: 'img-sha-fail-test',
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      schemaVersion: '1.1.1.1',
    }
    addAttachment(imgAtt)

    const draft: DraftNote = {
      draftId: failDraftId,
      batchId: 'batch-fail',
      status: 'pending',
      inferredDate: '2026-05-10',
      inferredTitle: '原始标题',
      inferredType: null,
      attachmentIds: [failAttId],
      originalFilenames: ['fail.png'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)
  })

  it('returns vlm_failed on connection refused', async () => {
    const result = await enrichDraft(failDraftId, failedFetch)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'vlm_failed')
  })

  it('draft on disk is NOT modified after VLM failure', () => {
    const pending = loadPendingDrafts()
    const draft = pending.find((d) => d.draftId === failDraftId)
    assert.ok(draft)
    assert.equal(draft.inferredTitle, '原始标题')
    assert.equal(draft.extractedFacts, undefined)
    assert.equal(draft.extractionMetadata, undefined)
  })
})

describe('enrichPendingDrafts bulk', () => {
  it('iterates multiple drafts and aggregates stats', async () => {
    const stats = await enrichPendingDrafts(makeMockFetch())
    assert.ok(stats.total >= 1)
    assert.equal(typeof stats.enriched, 'number')
    assert.equal(typeof stats.skipped, 'number')
    assert.equal(typeof stats.failed, 'number')
    assert.equal(stats.results.length, stats.total)
  })
})
