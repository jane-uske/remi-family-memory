import { readdirSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { parseMarkdownNote } from './parser.js'
import { saveEvent, hasSourcePath } from './store.js'

function inboxDir() { return path.join(dataDir(), 'inbox/notes') }
function processedDir() { return path.join(dataDir(), 'processed/notes') }

export function scanInbox(): { added: number; skipped: number } {
  const inbox = inboxDir()
  if (!existsSync(inbox)) {
    mkdirSync(inbox, { recursive: true })
    return { added: 0, skipped: 0 }
  }

  const processed = processedDir()
  if (!existsSync(processed)) {
    mkdirSync(processed, { recursive: true })
  }

  const files = readdirSync(inbox).filter((f) => f.endsWith('.md'))
  let added = 0
  let skipped = 0

  for (const file of files) {
    const filePath = path.join(inbox, file)
    const relativePath = path.relative(path.resolve('.'), filePath)

    if (hasSourcePath(relativePath)) {
      skipped++
      continue
    }

    const content = readFileSync(filePath, 'utf-8')
    const event = parseMarkdownNote(content, relativePath)
    saveEvent(event)

    const dest = path.join(processed, file)
    renameSync(filePath, dest)

    added++
    console.log(`  + ${event.title} (${event.type}, ${event.occurredAt.slice(0, 10)})`)
  }

  return { added, skipped }
}
