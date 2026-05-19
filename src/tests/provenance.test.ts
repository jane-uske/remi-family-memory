import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-provenance-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

import { parseMarkdownNote } from '../parser.js'
import { saveDraft, loadPendingDrafts, ensureDraftDirs, confirmDraft } from '../drafts.js'
import { addAttachment } from '../attachments.js'
import { buildMemories, loadMemories } from '../memory.js'
import { enrichDraft } from '../draft_enrichment.js'
import { formatProvenanceNote } from '../connector.js'
import type { FetchFn } from '../local_vlm_extractor.js'
import type { DraftNote, Attachment, MemoryProvenance } from '../types.js'

const VLM_RESPONSE = {
  inferredDate: '2026-05-15',
  inferredType: 'pregnancy_checkup',
  inferredTitle: 'B超检查',
  inferredSummary: '孕检报告',
  facts: ['CRL: 8.0cm', 'NT: 1.1mm'],
  inferredTags: ['孕检'],
  uncertainFields: ['inferredDate'],
  warnings: [],
  needsParentReview: true,
}

function makeMockFetch(): FetchFn {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(VLM_RESPONSE) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

before(() => {
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/notes'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'events'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'archive/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'profile'), { recursive: true })
  ensureDraftDirs()

  writeFileSync(path.join(TEST_DATA_DIR, 'profile/baby.json'), JSON.stringify({
    babyId: 'baby-provenance-test',
    nickname: '小豆',
    expectedBirthDate: '2026-11-15',
    parents: [{ role: 'father', name: '吴健' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  }, null, 2), 'utf-8')

  process.env.VLM_MODEL = 'test-vlm-model'
})

describe('parseMarkdownNote provenance', () => {
  it('parses provenance from frontmatter', () => {
    const md = [
      '---',
      'date: 2026-05-15',
      'type: pregnancy_checkup',
      'source: asset_intake',
      'title: "B超检查"',
      'confirmedByParent: true',
      'attachmentIds:',
      '  - att-001',
      'originalFilenames:',
      '  - "scan.png"',
      'captureStatus: confirmed_from_draft',
      'draftId: "draft-prov-001"',
      'sensitivity: normal',
      'provenance:',
      '  sourceType: asset_intake',
      '  draftId: "draft-prov-001"',
      '  ocrUsed: false',
      '  vlmUsed: true',
      '  vlmModel: "test-vlm-model"',
      '  confirmedAt: "2026-05-19T10:00:00.000Z"',
      '---',
      '',
      'B超检查',
    ].join('\n')

    const event = parseMarkdownNote(md, '/test/note.md', 'child-1')
    assert.ok(event.provenance)
    assert.equal(event.provenance!.sourceType, 'asset_intake')
    assert.equal(event.provenance!.draftId, 'draft-prov-001')
    assert.equal(event.provenance!.ocrUsed, false)
    assert.equal(event.provenance!.vlmUsed, true)
    assert.equal(event.provenance!.vlmModel, 'test-vlm-model')
    assert.equal(event.provenance!.confirmedAt, '2026-05-19T10:00:00.000Z')
  })

  it('returns undefined provenance when not in frontmatter', () => {
    const md = [
      '---',
      'date: 2026-05-10',
      'type: parent_note',
      'source: remi',
      'confirmedByParent: true',
      '---',
      '',
      '# 今天感觉宝宝很活跃',
    ].join('\n')

    const event = parseMarkdownNote(md, '/test/plain.md', 'child-1')
    assert.equal(event.provenance, undefined)
  })

  it('parses ocrUsed=true correctly', () => {
    const md = [
      '---',
      'date: 2026-05-12',
      'type: medical_record',
      'source: asset_intake',
      'confirmedByParent: true',
      'provenance:',
      '  sourceType: asset_intake',
      '  ocrUsed: true',
      '  vlmUsed: false',
      '  confirmedAt: "2026-05-19T12:00:00.000Z"',
      '---',
      '',
      '报告内容',
    ].join('\n')

    const event = parseMarkdownNote(md, '/test/ocr.md', 'child-1')
    assert.ok(event.provenance)
    assert.equal(event.provenance!.ocrUsed, true)
    assert.equal(event.provenance!.vlmUsed, false)
  })
})

describe('confirmDraft writes provenance', () => {
  const draftId = 'prov-confirm-test'
  const attId = 'att-prov-confirm'

  before(() => {
    const storedPath = path.join(TEST_DATA_DIR, 'archive/assets', `${attId}.png`)
    writeFileSync(storedPath, 'fake-image-provenance')

    const imgAtt: Attachment = {
      attachmentId: attId,
      type: 'image',
      originalFilename: 'ultrasound.png',
      storedPath,
      mimeType: 'image/png',
      size: 200,
      sha256: 'prov-sha-001',
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      schemaVersion: '1.1.1.1',
    }
    addAttachment(imgAtt)

    const draft: DraftNote = {
      draftId,
      batchId: 'batch-prov',
      status: 'pending',
      inferredDate: '2026-05-15',
      inferredTitle: 'B超检查',
      inferredType: 'pregnancy_checkup',
      attachmentIds: [attId],
      originalFilenames: ['ultrasound.png'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: [],
      ocrStatus: 'extracted',
      extractionMetadata: {
        model: 'test-vlm-model',
        extractedAt: '2026-05-19T08:00:00.000Z',
        attachmentId: attId,
        validationWarnings: [],
        rawResponseLength: 100,
      },
      extractedFacts: ['CRL: 8.0cm'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)
  })

  it('inbox note contains provenance frontmatter', () => {
    const result = confirmDraft(draftId)
    assert.equal(result.ok, true)
    if (!result.ok) return

    const notesDir = path.join(TEST_DATA_DIR, 'inbox/notes')
    const files = readdirSync(notesDir) as string[]
    const noteFile = files.find((f: string) => f.includes('asset'))
    assert.ok(noteFile)

    const content = readFileSync(path.join(notesDir, noteFile!), 'utf-8')
    assert.ok(content.includes('provenance:'))
    assert.ok(content.includes('sourceType: asset_intake'))
    assert.ok(content.includes(`draftId: "${draftId}"`))
    assert.ok(content.includes('ocrUsed: true'))
    assert.ok(content.includes('vlmUsed: true'))
    assert.ok(content.includes('vlmModel: "test-vlm-model"'))
    assert.ok(content.includes('confirmedAt:'))
  })

  it('parsed event from confirmed note has provenance', () => {
    const notesDir = path.join(TEST_DATA_DIR, 'inbox/notes')
    const files = readdirSync(notesDir) as string[]
    const noteFile = files.find((f: string) => f.includes('asset'))
    assert.ok(noteFile)

    const content = readFileSync(path.join(notesDir, noteFile!), 'utf-8')
    const event = parseMarkdownNote(content, noteFile!, 'baby-provenance-test')
    assert.ok(event.provenance)
    assert.equal(event.provenance!.sourceType, 'asset_intake')
    assert.equal(event.provenance!.draftId, draftId)
    assert.equal(event.provenance!.ocrUsed, true)
    assert.equal(event.provenance!.vlmUsed, true)
    assert.equal(event.provenance!.vlmModel, 'test-vlm-model')
  })
})

describe('confirmDraft without VLM writes provenance with vlmUsed=false', () => {
  const draftId = 'prov-no-vlm-test'

  before(() => {
    const draft: DraftNote = {
      draftId,
      batchId: 'batch-prov-no-vlm',
      status: 'pending',
      inferredDate: '2026-05-10',
      inferredTitle: '散步照片',
      inferredType: 'photo_memory',
      attachmentIds: ['att-no-vlm'],
      originalFilenames: ['walk.jpg'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: [],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)
  })

  it('provenance shows vlmUsed=false, ocrUsed=false', () => {
    const result = confirmDraft(draftId)
    assert.equal(result.ok, true)
    if (!result.ok) return

    const notesDir = path.join(TEST_DATA_DIR, 'inbox/notes')
    const files = readdirSync(notesDir) as string[]
    const noteFile = files.find((f: string) => f.includes(result.noteId))
    assert.ok(noteFile)

    const content = readFileSync(path.join(notesDir, noteFile!), 'utf-8')
    assert.ok(content.includes('ocrUsed: false'))
    assert.ok(content.includes('vlmUsed: false'))
    assert.ok(!content.includes('vlmModel'))
  })
})

describe('provenance flows through to MemoryRecord via buildMemories', () => {
  it('memory record has provenance when event has provenance', () => {
    const md = [
      '---',
      'date: 2026-05-15',
      'type: pregnancy_checkup',
      'source: asset_intake',
      'title: "带有 provenance 的孕检"',
      'confirmedByParent: true',
      'sensitivity: normal',
      'provenance:',
      '  sourceType: asset_intake',
      '  draftId: "draft-mem-prov"',
      '  ocrUsed: true',
      '  vlmUsed: true',
      '  vlmModel: "local-vlm-7b"',
      '  confirmedAt: "2026-05-19T14:00:00.000Z"',
      '---',
      '',
      '孕检记录',
    ].join('\n')

    const event = parseMarkdownNote(md, '/test/prov-mem.md', 'baby-provenance-test')
    event.confirmedByParent = true

    const eventsDir = path.join(TEST_DATA_DIR, 'events')
    const eventsFile = path.join(eventsDir, 'events.json')
    writeFileSync(eventsFile, JSON.stringify([event], null, 2), 'utf-8')

    buildMemories()
    const memories = loadMemories()
    assert.ok(memories.length >= 1)

    const mem = memories.find((m) => m.title === '带有 provenance 的孕检')
    assert.ok(mem, 'memory with provenance title should exist')
    assert.ok(mem!.provenance)
    assert.equal(mem!.provenance!.sourceType, 'asset_intake')
    assert.equal(mem!.provenance!.confidence, 'confirmed_by_parent')
    assert.equal(mem!.provenance!.draftId, 'draft-mem-prov')
    assert.equal(mem!.provenance!.ocrAssisted, true)
    assert.equal(mem!.provenance!.vlmAssisted, true)
    assert.equal(mem!.provenance!.vlmModel, 'local-vlm-7b')
    assert.equal(mem!.provenance!.confirmedAt, '2026-05-19T14:00:00.000Z')
  })

  it('memory record has no provenance when event has none', () => {
    const md = [
      '---',
      'date: 2026-04-20',
      'type: parent_note',
      'source: remi',
      'title: "手动记录"',
      'confirmedByParent: true',
      'sensitivity: normal',
      '---',
      '',
      '今天宝宝很活跃',
    ].join('\n')

    const event = parseMarkdownNote(md, '/test/no-prov.md', 'baby-provenance-test')

    const eventsDir = path.join(TEST_DATA_DIR, 'events')
    const eventsFile = path.join(eventsDir, 'events.json')
    const existing = JSON.parse(readFileSync(eventsFile, 'utf-8'))
    existing.push(event)
    writeFileSync(eventsFile, JSON.stringify(existing, null, 2), 'utf-8')

    buildMemories()
    const memories = loadMemories()
    const mem = memories.find((m) => m.title === '手动记录')
    assert.ok(mem, 'memory without provenance should exist')
    assert.equal(mem!.provenance, undefined)
  })
})

describe('full provenance pipeline: enrich → confirm → parse → memory', () => {
  const pipelineDraftId = 'pipeline-prov-draft'
  const pipelineAttId = 'att-pipeline-prov'

  before(async () => {
    const storedPath = path.join(TEST_DATA_DIR, 'archive/assets', `${pipelineAttId}.png`)
    writeFileSync(storedPath, 'fake-pipeline-image')

    const imgAtt: Attachment = {
      attachmentId: pipelineAttId,
      type: 'image',
      originalFilename: 'pipeline.png',
      storedPath,
      mimeType: 'image/png',
      size: 150,
      sha256: 'pipeline-sha',
      createdAt: new Date().toISOString(),
      importedAt: new Date().toISOString(),
      schemaVersion: '1.1.1.1',
    }
    addAttachment(imgAtt)

    const draft: DraftNote = {
      draftId: pipelineDraftId,
      batchId: 'batch-pipeline',
      status: 'pending',
      inferredDate: null,
      inferredTitle: null,
      inferredType: null,
      attachmentIds: [pipelineAttId],
      originalFilenames: ['pipeline.png'],
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: ['title', 'type'],
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)

    await enrichDraft(pipelineDraftId, makeMockFetch())
  })

  it('enriched then confirmed draft produces event with full provenance', () => {
    const result = confirmDraft(pipelineDraftId)
    assert.equal(result.ok, true)
    if (!result.ok) return

    const notesDir = path.join(TEST_DATA_DIR, 'inbox/notes')
    const files = readdirSync(notesDir) as string[]
    const noteFile = files.find((f: string) => f.includes(result.noteId))
    assert.ok(noteFile)

    const content = readFileSync(path.join(notesDir, noteFile!), 'utf-8')
    const event = parseMarkdownNote(content, noteFile!, 'baby-provenance-test')

    assert.ok(event.provenance)
    assert.equal(event.provenance!.sourceType, 'asset_intake')
    assert.equal(event.provenance!.draftId, pipelineDraftId)
    assert.equal(event.provenance!.vlmUsed, true)
    assert.equal(event.provenance!.vlmModel, 'test-vlm-model')
    assert.ok(event.provenance!.confirmedAt)
    assert.equal(event.confirmedByParent, true)
  })
})

describe('formatProvenanceNote', () => {
  const baseProvenance: MemoryProvenance = {
    sourceType: 'asset_intake',
    confidence: 'confirmed_by_parent',
    ocrAssisted: false,
    vlmAssisted: false,
    confirmedAt: '2026-05-19T10:00:00.000Z',
  }

  it('returns confirmed note for plain confirmed memory', () => {
    const note = formatProvenanceNote([baseProvenance])
    assert.equal(note, '（已由家长确认）')
  })

  it('returns VLM note when vlmAssisted', () => {
    const note = formatProvenanceNote([{ ...baseProvenance, vlmAssisted: true }])
    assert.equal(note, '（已由家长确认，VLM 辅助整理）')
  })

  it('returns OCR note when ocrAssisted', () => {
    const note = formatProvenanceNote([{ ...baseProvenance, ocrAssisted: true }])
    assert.equal(note, '（已由家长确认，OCR 辅助提取）')
  })

  it('returns combined note for OCR + VLM', () => {
    const note = formatProvenanceNote([{ ...baseProvenance, ocrAssisted: true, vlmAssisted: true }])
    assert.equal(note, '（已由家长确认，OCR + VLM 辅助整理）')
  })

  it('returns undefined for empty array', () => {
    const note = formatProvenanceNote([])
    assert.equal(note, undefined)
  })

  it('aggregates multiple provenances', () => {
    const p1: MemoryProvenance = { ...baseProvenance, vlmAssisted: false }
    const p2: MemoryProvenance = { ...baseProvenance, vlmAssisted: true }
    const note = formatProvenanceNote([p1, p2])
    assert.equal(note, '（已由家长确认，VLM 辅助整理）')
  })
})
