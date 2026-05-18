import { execFile } from 'node:child_process'
import path from 'node:path'
import type { Attachment, AttachmentType, OcrResult, OcrStatus } from './types.js'
import { SCHEMA_VERSION } from './types.js'

export interface OcrExtractor {
  readonly extractorId: string
  canHandle(attachmentType: AttachmentType): boolean
  extract(absolutePath: string, attachmentId: string): Promise<{ text: string; result: OcrResult }>
}

function makeResult(attachmentId: string, attachmentType: AttachmentType, extractorId: string, status: OcrStatus, text: string, opts?: { errorMessage?: string; pageCount?: number }): { text: string; result: OcrResult } {
  return {
    text,
    result: {
      attachmentId,
      attachmentType,
      extractorId,
      status,
      charCount: text.length,
      extractedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      ...(opts?.errorMessage ? { errorMessage: opts.errorMessage } : {}),
      ...(opts?.pageCount !== undefined ? { pageCount: opts.pageCount } : {}),
    },
  }
}

export const pdfTextExtractor: OcrExtractor = {
  extractorId: 'pdftotext',

  canHandle(attachmentType: AttachmentType): boolean {
    return attachmentType === 'pdf'
  },

  extract(absolutePath: string, attachmentId: string): Promise<{ text: string; result: OcrResult }> {
    return new Promise((resolve) => {
      execFile('pdftotext', [absolutePath, '-'], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          const msg = err.killed ? 'timeout (30s)' : err.message
          resolve(makeResult(attachmentId, 'pdf', 'pdftotext', 'error', '', { errorMessage: msg }))
          return
        }
        const text = stdout.trim()
        if (text.length === 0) {
          resolve(makeResult(attachmentId, 'pdf', 'pdftotext', 'no_text', ''))
        } else {
          resolve(makeResult(attachmentId, 'pdf', 'pdftotext', 'extracted', text))
        }
      })
    })
  },
}

export const noOpExtractor: OcrExtractor = {
  extractorId: 'noop',

  canHandle(_attachmentType: AttachmentType): boolean {
    return true
  },

  extract(_absolutePath: string, attachmentId: string): Promise<{ text: string; result: OcrResult }> {
    return Promise.resolve(makeResult(attachmentId, 'image', 'noop', 'no_extractor', ''))
  },
}

const EXTRACTORS: OcrExtractor[] = [pdfTextExtractor, noOpExtractor]

function getExtractor(attachmentType: AttachmentType): OcrExtractor {
  for (const ext of EXTRACTORS) {
    if (ext.canHandle(attachmentType)) return ext
  }
  return noOpExtractor
}

export async function extractOcrForAttachment(attachment: Attachment): Promise<{ text: string; result: OcrResult }> {
  const extractor = getExtractor(attachment.type)
  const absolutePath = path.resolve(attachment.storedPath)
  const result = await extractor.extract(absolutePath, attachment.attachmentId)
  result.result.attachmentType = attachment.type
  return result
}

export async function extractOcrForDraft(attachments: Attachment[]): Promise<Array<{ text: string; result: OcrResult }>> {
  const results: Array<{ text: string; result: OcrResult }> = []
  for (const a of attachments) {
    results.push(await extractOcrForAttachment(a))
  }
  return results
}
