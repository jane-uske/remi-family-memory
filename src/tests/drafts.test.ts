import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-drafts-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

import { scanAssets, loadAttachments } from '../attachments.js'
import { intakeAssets, inferDateFromFilename, groupAttachments } from '../intake.js'
import { loadPendingDrafts, loadConfirmedDrafts, loadRejectedDrafts, confirmDraft, rejectDraft, saveDraft, ensureDraftDirs } from '../drafts.js'
import { listEvents } from '../store.js'
import { scanInbox } from '../scanner.js'
import { runDoctor } from '../doctor.js'
import { exportAll } from '../export.js'
import type { Attachment, DraftNote } from '../types.js'

before(() => {
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/notes'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'events'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'profile'), { recursive: true })

  writeFileSync(path.join(TEST_DATA_DIR, 'profile/baby.json'), JSON.stringify({
    babyId: 'baby-test-001',
    nickname: '小豆',
    expectedBirthDate: '2026-11-15',
    parents: [{ role: 'father', name: '吴健' }, { role: 'mother', name: '小丽' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  }, null, 2), 'utf-8')
})

describe('inferDateFromFilename', () => {
  it('extracts YYYY-MM-DD from filename', () => {
    assert.equal(inferDateFromFilename('2026-05-10-checkup.pdf'), '2026-05-10')
  })

  it('extracts YYYYMMDD from start of filename', () => {
    assert.equal(inferDateFromFilename('20260510_ultrasound.jpg'), '2026-05-10')
  })

  it('returns null for no date', () => {
    assert.equal(inferDateFromFilename('family-photo.jpg'), null)
  })

  it('rejects invalid dates', () => {
    assert.equal(inferDateFromFilename('2026-13-40-bad.jpg'), null)
  })
})

describe('scan-assets archives file', () => {
  it('scan-assets creates attachment record', () => {
    const assetPath = path.join(TEST_DATA_DIR, 'inbox/assets', '2026-05-10-checkup.pdf')
    writeFileSync(assetPath, 'fake-pdf-content-for-test')

    const result = scanAssets()
    assert.equal(result.added, 1)

    const attachments = loadAttachments()
    assert.equal(attachments.length, 1)
    assert.equal(attachments[0].originalFilename, '2026-05-10-checkup.pdf')
    assert.equal(attachments[0].type, 'pdf')
  })
})

describe('intake-assets creates pending drafts', () => {
  it('creates pending draft from unlinked attachment', async () => {
    const result = await intakeAssets()
    assert.equal(result.draftsCreated, 1)
    assert.equal(result.skipped, 0)

    const pending = loadPendingDrafts()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].status, 'pending')
    assert.equal(pending[0].inferredDate, '2026-05-10')
    assert.equal(pending[0].attachmentIds.length, 1)
    assert.equal(pending[0].originalFilenames[0], '2026-05-10-checkup.pdf')
    assert.equal(pending[0].source, 'asset_intake')
  })

  it('skips already-drafted attachments on re-run', async () => {
    const result = await intakeAssets()
    assert.equal(result.draftsCreated, 0)
    assert.equal(result.skipped, 1)
  })
})

describe('pending drafts NOT in events/timeline', () => {
  it('pending drafts are isolated from events', () => {
    const events = listEvents()
    const pending = loadPendingDrafts()
    const pendingAttachmentIds = new Set(pending.flatMap((d) => d.attachmentIds))

    for (const e of events) {
      if (e.attachmentIds) {
        for (const id of e.attachmentIds) {
          assert.equal(pendingAttachmentIds.has(id), false, `Attachment ${id} found in both pending draft and events`)
        }
      }
    }
  })
})

