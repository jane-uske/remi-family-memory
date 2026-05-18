import { scanInbox } from './scanner.js'
import { scanAssets } from './attachments.js'
import { buildMemories } from './memory.js'
import { generateContext } from './context.js'
import { runDoctor, printDoctorResults } from './doctor.js'
import { listEvents } from './store.js'
import { loadMemories } from './memory.js'

export function runSync(): boolean {
  console.log()
  console.log('  Remi Family Memory — Sync')
  console.log('  =========================')
  console.log()

  // Step 1: Scan
  console.log('  [1/4] Scanning inbox...')
  let notes: { added: number; skipped: number }
  let assets: { added: number; skipped: number }
  try {
    notes = scanInbox()
    assets = scanAssets()
    console.log(`        Notes: ${notes.added} added, ${notes.skipped} skipped`)
    console.log(`        Assets: ${assets.added} added, ${assets.skipped} skipped`)
  } catch (e) {
    console.error(`  [FAIL] Scan failed: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  // Step 2: Build memory
  console.log()
  console.log('  [2/4] Building memory records...')
  let memResult: { total: number; created: number; updated: number }
  try {
    memResult = buildMemories()
    console.log(`        ${memResult.total} memories (${memResult.created} created, ${memResult.updated} updated)`)
  } catch (e) {
    console.error(`  [FAIL] Build memory failed: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  // Step 3: Generate context
  console.log()
  console.log('  [3/4] Generating context pack...')
  let ctxResult: { mdPath: string; jsonPath: string }
  try {
    ctxResult = generateContext()
    console.log(`        ${ctxResult.mdPath}`)
    console.log(`        ${ctxResult.jsonPath}`)
  } catch (e) {
    console.error(`  [FAIL] Context generation failed: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  // Step 4: Doctor
  console.log()
  console.log('  [4/4] Running health check...')
  const doctorResults = runDoctor()
  const fails = doctorResults.filter((r) => r.status === 'FAIL')
  if (fails.length > 0) {
    console.log()
    printDoctorResults(doctorResults)
    console.error(`  [FAIL] Doctor found ${fails.length} failure(s).`)
    return false
  }
  const warns = doctorResults.filter((r) => r.status === 'WARN')
  console.log(`        ${doctorResults.length} checks: ${doctorResults.length - warns.length} PASS, ${warns.length} WARN, 0 FAIL`)

  // Summary
  console.log()
  console.log('  ─────────────────────────────')
  const events = listEvents()
  const memories = loadMemories()
  console.log(`  Total events:   ${events.length}`)
  console.log(`  Total memories: ${memories.length}`)
  console.log(`  New events:     ${notes.added}`)
  console.log(`  New memories:   ${memResult.created}`)
  console.log(`  Context updated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  console.log()
  console.log('  Sync complete.')
  console.log()

  return true
}
