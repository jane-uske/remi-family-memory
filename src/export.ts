import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { listEvents } from './store.js'
import { loadProfile } from './profile.js'
import { loadAttachments } from './attachments.js'
import { loadMemories } from './memory.js'
import { SCHEMA_VERSION } from './types.js'

const EXPORTS_DIR = path.resolve('data/exports')
const REPORTS_DIR = path.resolve('data/reports')
const CONTEXT_DIR = path.resolve('data/context')

export function exportAll(): string {
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const exportDir = path.join(EXPORTS_DIR, `family-memory-export-${dateStr}`)

  mkdirSync(exportDir, { recursive: true })
  mkdirSync(path.join(exportDir, 'reports'), { recursive: true })
  mkdirSync(path.join(exportDir, 'assets'), { recursive: true })
  mkdirSync(path.join(exportDir, 'memory'), { recursive: true })
  mkdirSync(path.join(exportDir, 'context'), { recursive: true })

  const profile = loadProfile()
  if (profile) {
    writeFileSync(path.join(exportDir, 'profile.json'), JSON.stringify(profile, null, 2), 'utf-8')
  }

  const events = listEvents()
  writeFileSync(path.join(exportDir, 'events.json'), JSON.stringify(events, null, 2), 'utf-8')

  const attachments = loadAttachments()
  writeFileSync(path.join(exportDir, 'attachments.json'), JSON.stringify(attachments, null, 2), 'utf-8')

  const memories = loadMemories()
  writeFileSync(path.join(exportDir, 'memory', 'memories.json'), JSON.stringify(memories, null, 2), 'utf-8')

  if (existsSync(REPORTS_DIR)) {
    const reports = readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.md'))
    for (const file of reports) {
      copyFileSync(path.join(REPORTS_DIR, file), path.join(exportDir, 'reports', file))
    }
  }

  if (existsSync(CONTEXT_DIR)) {
    const contextFiles = readdirSync(CONTEXT_DIR)
    for (const file of contextFiles) {
      copyFileSync(path.join(CONTEXT_DIR, file), path.join(exportDir, 'context', file))
    }
  }

  for (const a of attachments) {
    const absPath = path.resolve(a.storedPath)
    if (existsSync(absPath)) {
      copyFileSync(absPath, path.join(exportDir, 'assets', path.basename(a.storedPath)))
    }
  }

  const readme = generateExportReadme(events.length, attachments.length, memories.length, profile?.nickname)
  writeFileSync(path.join(exportDir, 'README_export.md'), readme, 'utf-8')

  return exportDir
}

function generateExportReadme(eventCount: number, attachmentCount: number, memoryCount: number, nickname?: string): string {
  return `# Family Memory Export

## What Is This

This is a complete export of the **Remi Family Memory** system${nickname ? ` for ${nickname}` : ''}.

It contains all structured family memories, AI-readable memory records, attachments, context packs, and reports.

This is NOT a backup of the application — it is a **portable archive** of your family's data that can be consumed by AI systems.

## Schema Version

\`${SCHEMA_VERSION}\`

## Contents

| File/Dir | Description |
| --- | --- |
| \`profile.json\` | Baby profile (basic info, parents, expected birth date) |
| \`events.json\` | All ${eventCount} family events (BabyEvent records) |
| \`attachments.json\` | All ${attachmentCount} attachment metadata records |
| \`memory/memories.json\` | ${memoryCount} AI-readable memory records (MemoryRecord) |
| \`context/\` | Remi context pack (markdown + JSON) |
| \`reports/\` | Monthly report Markdown files |
| \`assets/\` | Archived media files |

## Data Layers

1. **Events** (events.json): Raw structured events — source of truth
2. **Memories** (memory/): AI-derived memory cards with importance, facts, summaries
3. **Context** (context/): Pre-built context pack for Remi/AI ingestion

## How to Restore

1. Place \`events.json\` in \`data/events/events.json\`
2. Place \`attachments.json\` in \`data/events/attachments.json\`
3. Place \`profile.json\` in \`data/profile/baby.json\`
4. Place \`memory/\` contents in \`data/memory/\`
5. Place \`context/\` contents in \`data/context/\`
6. Copy \`reports/\` to \`data/reports/\`
7. Copy \`assets/\` to \`data/archive/assets/\`

## How Remi Uses This

Remi loads \`context/remi-context.json\` as its family memory context. The JSON contains:
- Baby profile summary
- Core and high-importance memories
- Recent events
- Parent notes

For deeper queries, Remi can search \`memory/memories.json\` by keyword, date, or importance.

## Generated

Export date: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
Schema version: ${SCHEMA_VERSION}
`
}
