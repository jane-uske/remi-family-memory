import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { listEvents } from './store.js'
import { loadProfile } from './profile.js'
import { loadAttachments } from './attachments.js'
import { loadMemories } from './memory.js'

type CheckStatus = 'PASS' | 'WARN' | 'FAIL'
type CheckResult = { name: string; status: CheckStatus; detail: string }

export function runDoctor(): CheckResult[] {
  const results: CheckResult[] = []

  // 1. Event store readable
  try {
    const events = listEvents()
    results.push({ name: 'Event store', status: 'PASS', detail: `${events.length} events loaded` })
  } catch (e) {
    results.push({ name: 'Event store', status: 'FAIL', detail: `Cannot read: ${e}` })
  }

  // 2. Profile exists
  const profile = loadProfile()
  if (profile) {
    results.push({ name: 'Baby profile', status: 'PASS', detail: `${profile.familyName || ''}${profile.nickname}` })
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

  // 5. Memories can be rebuilt from events
  const events = listEvents()
  const memories = loadMemories()
  const nonBlockedEvents = events.filter((e) => e.sensitivity !== 'blocked_from_ai')
  if (memories.length === 0 && nonBlockedEvents.length > 0) {
    results.push({ name: 'Memory records', status: 'WARN', detail: `No memories built yet (${nonBlockedEvents.length} events available). Run: npm run build-memory` })
  } else if (memories.length >= nonBlockedEvents.length) {
    results.push({ name: 'Memory records', status: 'PASS', detail: `${memories.length} memories for ${nonBlockedEvents.length} events` })
  } else {
    results.push({ name: 'Memory records', status: 'WARN', detail: `${memories.length} memories for ${nonBlockedEvents.length} events (some missing)` })
  }

  // 6. Reports directory
  const reportsDir = path.resolve('data/reports')
  if (existsSync(reportsDir)) {
    results.push({ name: 'Reports directory', status: 'PASS', detail: 'Exists' })
  } else {
    results.push({ name: 'Reports directory', status: 'WARN', detail: 'Not found. Run: npm run report' })
  }

  // 7. Context pack
  const contextMd = path.resolve('data/context/remi-context.md')
  const contextJson = path.resolve('data/context/remi-context.json')
  if (existsSync(contextMd) && existsSync(contextJson)) {
    results.push({ name: 'Context pack', status: 'PASS', detail: 'remi-context.md + .json present' })
  } else {
    results.push({ name: 'Context pack', status: 'WARN', detail: 'Not generated yet. Run: npm run context' })
  }

  // 8. Orphan attachments (no matching asset file)
  const orphanAttachments = attachments.filter((a) => !existsSync(path.resolve(a.storedPath)))
  if (orphanAttachments.length === 0) {
    results.push({ name: 'Orphan attachments', status: 'PASS', detail: 'None' })
  } else {
    results.push({ name: 'Orphan attachments', status: 'WARN', detail: `${orphanAttachments.length} attachment(s) reference missing files` })
  }

  // 9. Memories without sourceEventId
  const orphanMemories = memories.filter((m) => {
    return !events.some((e) => e.id === m.sourceEventId)
  })
  if (orphanMemories.length === 0) {
    results.push({ name: 'Orphan memories', status: 'PASS', detail: 'All memories have valid source events' })
  } else {
    results.push({ name: 'Orphan memories', status: 'WARN', detail: `${orphanMemories.length} memory(ies) reference missing events` })
  }

  return results
}

export function printDoctorResults(results: CheckResult[]): void {
  console.log()
  console.log('  Remi Family Memory — Health Check')
  console.log('  ==================================')
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
