import path from 'node:path'
import { nanoid } from 'nanoid'
import { loadAttachments } from './attachments.js'
import { loadAllDrafts, saveDraft, saveOcrSidecar } from './drafts.js'
import { listEvents } from './store.js'
import { extractOcrForAttachment } from './ocr.js'
import type { Attachment, DraftNote, OcrStatus } from './types.js'

export function inferDateFromFilename(filename: string): string | null {
  const isoMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    const date = new Date(`${y}-${m}-${d}`)
    if (!isNaN(date.getTime()) && Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`
    }
  }

  const compactMatch = filename.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compactMatch) {
    const [, y, m, d] = compactMatch
    const date = new Date(`${y}-${m}-${d}`)
    if (!isNaN(date.getTime()) && Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`
    }
  }

  return null
}

export function inferDateFromOcrText(text: string): string | null {
  const normalized = text
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')

  const patterns = [
    /(?:检查|检验|报告|采样|采集|日期|时间|date|time)[^\d]{0,20}(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/giu,
    /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/gu,
  ]

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const date = normalizeDate(match[1], match[2], match[3])
      if (date) return date
    }
  }

  return null
}

function normalizeDate(year: string, month: string, day: string): string | null {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (y < 2020 || y > 2035 || m < 1 || m > 12 || d < 1 || d > 31) return null

  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function getSubdirectory(attachment: Attachment): string | null {
  const relPath = attachment.originalRelativePath
  if (!relPath) return null
  const dir = path.dirname(relPath)
  if (dir === '.') return null
  return dir
}

export function groupAttachments(
  attachments: Attachment[],
  detectedDates: Map<string, string> = new Map(),
): Map<string, Attachment[]> {
  const groups = new Map<string, Attachment[]>()

  for (const a of attachments) {
    const subdir = getSubdirectory(a)
    const filenameDate = inferDateFromFilename(a.originalFilename)
    const ocrDate = detectedDates.get(a.attachmentId)
    let key: string

    if (filenameDate) key = `date:${filenameDate}`
    else if (ocrDate) key = `date:${ocrDate}`
    else if (subdir) key = `subdir:${subdir}`
    else key = `imported:${a.importedAt.slice(0, 10)}`

    const group = groups.get(key) || []
    group.push(a)
    groups.set(key, group)
  }

  return groups
}

function inferTitleFromSubdir(subdir: string): string {
  const dirName = path.basename(subdir)
  return `${dirName} 资料`
}

export async function intakeAssets(): Promise<{ draftsCreated: number; skipped: number }> {
  const attachments = loadAttachments()
  const allDrafts = loadAllDrafts()
  const events = listEvents()

  const draftedAttachmentIds = new Set<string>()
  for (const d of allDrafts) {
    for (const id of d.attachmentIds) {
      draftedAttachmentIds.add(id)
    }
  }

  const eventAttachmentIds = new Set<string>()
  for (const e of events) {
    if (e.attachmentIds) {
      for (const id of e.attachmentIds) {
        eventAttachmentIds.add(id)
      }
    }
  }

  const undrafted = attachments.filter((a) =>
    !draftedAttachmentIds.has(a.attachmentId) && !eventAttachmentIds.has(a.attachmentId)
  )

  const skipped = attachments.length - undrafted.length

  if (undrafted.length === 0) {
    return { draftsCreated: 0, skipped }
  }

  const ocrByAttachmentId = new Map<string, { text: string; result: Awaited<ReturnType<typeof extractOcrForAttachment>>['result'] }>()
  const detectedDates = new Map<string, string>()

  for (const attachment of undrafted) {
    const ocr = await extractOcrForAttachment(attachment)
    saveOcrSidecar(ocr.result, ocr.text)
    ocrByAttachmentId.set(attachment.attachmentId, ocr)

    if (ocr.result.status === 'extracted') {
      const date = inferDateFromOcrText(ocr.text)
      if (date) detectedDates.set(attachment.attachmentId, date)
    }
  }

  const groups = groupAttachments(undrafted, detectedDates)
  const batchId = nanoid()
  let draftsCreated = 0

  for (const [key, groupAtts] of groups) {
    let inferredDate: string | null = null
    let inferredTitle: string | null = null

    if (key.startsWith('subdir:')) {
      const subdir = key.slice(7)
      inferredTitle = inferTitleFromSubdir(subdir)
      const dates = groupAtts.map((a) => inferDateFromFilename(a.originalFilename)).filter(Boolean)
      inferredDate = dates[0] || groupAtts[0]?.importedAt.slice(0, 10) || null
    } else if (key.startsWith('date:')) {
      inferredDate = key.slice(5)
    } else {
      inferredDate = groupAtts[0]?.importedAt.slice(0, 10) || null
    }

    const ocrResults = groupAtts.map((a) => ocrByAttachmentId.get(a.attachmentId)).filter((r): r is NonNullable<typeof r> => !!r)

    const extractedCount = ocrResults.filter((r) => r.result.status === 'extracted').length
    let ocrStatus: OcrStatus | 'partial'
    if (extractedCount === ocrResults.length) {
      ocrStatus = ocrResults[0]?.result.status ?? 'no_extractor'
    } else if (extractedCount > 0) {
      ocrStatus = 'partial'
    } else {
      ocrStatus = ocrResults[0]?.result.status ?? 'no_extractor'
    }

    const draft: DraftNote = {
      draftId: nanoid(),
      batchId,
      status: 'pending',
      inferredDate,
      inferredTitle,
      inferredType: null,
      attachmentIds: groupAtts.map((a) => a.attachmentId),
      originalFilenames: groupAtts.map((a) => a.originalFilename),
      originalRelativePaths: groupAtts.map((a) => a.originalRelativePath || a.originalFilename),
      source: 'asset_intake',
      reviewStatus: 'draft',
      captureStatus: 'pending_parent_review',
      uncertainFields: inferredTitle ? ['type'] : ['title', 'type'],
      ocrStatus,
      ocrAttachmentCount: ocrResults.length,
      ocrExtractedCount: extractedCount,
      createdAt: new Date().toISOString(),
    }

    saveDraft(draft)
    draftsCreated++

    const fileList = groupAtts.map((a) => a.originalRelativePath || a.originalFilename).join(', ')
    console.log(`  + [${inferredDate || 'no-date'}] ${fileList}`)
    console.log(`    OCR: ${extractedCount}/${ocrResults.length} extracted (${ocrStatus})`)
  }

  return { draftsCreated, skipped }
}
