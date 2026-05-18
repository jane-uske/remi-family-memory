import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { SCHEMA_VERSION } from './types.js'
import type { Attachment, AttachmentType } from './types.js'

const ATTACHMENTS_FILE = path.resolve('data/events/attachments.json')
const ASSETS_INBOX = path.resolve('data/inbox/assets')
const ASSETS_ARCHIVE = path.resolve('data/archive/assets')
const ORIGINALS_ARCHIVE = path.resolve('data/archive/originals')

const MIME_MAP: Record<string, { mime: string; type: AttachmentType }> = {
  '.jpg': { mime: 'image/jpeg', type: 'image' },
  '.jpeg': { mime: 'image/jpeg', type: 'image' },
  '.png': { mime: 'image/png', type: 'image' },
  '.gif': { mime: 'image/gif', type: 'image' },
  '.webp': { mime: 'image/webp', type: 'image' },
  '.heic': { mime: 'image/heic', type: 'image' },
  '.mp4': { mime: 'video/mp4', type: 'video' },
  '.mov': { mime: 'video/quicktime', type: 'video' },
  '.avi': { mime: 'video/x-msvideo', type: 'video' },
  '.mp3': { mime: 'audio/mpeg', type: 'audio' },
  '.m4a': { mime: 'audio/mp4', type: 'audio' },
  '.wav': { mime: 'audio/wav', type: 'audio' },
  '.ogg': { mime: 'audio/ogg', type: 'audio' },
  '.pdf': { mime: 'application/pdf', type: 'pdf' },
  '.doc': { mime: 'application/msword', type: 'document' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'document' },
}

function ensureDirs() {
  for (const dir of [ASSETS_INBOX, ASSETS_ARCHIVE, ORIGINALS_ARCHIVE, path.dirname(ATTACHMENTS_FILE)]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function loadAttachments(): Attachment[] {
  ensureDirs()
  if (!existsSync(ATTACHMENTS_FILE)) return []
  const raw = readFileSync(ATTACHMENTS_FILE, 'utf-8')
  return JSON.parse(raw) as Attachment[]
}

function saveAttachments(attachments: Attachment[]): void {
  ensureDirs()
  writeFileSync(ATTACHMENTS_FILE, JSON.stringify(attachments, null, 2), 'utf-8')
}

export function addAttachment(attachment: Attachment): void {
  const attachments = loadAttachments()
  attachments.push(attachment)
  saveAttachments(attachments)
}

export function hasSha256(sha256: string): boolean {
  return loadAttachments().some((a) => a.sha256 === sha256)
}

function computeSha256(filePath: string): string {
  const buf = readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

function getFileInfo(ext: string): { mime: string; type: AttachmentType } {
  return MIME_MAP[ext.toLowerCase()] || { mime: 'application/octet-stream', type: 'other' }
}

export function scanAssets(): { added: number; skipped: number } {
  ensureDirs()

  if (!existsSync(ASSETS_INBOX)) return { added: 0, skipped: 0 }

  const files = readdirSync(ASSETS_INBOX).filter((f) => !f.startsWith('.'))
  let added = 0
  let skipped = 0

  for (const file of files) {
    const filePath = path.join(ASSETS_INBOX, file)
    const stat = statSync(filePath)
    if (!stat.isFile()) continue

    const sha256 = computeSha256(filePath)

    if (hasSha256(sha256)) {
      skipped++
      continue
    }

    const ext = path.extname(file)
    const { mime, type } = getFileInfo(ext)
    const id = nanoid()
    const storedFilename = `${id}${ext}`
    const storedPath = path.join(ASSETS_ARCHIVE, storedFilename)

    renameSync(filePath, storedPath)

    const now = new Date().toISOString()
    const attachment: Attachment = {
      attachmentId: id,
      type,
      originalFilename: file,
      storedPath: path.relative(path.resolve('.'), storedPath),
      mimeType: mime,
      size: stat.size,
      sha256,
      createdAt: now,
      importedAt: now,
      schemaVersion: SCHEMA_VERSION,
    }

    addAttachment(attachment)
    added++
    console.log(`  + [${type}] ${file} (${formatSize(stat.size)})`)
  }

  return { added, skipped }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
