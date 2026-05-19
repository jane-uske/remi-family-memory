import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remi-intake-ocr-grouping-'))
process.env.REMI_DATA_DIR = TEST_DATA_DIR

import { scanAssets } from '../attachments.js'
import { intakeAssets, inferDateFromOcrText } from '../intake.js'
import { loadPendingDrafts } from '../drafts.js'

function makePdfWithText(text: string): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${text.length + 35}>>stream\nBT /F1 12 Tf 100 700 Td (${text}) Tj ET\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'utf-8')
}

before(() => {
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/assets'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'inbox/notes'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'events'), { recursive: true })
  mkdirSync(path.join(TEST_DATA_DIR, 'profile'), { recursive: true })

  writeFileSync(path.join(TEST_DATA_DIR, 'profile/baby.json'), JSON.stringify({
    babyId: 'baby-ocr-grouping-test',
    nickname: '小豆',
    expectedBirthDate: '2026-11-15',
    parents: [{ role: 'father', name: '吴健' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  }, null, 2), 'utf-8')
})

describe('inferDateFromOcrText', () => {
  it('normalizes report dates from OCR text', () => {
    assert.equal(inferDateFromOcrText('2026.03.22 浙江大学医学院附属妇产科医院 检验报告单'), '2026-03-22')
    assert.equal(inferDateFromOcrText('检验时间 2026-05-15 08:51:06 报告时间 2026-05-15'), '2026-05-15')
    assert.equal(inferDateFromOcrText('日期：2026年04月30日 超声波检查报告单'), '2026-04-30')
  })

  it('rejects invalid OCR dates', () => {
    assert.equal(inferDateFromOcrText('报告时间 2026-13-40'), null)
    assert.equal(inferDateFromOcrText('没有日期'), null)
  })
})

describe('intakeAssets OCR date grouping', () => {
  it('splits hash-named PDFs by dates extracted from OCR text', async () => {
    writeFileSync(
      path.join(TEST_DATA_DIR, 'inbox/assets/hash-a.pdf'),
      makePdfWithText('2026.03.22 HCG report'),
    )
    writeFileSync(
      path.join(TEST_DATA_DIR, 'inbox/assets/hash-b.pdf'),
      makePdfWithText('report time 2026-05-15 blood test'),
    )

    scanAssets()
    const result = await intakeAssets()

    assert.equal(result.draftsCreated, 2)
    const dates = loadPendingDrafts().map((d) => d.inferredDate).sort()
    assert.deepEqual(dates, ['2026-03-22', '2026-05-15'])
  })
})
