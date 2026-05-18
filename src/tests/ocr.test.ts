import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-ocr-test-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

import { pdfTextExtractor, noOpExtractor, extractOcrForAttachment, extractOcrForDraft } from '../ocr.js'
import { scanAssets, loadAttachments } from '../attachments.js'
import { intakeAssets } from '../intake.js'
import { loadPendingDrafts, loadOcrResult, loadOcrText, ocrDir, ensureDraftDirs } from '../drafts.js'
import { runDoctor } from '../doctor.js'
import { exportAll } from '../export.js'
import { buildMemories } from '../memory.js'
import { generateContext } from '../context.js'
import type { Attachment } from '../types.js'

// Minimal PDF with text layer (creates "Hello World" text)
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  '4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello World) Tj ET\nendstream\nendobj\n' +
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
  'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000360 00000 n \n' +
  'trailer<</Size 6/Root 1 0 R>>\nstartxref\n429\n%%EOF',
  'utf-8'
)

before(() => {
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/notes'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'events'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'profile'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'memory'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'context'), { recursive: true })

  writeFileSync(path.join(TEST_DATA_DIR, 'profile/baby.json'), JSON.stringify({
    babyId: 'baby-ocr-test',
    nickname: '小豆',
    expectedBirthDate: '2026-11-15',
    parents: [{ role: 'father', name: '吴健' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  }, null, 2), 'utf-8')
})

describe('PdfTextExtractor', () => {
  it('extracts text from a valid PDF', async () => {
    const pdfPath = path.join(TEST_DATA_DIR, 'test-hello.pdf')
    writeFileSync(pdfPath, MINIMAL_PDF)

    const { text, result } = await pdfTextExtractor.extract(pdfPath, 'att-pdf-001')
    assert.equal(result.status, 'extracted')
    assert.ok(text.includes('Hello World'))
    assert.ok(result.charCount > 0)
    assert.equal(result.extractorId, 'pdftotext')
    assert.equal(result.attachmentType, 'pdf')
  })

  it('returns error for non-existent file', async () => {
    const { text, result } = await pdfTextExtractor.extract('/tmp/nonexistent-file-xyz.pdf', 'att-pdf-missing')
    assert.equal(result.status, 'error')
    assert.equal(text, '')
    assert.ok(result.errorMessage)
  })
})

describe('NoOpExtractor', () => {
  it('returns no_extractor for image without reading disk', async () => {
    const { text, result } = await noOpExtractor.extract('/does/not/matter.jpg', 'att-img-001')
    assert.equal(result.status, 'no_extractor')
    assert.equal(text, '')
    assert.equal(result.charCount, 0)
    assert.equal(result.extractorId, 'noop')
  })
})

describe('intakeAssets with OCR', () => {
  before(async () => {
    // Place a PDF and an image in inbox/assets
    writeFileSync(path.join(TEST_DATA_DIR, 'inbox/assets', '2026-05-18-report.pdf'), MINIMAL_PDF)
    writeFileSync(path.join(TEST_DATA_DIR, 'inbox/assets', '2026-05-18-photo.jpg'), 'fake-image-data')
    scanAssets()
  })

  it('creates OCR sidecar for PDF attachment', async () => {
    await intakeAssets()

    const attachments = loadAttachments()
    const pdfAtt = attachments.find((a) => a.originalFilename === '2026-05-18-report.pdf')
    assert.ok(pdfAtt)

    const ocrResult = loadOcrResult(pdfAtt.attachmentId)
    assert.ok(ocrResult)
    assert.equal(ocrResult.status, 'extracted')
    assert.ok(ocrResult.charCount > 0)

    const ocrText = loadOcrText(pdfAtt.attachmentId)
    assert.ok(ocrText)
    assert.ok(ocrText.includes('Hello World'))
  })

  it('creates no_extractor sidecar for image attachment', () => {
    const attachments = loadAttachments()
    const imgAtt = attachments.find((a) => a.originalFilename === '2026-05-18-photo.jpg')
    assert.ok(imgAtt)

    const ocrResult = loadOcrResult(imgAtt.attachmentId)
    assert.ok(ocrResult)
    assert.equal(ocrResult.status, 'no_extractor')
    assert.equal(ocrResult.charCount, 0)

    const ocrText = loadOcrText(imgAtt.attachmentId)
    assert.ok(ocrText !== null)
    assert.equal(ocrText, '')
  })

  it('draft.ocrStatus reflects extraction result', () => {
    const pending = loadPendingDrafts()
    assert.ok(pending.length >= 1)

    const pdfDraft = pending.find((d) => d.originalFilenames.some((f) => f.endsWith('.pdf')))
    if (pdfDraft) {
      assert.ok(['extracted', 'partial'].includes(pdfDraft.ocrStatus!))
      assert.ok(pdfDraft.ocrExtractedCount! >= 1)
    }

    const imgDraft = pending.find((d) =>
      d.originalFilenames.every((f) => f.endsWith('.jpg')) && !d.originalFilenames.some((f) => f.endsWith('.pdf'))
    )
    if (imgDraft) {
      assert.equal(imgDraft.ocrStatus, 'no_extractor')
    }
  })
})

describe('doctor OCR checks', () => {
  it('no_extractor does NOT cause doctor FAIL', () => {
    const results = runDoctor()
    const ocrIntegrity = results.find((r) => r.name === 'OCR sidecar integrity')
    assert.ok(ocrIntegrity)
    assert.notEqual(ocrIntegrity.status, 'FAIL')

    const ocrIsolation = results.find((r) => r.name === 'OCR text isolation')
    assert.ok(ocrIsolation)
    assert.equal(ocrIsolation.status, 'PASS')
  })
})

describe('OCR text isolation', () => {
  it('OCR text not in memories after buildMemories()', () => {
    buildMemories()
    const memFile = path.join(TEST_DATA_DIR, 'memory/memories.json')
    if (existsSync(memFile)) {
      const content = readFileSync(memFile, 'utf-8')
      assert.ok(!content.includes('Hello World'), 'OCR text "Hello World" should not appear in memories')
    }
  })

  it('OCR text not in context after generateContext()', () => {
    generateContext()
    const ctxMd = path.join(TEST_DATA_DIR, 'context/remi-context.md')
    const ctxJson = path.join(TEST_DATA_DIR, 'context/remi-context.json')
    if (existsSync(ctxMd)) {
      const content = readFileSync(ctxMd, 'utf-8')
      assert.ok(!content.includes('Hello World'), 'OCR text should not appear in context markdown')
    }
    if (existsSync(ctxJson)) {
      const content = readFileSync(ctxJson, 'utf-8')
      assert.ok(!content.includes('Hello World'), 'OCR text should not appear in context JSON')
    }
  })
})

describe('export includes OCR sidecars', () => {
  it('export directory contains drafts/ocr/ with sidecar files', () => {
    const exportDir = exportAll()
    const ocrExportDir = path.join(exportDir, 'drafts/ocr')
    assert.ok(existsSync(ocrExportDir), 'drafts/ocr/ must exist in export')

    const files = readdirSync(ocrExportDir)
    const jsonFiles = files.filter((f) => f.endsWith('.ocr.json'))
    const txtFiles = files.filter((f) => f.endsWith('.ocr.txt'))
    assert.ok(jsonFiles.length >= 1, 'at least one .ocr.json in export')
    assert.ok(txtFiles.length >= 1, 'at least one .ocr.txt in export')
  })
})
