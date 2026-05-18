import { readdirSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parseMarkdownNote } from './parser.js'
import { saveEvent, hasSourcePath } from './store.js'

const INBOX_DIR = path.resolve('data/inbox/notes')
const PROCESSED_DIR = path.resolve('data/processed/notes')

export function scanInbox(): { added: number; skipped: number } {
  if (!existsSync(INBOX_DIR)) {
    mkdirSync(INBOX_DIR, { recursive: true })
    return { added: 0, skipped: 0 }
  }

  if (!existsSync(PROCESSED_DIR)) {
    mkdirSync(PROCESSED_DIR, { recursive: true })
  }

  const files = readdirSync(INBOX_DIR).filter((f) => f.endsWith('.md'))
  let added = 0
  let skipped = 0

  for (const file of files) {
    const filePath = path.join(INBOX_DIR, file)
    const relativePath = path.relative(path.resolve('.'), filePath)

    if (hasSourcePath(relativePath)) {
      skipped++
      continue
    }

    const content = readFileSync(filePath, 'utf-8')
    const event = parseMarkdownNote(content, relativePath)
    saveEvent(event)

    const dest = path.join(PROCESSED_DIR, file)
    renameSync(filePath, dest)

    added++
    console.log(`  + ${event.title} (${event.type}, ${event.occurredAt.slice(0, 10)})`)
  }

  return { added, skipped }
}
