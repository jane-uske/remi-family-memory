import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { dataDir } from './paths.js'
import type { DraftNote, BabyEventType, OcrResult } from './types.js'

function draftsDir() { return path.join(dataDir(), 'drafts') }
export function pendingDir() { return path.join(draftsDir(), 'pending') }
export function confirmedDir() { return path.join(draftsDir(), 'confirmed') }
export function rejectedDir() { return path.join(draftsDir(), 'rejected') }
export function ocrDir() { return path.join(draftsDir(), 'ocr') }

export function ensureDraftDirs(): void {
  for (const dir of [pendingDir(), confirmedDir(), rejectedDir(), ocrDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function saveOcrSidecar(result: OcrResult, text: string): void {
  ensureDraftDirs()
  const jsonPath = path.join(ocrDir(), `${result.attachmentId}.ocr.json`)
  const txtPath = path.join(ocrDir(), `${result.attachmentId}.ocr.txt`)
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8')
  writeFileSync(txtPath, text, 'utf-8')
}

export function loadOcrResult(attachmentId: string): OcrResult | null {
  const jsonPath = path.join(ocrDir(), `${attachmentId}.ocr.json`)
  if (!existsSync(jsonPath)) return null
  return JSON.parse(readFileSync(jsonPath, 'utf-8')) as OcrResult
}

export function loadOcrText(attachmentId: string): string | null {
  const txtPath = path.join(ocrDir(), `${attachmentId}.ocr.txt`)
  if (!existsSync(txtPath)) return null
  return readFileSync(txtPath, 'utf-8')
}

export function loadPendingDrafts(): DraftNote[] {
  ensureDraftDirs()
  const dir = pendingDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as DraftNote)
}

export function loadConfirmedDrafts(): DraftNote[] {
  ensureDraftDirs()
  const dir = confirmedDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as DraftNote)
}

export function loadRejectedDrafts(): DraftNote[] {
  ensureDraftDirs()
  const dir = rejectedDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as DraftNote)
}

export function loadAllDrafts(): DraftNote[] {
  return [...loadPendingDrafts(), ...loadConfirmedDrafts(), ...loadRejectedDrafts()]
}

export function saveDraft(draft: DraftNote): void {
  ensureDraftDirs()
  const filePath = path.join(pendingDir(), `${draft.draftId}.json`)
  writeFileSync(filePath, JSON.stringify(draft, null, 2), 'utf-8')
}

function findDraftFile(draftId: string): { filePath: string; draft: DraftNote } | null {
  for (const dir of [pendingDir(), confirmedDir(), rejectedDir()]) {
    const filePath = path.join(dir, `${draftId}.json`)
    if (existsSync(filePath)) {
      const draft = JSON.parse(readFileSync(filePath, 'utf-8')) as DraftNote
      return { filePath, draft }
    }
  }
  return null
}

// --- Confirm ---

export type DraftOverrides = {
  title?: string
  date?: string
  type?: BabyEventType
  summary?: string
  tags?: string[]
}

export type ConfirmResult =
  | { ok: true; noteId: string; filePath: string }
  | { ok: false; error: 'not_found' | 'not_pending' | 'write_failed'; message: string }

export function confirmDraft(draftId: string, overrides?: DraftOverrides): ConfirmResult {
  ensureDraftDirs()
  const found = findDraftFile(draftId)
  if (!found) {
    return { ok: false, error: 'not_found', message: `Draft ${draftId} not found.` }
  }

  if (found.draft.status !== 'pending') {
    return { ok: false, error: 'not_pending', message: `Draft is already ${found.draft.status}.` }
  }

  const draft = found.draft
  const noteId = nanoid()
  const date = overrides?.date || draft.inferredDate || new Date().toISOString().slice(0, 10)
  const title = overrides?.title || draft.inferredTitle || draft.originalFilenames.join(', ')
  const type = overrides?.type || draft.inferredType || 'parent_note'
  const summary = overrides?.summary || ''
  const tags = overrides?.tags || []
  const confirmedAt = new Date().toISOString()

  const attachmentIdsYaml = draft.attachmentIds.map((id) => `  - ${id}`).join('\n')
  const originalFilenamesYaml = draft.originalFilenames.map((f) => `  - "${f}"`).join('\n')
  const tagsYaml = tags.length > 0 ? `\ntags: [${tags.join(', ')}]` : ''

  const content = [
    '---',
    `date: ${date}`,
    `type: ${type}`,
    'source: asset_intake',
    `title: "${title}"`,
    'confirmedByParent: true',
    `attachmentIds:`,
    attachmentIdsYaml,
    `originalFilenames:`,
    originalFilenamesYaml,
    'captureStatus: confirmed_from_draft',
    `draftId: "${draftId}"`,
    'sensitivity: normal',
    ...(tagsYaml ? [tagsYaml.trim()] : []),
    '---',
    '',
    summary || title,
    '',
  ].join('\n')

  const inboxDir = path.join(dataDir(), 'inbox/notes')
  if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true })

  const filename = `${date}-asset-${noteId}.md`
  const noteFilePath = path.join(inboxDir, filename)

  try {
    writeFileSync(noteFilePath, content, 'utf-8')
  } catch (e) {
    return { ok: false, error: 'write_failed', message: `Write failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  draft.status = 'confirmed'
  draft.confirmedAt = confirmedAt
  writeFileSync(found.filePath, JSON.stringify(draft, null, 2), 'utf-8')
  renameSync(found.filePath, path.join(confirmedDir(), `${draftId}.json`))

  const relativePath = path.relative(path.resolve('.'), noteFilePath)
  return { ok: true, noteId, filePath: relativePath }
}

// --- Reject ---

export type RejectResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_pending'; message: string }

export function rejectDraft(draftId: string): RejectResult {
  ensureDraftDirs()
  const found = findDraftFile(draftId)
  if (!found) {
    return { ok: false, error: 'not_found', message: `Draft ${draftId} not found.` }
  }

  if (found.draft.status !== 'pending') {
    return { ok: false, error: 'not_pending', message: `Draft is already ${found.draft.status}.` }
  }

  found.draft.status = 'rejected'
  writeFileSync(found.filePath, JSON.stringify(found.draft, null, 2), 'utf-8')
  renameSync(found.filePath, path.join(rejectedDir(), `${draftId}.json`))

  return { ok: true }
}
