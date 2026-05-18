import { existsSync, readFileSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { dataDir } from './paths.js'
import { listEvents, listAISafeEvents } from './store.js'
import { loadProfile } from './profile.js'
import { loadAttachments } from './attachments.js'
import { loadMemories } from './memory.js'

type CheckStatus = 'PASS' | 'WARN' | 'FAIL'
type CheckResult = { name: string; status: CheckStatus; detail: string }

export function runDoctor(): CheckResult[] {
  const results: CheckResult[] = []

  // 1. Event store readable
  let events: ReturnType<typeof listEvents> = []
  try {
    events = listEvents()
    results.push({ name: 'Event store', status: 'PASS', detail: `${events.length} events loaded` })
  } catch (e) {
    results.push({ name: 'Event store', status: 'FAIL', detail: `Cannot read: ${e}` })
  }

  // 2. Profile exists and is complete
  const profile = loadProfile()
  if (profile) {
    const missing: string[] = []
    if (!profile.nickname) missing.push('nickname')
    if (!profile.expectedBirthDate) missing.push('expectedBirthDate')
    if (!profile.parents || profile.parents.length === 0) missing.push('parents')
    if (missing.length > 0) {
      results.push({ name: 'Baby profile', status: 'WARN', detail: `${profile.nickname || 'unnamed'} — missing: ${missing.join(', ')}` })
    } else {
      results.push({ name: 'Baby profile', status: 'PASS', detail: `${profile.familyName || ''}${profile.nickname} (parents: ${profile.parents.length})` })
    }
  } else {
    results.push({ name: 'Baby profile', status: 'WARN', detail: 'No profile found (data/profile/baby.json)' })
  }

  // 3. Attachment SHA256 integrity
  const attachments = loadAttachments()
  let integrityPass = 0
  let integrityFail = 0
  for (const a of attachments) {
    const absPath = path.resolve(a.storedPath)
    if (!existsSync(absPath)) {
      integrityFail++
      continue
    }
    const buf = readFileSync(absPath)
    const hash = createHash('sha256').update(buf).digest('hex')
    if (hash === a.sha256) {
      integrityPass++
    } else {
      integrityFail++
    }
  }
  if (attachments.length === 0) {
    results.push({ name: 'Attachment integrity', status: 'PASS', detail: 'No attachments to check' })
  } else if (integrityFail === 0) {
    results.push({ name: 'Attachment integrity', status: 'PASS', detail: `${integrityPass}/${attachments.length} SHA256 verified` })
  } else {
    results.push({ name: 'Attachment integrity', status: 'FAIL', detail: `${integrityFail}/${attachments.length} failed verification` })
  }

  // 4. Archive assets exist
  let missingAssets = 0
  for (const a of attachments) {
    if (!existsSync(path.resolve(a.storedPath))) missingAssets++
  }
  if (missingAssets === 0) {
    results.push({ name: 'Archive assets', status: 'PASS', detail: `All ${attachments.length} assets present` })
  } else {
    results.push({ name: 'Archive assets', status: 'FAIL', detail: `${missingAssets} assets missing from archive` })
  }

  // 5. Memory vs events coverage
  const memories = loadMemories()
  const nonBlockedEvents = events.filter((e) => e.sensitivity !== 'blocked_from_ai')
  if (memories.length === 0 && nonBlockedEvents.length > 0) {
    results.push({ name: 'Memory records', status: 'WARN', detail: `No memories built yet (${nonBlockedEvents.length} events available). Run: npm run sync` })
  } else if (memories.length >= nonBlockedEvents.length) {
    results.push({ name: 'Memory records', status: 'PASS', detail: `${memories.length} memories for ${nonBlockedEvents.length} events` })
  } else {
    results.push({ name: 'Memory records', status: 'WARN', detail: `${memories.length} memories for ${nonBlockedEvents.length} events (run sync to rebuild)` })
  }

  // 6. Reports directory
  const repDir = path.join(dataDir(), 'reports')
  if (existsSync(repDir)) {
    results.push({ name: 'Reports directory', status: 'PASS', detail: 'Exists' })
  } else {
    results.push({ name: 'Reports directory', status: 'WARN', detail: 'Not found. Run: npm run report' })
  }

  // 7. Context pack freshness
  const contextMd = path.join(dataDir(), 'context/remi-context.md')
  const contextJson = path.join(dataDir(), 'context/remi-context.json')
  if (existsSync(contextMd) && existsSync(contextJson)) {
    const eventsFile = path.join(dataDir(), 'events/events.json')
    if (existsSync(eventsFile)) {
      const { mtimeMs: evMtime } = statSync(eventsFile)
      const { mtimeMs: ctxMtime } = statSync(contextJson)
      if (ctxMtime < evMtime) {
        results.push({ name: 'Context pack', status: 'WARN', detail: 'Context is older than events. Run: npm run sync' })
      } else {
        results.push({ name: 'Context pack', status: 'PASS', detail: 'Up to date' })
      }
    } else {
      results.push({ name: 'Context pack', status: 'PASS', detail: 'remi-context.md + .json present' })
    }
  } else {
    results.push({ name: 'Context pack', status: 'WARN', detail: 'Not generated yet. Run: npm run sync' })
  }

  // 8. Orphan attachments
  const orphanAttachments = attachments.filter((a) => !existsSync(path.resolve(a.storedPath)))
  if (orphanAttachments.length === 0) {
    results.push({ name: 'Orphan attachments', status: 'PASS', detail: 'None' })
  } else {
    results.push({ name: 'Orphan attachments', status: 'WARN', detail: `${orphanAttachments.length} attachment(s) reference missing files` })
  }

  // 9. Orphan memories
  const orphanMemories = memories.filter((m) => {
    return !events.some((e) => e.id === m.sourceEventId)
  })
  if (orphanMemories.length === 0) {
    results.push({ name: 'Orphan memories', status: 'PASS', detail: 'All memories have valid source events' })
  } else {
    results.push({ name: 'Orphan memories', status: 'WARN', detail: `${orphanMemories.length} memory(ies) reference missing events` })
  }

  // 10. Inbox pending notes
  const inboxDir = path.join(dataDir(), 'inbox/notes')
  if (existsSync(inboxDir)) {
    const pending = readdirSync(inboxDir).filter((f) => f.endsWith('.md'))
    if (pending.length > 0) {
      results.push({ name: 'Inbox pending', status: 'WARN', detail: `${pending.length} note(s) waiting in inbox. Run: npm run sync` })
    } else {
      results.push({ name: 'Inbox pending', status: 'PASS', detail: 'No pending notes' })
    }
  } else {
    results.push({ name: 'Inbox pending', status: 'PASS', detail: 'No pending notes' })
  }

  // 11. Processed notes exist
  const processedDir = path.join(dataDir(), 'processed/notes')
  if (existsSync(processedDir)) {
    const processed = readdirSync(processedDir).filter((f) => f.endsWith('.md'))
    results.push({ name: 'Processed notes', status: 'PASS', detail: `${processed.length} note(s) in processed archive` })
  } else {
    results.push({ name: 'Processed notes', status: 'PASS', detail: 'No processed notes yet' })
  }

  // 12. blocked_from_ai leak check
  const aiSafe = listAISafeEvents()
  const leaked = aiSafe.filter((e) => e.sensitivity === 'blocked_from_ai')
  if (leaked.length === 0) {
    results.push({ name: 'Privacy boundary', status: 'PASS', detail: 'blocked_from_ai never enters AI-safe layer' })
  } else {
    results.push({ name: 'Privacy boundary', status: 'FAIL', detail: `${leaked.length} blocked_from_ai event(s) leaked into AI-safe events!` })
  }

  // 13. Export directory writable
  const exportDir = path.join(dataDir(), 'exports')
  try {
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true })
    }
    results.push({ name: 'Export directory', status: 'PASS', detail: 'Writable' })
  } catch {
    results.push({ name: 'Export directory', status: 'FAIL', detail: 'Cannot create export directory' })
  }

  return results
}

export function printDoctorResults(results: CheckResult[]): void {
  console.log()
  console.log('  Remi Family Memory — Health Check (v1.0)')
  console.log('  ==========================================')
  console.log()

  for (const r of results) {
    const icon = r.status === 'PASS' ? '[PASS]' : r.status === 'WARN' ? '[WARN]' : '[FAIL]'
    console.log(`  ${icon} ${r.name}`)
    console.log(`        ${r.detail}`)
  }

  console.log()
  const pass = results.filter((r) => r.status === 'PASS').length
  const warn = results.filter((r) => r.status === 'WARN').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log(`  Summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`)
  console.log()
}