describe('confirmDraft generates inbox note', () => {
  let draftId: string

  before(() => {
    const pending = loadPendingDrafts()
    draftId = pending[0].draftId
  })

  it('confirmDraft with overrides applies title/date/type/summary', () => {
    const result = confirmDraft(draftId, {
      title: '22周孕检报告',
      date: '2026-05-10',
      type: 'pregnancy_checkup',
      summary: '一切正常，胎儿发育良好',
      tags: ['孕检', '正常'],
    })

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.ok(result.noteId)
      assert.ok(result.filePath)

      const absPath = path.resolve(result.filePath)
      assert.ok(existsSync(absPath), `Note file should exist at ${absPath}`)

      const content = readFileSync(absPath, 'utf-8')
      assert.ok(content.includes('date: 2026-05-10'))
      assert.ok(content.includes('type: pregnancy_checkup'))
      assert.ok(content.includes('source: asset_intake'))
      assert.ok(content.includes('title: "22周孕检报告"'))
      assert.ok(content.includes('confirmedByParent: true'))
      assert.ok(content.includes('attachmentIds:'))
      assert.ok(content.includes('captureStatus: confirmed_from_draft'))
      assert.ok(content.includes(`draftId: "${draftId}"`))
      assert.ok(content.includes('一切正常，胎儿发育良好'))
      assert.ok(content.includes('tags: [孕检, 正常]'))
    }
  })

  it('confirmed draft moves to confirmed dir', () => {
    const pending = loadPendingDrafts()
    const confirmed = loadConfirmedDrafts()
    assert.equal(pending.length, 0)
    assert.equal(confirmed.length, 1)
    assert.equal(confirmed[0].status, 'confirmed')
    assert.ok(confirmed[0].confirmedAt)
  })

  it('confirm non-existent draft returns not_found', () => {
    const result = confirmDraft('nonexistent-id')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'not_found')
    }
  })

  it('confirm already-confirmed draft returns not_pending', () => {
    const result = confirmDraft(draftId)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'not_pending')
    }
  })
})

describe('rejectDraft', () => {
  let rejectDraftId: string

  before(async () => {
    const assetPath = path.join(TEST_DATA_DIR, 'inbox/assets', '20260512_scan.jpg')
    writeFileSync(assetPath, 'fake-image-content-for-reject-test')
    scanAssets()
    await intakeAssets()
    const pending = loadPendingDrafts()
    rejectDraftId = pending[0].draftId
  })

  it('rejectDraft moves to rejected, no note generated', () => {
    const inboxNotesBefore = existsSync(path.join(TEST_DATA_DIR, 'inbox/notes'))
      ? readdirSync(path.join(TEST_DATA_DIR, 'inbox/notes')).filter((f) => f.includes(rejectDraftId)).length
      : 0

    const result = rejectDraft(rejectDraftId)
    assert.equal(result.ok, true)

    const rejected = loadRejectedDrafts()
    assert.ok(rejected.some((d) => d.draftId === rejectDraftId))

    const inboxNotesAfter = existsSync(path.join(TEST_DATA_DIR, 'inbox/notes'))
      ? readdirSync(path.join(TEST_DATA_DIR, 'inbox/notes')).filter((f) => f.includes(rejectDraftId)).length
      : 0
    assert.equal(inboxNotesAfter, inboxNotesBefore)
  })
})

describe('sync after confirm processes note into event', () => {
  it('scan picks up confirmed note and creates event', () => {
    const scanResult = scanInbox()
    assert.ok(scanResult.added >= 1)

    const events = listEvents()
    const assetEvent = events.find((e) => e.source.externalId === 'asset_intake')
    assert.ok(assetEvent, 'Should find event from asset_intake source')
    assert.equal(assetEvent.type, 'pregnancy_checkup')
    assert.equal(assetEvent.title, '22周孕检报告')
    assert.ok(assetEvent.attachmentIds && assetEvent.attachmentIds.length > 0)
  })
})

describe('doctor draft checks', () => {
  it('doctor passes with no pending drafts leaking into events', () => {
    const results = runDoctor()
    const draftIsolation = results.find((r) => r.name === 'Draft isolation')
    assert.ok(draftIsolation)
    assert.equal(draftIsolation.status, 'PASS')
  })

  it('doctor shows pending drafts count', () => {
    const results = runDoctor()
    const pendingCheck = results.find((r) => r.name === 'Pending drafts')
    assert.ok(pendingCheck)
  })
})

describe('groupAttachments', () => {
  it('groups by date from filename', () => {
    const attachments: Attachment[] = [
      { attachmentId: 'a1', type: 'image', originalFilename: '2026-05-10-photo1.jpg', storedPath: '', mimeType: 'image/jpeg', size: 100, sha256: 'abc', createdAt: '2026-05-10T00:00:00Z', importedAt: '2026-05-12T00:00:00Z', schemaVersion: '1.1.0' },
      { attachmentId: 'a2', type: 'image', originalFilename: '2026-05-10-photo2.jpg', storedPath: '', mimeType: 'image/jpeg', size: 200, sha256: 'def', createdAt: '2026-05-10T00:00:00Z', importedAt: '2026-05-12T00:00:00Z', schemaVersion: '1.1.0' },
      { attachmentId: 'a3', type: 'pdf', originalFilename: 'report.pdf', storedPath: '', mimeType: 'application/pdf', size: 300, sha256: 'ghi', createdAt: '2026-05-11T00:00:00Z', importedAt: '2026-05-12T00:00:00Z', schemaVersion: '1.1.0' },
    ]

    const groups = groupAttachments(attachments)
    assert.equal(groups.size, 2)
    assert.equal(groups.get('date:2026-05-10')?.length, 2)
    assert.equal(groups.get('imported:2026-05-12')?.length, 1)
  })
})

