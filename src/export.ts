import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { listEvents } from './store.js'
import { loadProfile } from './profile.js'
import { loadAttachments } from './attachments.js'
import { loadMemories } from './memory.js'
import { SCHEMA_VERSION } from './types.js'

function exportsDir() { return path.join(dataDir(), 'exports') }
function reportsDir() { return path.join(dataDir(), 'reports') }
function contextDir() { return path.join(dataDir(), 'context') }
function processedDir() { return path.join(dataDir(), 'processed/notes') }

export function exportAll(): string {
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const exportDir = path.join(exportsDir(), `family-memory-export-${dateStr}`)

  mkdirSync(exportDir, { recursive: true })
  mkdirSync(path.join(exportDir, 'reports'), { recursive: true })
  mkdirSync(path.join(exportDir, 'assets'), { recursive: true })
  mkdirSync(path.join(exportDir, 'memory'), { recursive: true })
  mkdirSync(path.join(exportDir, 'context'), { recursive: true })
  mkdirSync(path.join(exportDir, 'processed'), { recursive: true })

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

  if (existsSync(reportsDir())) {
    const reports = readdirSync(reportsDir()).filter((f) => f.endsWith('.md'))
    for (const file of reports) {
      copyFileSync(path.join(reportsDir(), file), path.join(exportDir, 'reports', file))
    }
  }

  if (existsSync(contextDir())) {
    const contextFiles = readdirSync(contextDir())
    for (const file of contextFiles) {
      copyFileSync(path.join(contextDir(), file), path.join(exportDir, 'context', file))
    }
  }

  // Processed notes (source originals)
  if (existsSync(processedDir())) {
    const processed = readdirSync(processedDir()).filter((f) => f.endsWith('.md'))
    for (const file of processed) {
      copyFileSync(path.join(processedDir(), file), path.join(exportDir, 'processed', file))
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

It contains all structured family memories, AI-readable memory records, attachments, context packs, processed notes, and reports.

This is NOT a backup of the application — it is a **portable archive** of your family's data.

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
| \`processed/\` | Original note source files (after scan) |
| \`assets/\` | Archived media files |

## Data Layers

1. **Events** (events.json): Raw structured events — source of truth
2. **Memories** (memory/): AI-derived memory cards with importance, facts, summaries
3. **Context** (context/): Pre-built context pack for Remi/AI ingestion
4. **Processed** (processed/): Original Markdown notes that produced events

## How to Restore

1. Install remi-family-memory: \`git clone\` + \`npm install\`
2. Place \`events.json\` → \`data/events/events.json\`
3. Place \`attachments.json\` → \`data/events/attachments.json\`
4. Place \`profile.json\` → \`data/profile/baby.json\`
5. Place \`memory/\` contents → \`data/memory/\`
6. Place \`context/\` contents → \`data/context/\`
7. Copy \`reports/\` → \`data/reports/\`
8. Copy \`processed/\` → \`data/processed/notes/\`
9. Copy \`assets/\` → \`data/archive/assets/\`

## How to Re-sync After Restore

\`\`\`bash
npm run sync
\`\`\`

This will scan any pending inbox notes, rebuild memory, regenerate context, and run health checks.

## How to Start the Service

\`\`\`bash
npm run serve
\`\`\`

Service runs on http://localhost:3456 by default.

## How to Reconnect Remi

Set these environment variables in the Remi process:

\`\`\`
REMI_FAMILY_MEMORY_ENABLED=1
REMI_FAMILY_MEMORY_SERVICE_URL=http://localhost:3456
REMI_FAMILY_MEMORY_AI_TOKEN=<your-token-if-set>
\`\`\`

Remi will automatically reconnect on next family question or capture intent.

## Generated

Export date: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
Schema version: ${SCHEMA_VERSION}
`
}
