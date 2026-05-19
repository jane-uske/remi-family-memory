import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

export const pdfScanExtractor: OcrExtractor = {
  extractorId: 'pdf-scan-tesseract',

  canHandle(attachmentType: AttachmentType): boolean {
    return attachmentType === 'pdf'
  },

  extract(absolutePath: string, attachmentId: string): Promise<{ text: string; result: OcrResult }> {
    return new Promise((resolve) => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'remi-pdf-'))
      const outputPrefix = path.join(tmpDir, 'page')

      execFile('pdftoppm', ['-png', '-r', '300', absolutePath, outputPrefix], { timeout: 120_000 }, (ppmErr) => {
        if (ppmErr) {
          cleanupDir(tmpDir)
          if (ppmErr.message?.includes('ENOENT') || ppmErr.message?.includes('not found')) {
            resolve(makeResult(attachmentId, 'pdf', 'pdf-scan-tesseract', 'no_extractor', '', { errorMessage: 'pdftoppm not installed' }))
            return
          }
          const msg = ppmErr.killed ? 'pdftoppm timeout (120s)' : ppmErr.message
          resolve(makeResult(attachmentId, 'pdf', 'pdf-scan-tesseract', 'error', '', { errorMessage: msg }))
          return
        }

        const pageFiles = readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort()
        if (pageFiles.length === 0) {
          cleanupDir(tmpDir)
          resolve(makeResult(attachmentId, 'pdf', 'pdf-scan-tesseract', 'no_text', '', { pageCount: 0 }))
          return
        }

        const pageTexts: string[] = []
        let processed = 0

        for (const pageFile of pageFiles) {
          const pagePath = path.join(tmpDir, pageFile)
          execFile('tesseract', [pagePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (tessErr, tessOut) => {
            processed++
            if (!tessErr && tessOut.trim().length > 0) {
              pageTexts.push(tessOut.trim())
            }

            if (processed === pageFiles.length) {
              cleanupDir(tmpDir)
              const combined = pageTexts.join('\n\n---\n\n')
              if (combined.length === 0) {
                resolve(makeResult(attachmentId, 'pdf', 'pdf-scan-tesseract', 'no_text', '', { pageCount: pageFiles.length }))
              } else {
                resolve(makeResult(attachmentId, 'pdf', 'pdf-scan-tesseract', 'extracted', combined, { pageCount: pageFiles.length }))
              }
            }
          })
        }
      })
    })
  },
}

function cleanupDir(dir: string): void {
  try {
    for (const f of readdirSync(dir)) unlinkSync(path.join(dir, f))
    rmdirSync(dir)
  } catch { /* best-effort cleanup */ }
}

export const tesseractExtractor: OcrExtractor = {
  extractorId: 'tesseract',

  canHandle(attachmentType: AttachmentType): boolean {
    return attachmentType === 'image'
  },

  extract(absolutePath: string, attachmentId: string): Promise<{ text: string; result: OcrResult }> {
    return new Promise((resolve) => {
      execFile('tesseract', [absolutePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
            resolve(makeResult(attachmentId, 'image', 'tesseract', 'no_extractor', '', { errorMessage: 'tesseract not installed' }))
            return
          }
          const msg = err.killed ? 'timeout (60s)' : err.message
          resolve(makeResult(attachmentId, 'image', 'tesseract', 'error', '', { errorMessage: msg }))
          return
        }
        const text = stdout.trim()
        if (text.length === 0) {
          resolve(makeResult(attachmentId, 'image', 'tesseract', 'no_text', ''))
        } else {
          resolve(makeResult(attachmentId, 'image', 'tesseract', 'extracted', text))
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

const EXTRACTORS: OcrExtractor[] = [pdfTextExtractor, tesseractExtractor, noOpExtractor]

const PDF_FALLBACK_THRESHOLD = 20

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

  if (attachment.type === 'pdf' && result.text.length < PDF_FALLBACK_THRESHOLD) {
    const fallback = await pdfScanExtractor.extract(absolutePath, attachment.attachmentId)
    if (fallback.result.status === 'extracted' && fallback.text.length > result.text.length) {
      fallback.result.attachmentType = attachment.type
      return fallback
    }
  }

  return result
}

export async function extractOcrForDraft(attachments: Attachment[]): Promise<Array<{ text: string; result: OcrResult }>> {
  const results: Array<{ text: string; result: OcrResult }> = []
  for (const a of attachments) {
    results.push(await extractOcrForAttachment(a))
  }
  return results
}