describe('v1.1.0.1: export includes pending drafts', () => {
  before(async () => {
    // Create a new pending draft for export test
    const assetPath = path.join(TEST_DATA_DIR, 'inbox/assets', '2026-05-15-export-test.png')
    writeFileSync(assetPath, 'fake-image-for-export-pending-test')
    scanAssets()
    await intakeAssets()
  })

  it('export directory contains drafts/pending/ with draft files', () => {
    const exportDir = exportAll()
    const pendingExportDir = path.join(exportDir, 'drafts/pending')
    assert.ok(existsSync(pendingExportDir), 'drafts/pending/ must exist in export')

    const files = readdirSync(pendingExportDir).filter((f) => f.endsWith('.json'))
    assert.ok(files.length >= 1, 'at least one pending draft file in export')

    const content = JSON.parse(readFileSync(path.join(pendingExportDir, files[0]), 'utf-8'))
    assert.equal(content.status, 'pending')
  })

  it('export README mentions pending drafts will not auto-enter timeline', () => {
    const exportDir = exportAll()
    const readme = readFileSync(path.join(exportDir, 'README_export.md'), 'utf-8')
    assert.ok(readme.includes('drafts/pending/'), 'README should mention drafts/pending/')
    assert.ok(readme.includes('NOT'), 'README should state pending drafts will NOT auto-enter')
    assert.ok(readme.includes('confirm'), 'README should mention user must confirm')
  })
})

describe('v1.1.0.1: multi-draft confirm safety', () => {
  let draftIds: string[]

  before(() => {
    // Create multiple pending drafts manually
    ensureDraftDirs()
    const draft1: DraftNote = {
      draftId: 'multi-test-draft-001',
      batchId: 'batch-multi-test',
      status: 'pending',
      inferredDate: '2026-05-01',
      inferredTitle: null,
      inferredType: null,
      attachmentIds: ['att-multi-001'],
      originalFilenames: ['2026-05-01-photo-a.jpg'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    const draft2: DraftNote = {
      draftId: 'multi-test-draft-002',
      batchId: 'batch-multi-test',
      status: 'pending',
      inferredDate: '2026-05-02',
      inferredTitle: null,
      inferredType: null,
      attachmentIds: ['att-multi-002'],
      originalFilenames: ['2026-05-02-photo-b.jpg'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft1)
    saveDraft(draft2)
    draftIds = [draft1.draftId, draft2.draftId]
  })

  it('API requires explicit draftId — cannot confirm without specifying which', () => {
    // The API design enforces safety: POST /api/ai/drafts/:draftId/confirm
    // There is no "confirm all" or "confirm next" endpoint.
    // Confirming a nonexistent ID fails.
    const result = confirmDraft('nonexistent-bulk-confirm')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, 'not_found')
    }
  })

  it('with multiple pending drafts, each requires its own explicit confirmDraft call', () => {
    const pending = loadPendingDrafts()
    const multiTestDrafts = pending.filter((d) => draftIds.includes(d.draftId))
    assert.ok(multiTestDrafts.length >= 2, 'Should have at least 2 test drafts pending')

    // Confirm only the first one explicitly by ID
    const result = confirmDraft(draftIds[0], { title: 'Multi-test Draft 1' })
    assert.equal(result.ok, true)

    // Second draft is still pending — not accidentally confirmed
    const remainingPending = loadPendingDrafts()
    const secondStillPending = remainingPending.find((d) => d.draftId === draftIds[1])
    assert.ok(secondStillPending, 'Second draft must remain pending after confirming first')
    assert.equal(secondStillPending.status, 'pending')
  })

  it('selecting by number (draftId) then confirming only affects that specific draft', () => {
    // Confirm the second draft
    const result = confirmDraft(draftIds[1], { title: 'Multi-test Draft 2' })
    assert.equal(result.ok, true)

    // Verify both are now confirmed
    const confirmed = loadConfirmedDrafts()
    assert.ok(confirmed.some((d) => d.draftId === draftIds[0]))
    assert.ok(confirmed.some((d) => d.draftId === draftIds[1]))
  })
})
