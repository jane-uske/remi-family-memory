import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { loadAttachments } from './attachments.js'
import { loadPendingDrafts, pendingDir, saveDraft } from './drafts.js'
import { callVlm, getVlmConfig } from './local_vlm_extractor.js'
import type { FetchFn } from './local_vlm_extractor.js'
import type { DraftNote, Attachment, BabyEventType, VlmExtractionMetadata } from './types.js'

export type EnrichResult =
  | { ok: true; draftId: string; enriched: boolean; message: string }
  | { ok: false; draftId: string; error: 'not_found' | 'not_pending' | 'no_vlm_config' | 'no_image_attachments' | 'vlm_failed'; message: string }

const VALID_EVENT_TYPES = new Set<string>([
  'pregnancy_checkup', 'fetal_movement', 'birth', 'milestone',
  'parent_note', 'family_event', 'medical_record', 'vaccine',
  'growth_metric', 'photo_memory', 'voice_memory', 'video', 'system_event',
])

function loadDraftById(draftId: string): DraftNote | null {
  const filePath = path.join(pendingDir(), `${draftId}.json`)
  if (!existsSync(filePath)) return null
  return JSON.parse(readFileSync(filePath, 'utf-8')) as DraftNote
}

export async function enrichDraft(draftId: string, fetchFn?: FetchFn): Promise<EnrichResult> {
  const draft = loadDraftById(draftId)
  if (!draft) {
    return { ok: false, draftId, error: 'not_found', message: `Draft ${draftId} not found in pending.` }
  }

  if (draft.status !== 'pending') {
    return { ok: false, draftId, error: 'not_pending', message: `Draft ${draftId} is ${draft.status}, not pending.` }
  }

  const config = getVlmConfig()
  if (!config) {
    return { ok: false, draftId, error: 'no_vlm_config', message: 'VLM_MODEL environment variable is not set.' }
  }

  const allAttachments = loadAttachments()
  const attachmentMap = new Map<string, Attachment>()
  for (const a of allAttachments) {
    attachmentMap.set(a.attachmentId, a)
  }

  const imageAttachments = draft.attachmentIds
    .map((id) => attachmentMap.get(id))
    .filter((a): a is Attachment => a !== undefined && a.type === 'image')

  if (imageAttachments.length === 0) {
    return { ok: false, draftId, error: 'no_image_attachments', message: `Draft ${draftId} has no image attachments.` }
  }

  const maxAttempts = Math.min(imageAttachments.length, 3)
  let lastError = ''

  for (let i = 0; i < maxAttempts; i++) {
    const attachment = imageAttachments[i]
    const absolutePath = path.resolve(attachment.storedPath)

    if (!existsSync(absolutePath)) {
      lastError = `Image file not found: ${attachment.storedPath}`
      continue
    }

    const imageBuffer = readFileSync(absolutePath)
    const result = await callVlm(imageBuffer, attachment.mimeType, config, fetchFn)

    if (!result.ok) {
      lastError = result.message
      continue
    }

    const output = result.output
    draft.inferredDate ??= output.inferredDate
    draft.inferredTitle ??= output.inferredTitle

    if (draft.inferredType === null && output.inferredType && VALID_EVENT_TYPES.has(output.inferredType)) {
      draft.inferredType = output.inferredType as BabyEventType
    }

    const mergedUncertain = new Set([...draft.uncertainFields, ...output.uncertainFields])
    draft.uncertainFields = Array.from(mergedUncertain)

    draft.extractedFacts = output.facts
    draft.extractionMetadata = {
      model: config.model,
      extractedAt: new Date().toISOString(),
      attachmentId: attachment.attachmentId,
      validationWarnings: result.validationWarnings,
      rawResponseLength: result.rawResponseLength,
    } satisfies VlmExtractionMetadata

    saveDraft(draft)

    return {
      ok: true,
      draftId,
      enriched: true,
      message: `Enriched from ${attachment.originalFilename} (${result.validationWarnings.length} warnings)`,
    }
  }

  return { ok: false, draftId, error: 'vlm_failed', message: `VLM extraction failed: ${lastError}` }
}

export async function enrichPendingDrafts(fetchFn?: FetchFn): Promise<{
  total: number
  enriched: number
  skipped: number
  failed: number
  results: EnrichResult[]
}> {
  const pending = loadPendingDrafts()
  const results: EnrichResult[] = []
  let enriched = 0
  let skipped = 0
  let failed = 0

  for (const draft of pending) {
    const result = await enrichDraft(draft.draftId, fetchFn)

    if (result.ok) {
      enriched++
    } else if (result.error === 'no_image_attachments') {
      skipped++
    } else {
      failed++
    }

    results.push(result)
  }

  return { total: pending.length, enriched, skipped, failed, results }
}
