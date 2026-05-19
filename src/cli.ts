import { scanInbox } from './scanner.js'
import { scanAssets } from './attachments.js'
import { startServer } from './server.js'
import { listEvents } from './store.js'
import { writeReport } from './report.js'
import { search } from './search.js'
import { exportAll } from './export.js'
import { buildMemories } from './memory.js'
import { generateContext } from './context.js'
import { runDoctor, printDoctorResults } from './doctor.js'
import { runSync } from './sync.js'
import { EVENT_TYPE_LABELS } from './types.js'
import { runConnectorDemo, runDegradationDemo } from './connector-demo.js'
import { runCaptureDemo } from './capture-demo.js'

const command = process.argv[2]

switch (command) {
  case 'scan': {
    console.log('Scanning notes inbox...')
    const notes = scanInbox()
    console.log(`Notes: ${notes.added} added, ${notes.skipped} skipped.`)
    console.log()
    console.log('Scanning assets inbox...')
    const assets = scanAssets()
    console.log(`Assets: ${assets.added} added, ${assets.skipped} skipped.`)
    console.log()
    const total = listEvents().length
    console.log(`Total events: ${total}`)
    break
  }

  case 'scan-assets': {
    console.log('Scanning assets inbox...')
    const { added, skipped } = scanAssets()
    console.log(`Done. ${added} added, ${skipped} skipped.`)
    break
  }

  case 'serve': {
    startServer()
    break
  }

  case 'dev': {
    console.log('Scanning notes inbox...')
    const notes = scanInbox()
    console.log(`Notes: ${notes.added} added, ${notes.skipped} skipped.`)
    console.log('Scanning assets inbox...')
    const assets = scanAssets()
    console.log(`Assets: ${assets.added} added, ${assets.skipped} skipped.`)
    console.log()
    startServer()
    break
  }

  case 'report': {
    const month = process.argv[3]
    console.log(`Generating report${month ? ` for ${month}` : ' for current month'}...`)
    const filePath = writeReport(month)
    console.log(`Report saved: ${filePath}`)
    break
  }

  case 'build-memory': {
    console.log('Building memory records from events...')
    const { total, created, updated } = buildMemories()
    console.log(`Done. ${total} memories (${created} created, ${updated} updated).`)
    break
  }

  case 'context': {
    console.log('Generating Remi context pack...')
    const { mdPath, jsonPath } = generateContext()
    console.log(`Context pack generated:`)
    console.log(`  ${mdPath}`)
    console.log(`  ${jsonPath}`)
    break
  }

  case 'search': {
    const keyword = process.argv.slice(3).join(' ')
    if (!keyword) {
      console.log('Usage: tsx src/cli.ts search <keyword>')
      process.exit(1)
    }
    console.log(`Searching: "${keyword}"`)
    console.log()
    const results = search(keyword)
    if (results.length === 0) {
      console.log('No results found.')
    } else {
      for (const r of results) {
        const typeLabel = r.eventType || r.type
        if (r.type === 'memory') {
          console.log(`  [${r.date}] [memory:${r.importance}] ${r.title}`)
          console.log(`    ${r.matchedText}`)
          console.log(`    memoryId: ${r.memoryId} | sourceEvent: ${r.sourceEventId}`)
        } else {
          console.log(`  [${r.date}] [${typeLabel}] ${r.title}`)
          console.log(`    ${r.matchedText}`)
          if (r.sourcePath) console.log(`    -> ${r.sourcePath}`)
        }
        console.log()
      }
      console.log(`${results.length} result(s) found.`)
    }
    break
  }

  case 'export': {
    console.log('Exporting family memory...')
    const dir = exportAll()
    console.log(`Export complete: ${dir}`)
    break
  }

  case 'doctor': {
    const results = runDoctor()
    printDoctorResults(results)
    break
  }

  case 'connector': {
    const subCmd = process.argv[3]
    if (subCmd === 'degradation') {
      await runDegradationDemo()
    } else {
      const url = process.argv[3]
      await runConnectorDemo(url || undefined)
    }
    break
  }

  case 'capture-demo': {
    await runCaptureDemo()
    break
  }

  case 'intake-assets': {
    console.log('Running asset intake...')
    const { intakeAssets } = await import('./intake.js')
    const { draftsCreated, skipped } = await intakeAssets()
    console.log(`Done. ${draftsCreated} draft(s) created, ${skipped} attachment(s) already drafted.`)
    break
  }

  case 'sync': {
    const ok = await runSync()
    if (!ok) process.exit(1)
    break
  }

  case 'extract-ocr': {
    console.log('Re-running OCR for pending drafts missing sidecars...')
    const { loadPendingDrafts, loadOcrResult, saveOcrSidecar } = await import('./drafts.js')
    const { loadAttachments } = await import('./attachments.js')
    const { extractOcrForAttachment } = await import('./ocr.js')
    const pending = loadPendingDrafts()
    const attachments = loadAttachments()
    const attachmentMap = new Map(attachments.map((a) => [a.attachmentId, a]))
    let extracted = 0
    let skippedOcr = 0
    for (const draft of pending) {
      for (const attId of draft.attachmentIds) {
        const existing = loadOcrResult(attId)
        if (existing) { skippedOcr++; continue }
        const att = attachmentMap.get(attId)
        if (!att) continue
        const r = await extractOcrForAttachment(att)
        saveOcrSidecar(r.result, r.text)
        extracted++
        console.log(`  [${r.result.status}] ${att.originalFilename}`)
      }
    }
    console.log(`Done. ${extracted} extracted, ${skippedOcr} already had sidecars.`)
    break
  }

  case 'enrich-draft': {
    const draftId = process.argv[3]
    if (!draftId) {
      console.error('Usage: tsx src/cli.ts enrich-draft <draftId>')
      process.exit(1)
    }
    const { enrichDraft } = await import('./draft_enrichment.js')
    const result = await enrichDraft(draftId)
    if (result.ok) {
      console.log(`Done. ${result.message}`)
    } else {
      console.warn(`Skipped: ${result.message}`)
      if (result.error === 'not_found') process.exit(1)
    }
    break
  }

  case 'enrich-drafts': {
    console.log('Enriching pending drafts with local VLM...')
    const { enrichPendingDrafts } = await import('./draft_enrichment.js')
    const stats = await enrichPendingDrafts()
    console.log(`Done. ${stats.enriched} enriched, ${stats.skipped} skipped, ${stats.failed} failed (${stats.total} total).`)
    break
  }

  case 'trial-report': {
    const { printTrialReport, computeDailyMetrics, recordDailyMetrics } = await import('./trial.js')
    printTrialReport()
    if (process.argv[3] === '--record') {
      const metrics = computeDailyMetrics()
      recordDailyMetrics(metrics)
      console.log(`  Day recorded to trial log.`)
    }
    break
  }

  case 'trial-record': {
    const { computeDailyMetrics, recordDailyMetrics } = await import('./trial.js')
    const metrics = computeDailyMetrics()
    const log = recordDailyMetrics(metrics)
    console.log(`Trial day ${metrics.date} recorded. (${log.days.length} total days)`)
    break
  }

  default:
    console.log(`Remi Family Memory CLI`)
    console.log()
    console.log(`Usage: tsx src/cli.ts <command>`)
    console.log()
    console.log('Commands:')
    console.log('  sync              Scan + build-memory + context + doctor (daily workflow)')
    console.log('  scan              Scan inbox (notes + assets)')
    console.log('  scan-assets       Scan assets inbox only')
    console.log('  intake-assets     Generate draft notes from unlinked attachments')
    console.log('  extract-ocr       Re-run OCR for pending drafts missing sidecars')
    console.log('  enrich-draft <id> Enrich a pending draft with local VLM (requires VLM_MODEL)')
    console.log('  enrich-drafts     Enrich all pending drafts with local VLM')
    console.log('  trial-report      Show today\'s trial metrics (--record to save)')
    console.log('  trial-record      Record today\'s metrics to trial log')
    console.log('  serve             Start the timeline web server')
    console.log('  dev               Scan + serve')
    console.log('  report [YYYY-MM]  Generate monthly report')
    console.log('  build-memory      Build AI memory records from events')
    console.log('  context           Generate Remi context pack')
    console.log('  search <keyword>  Search events, memories, reports, attachments')
    console.log('  export            Export full memory archive')
    console.log('  doctor            Run data health check')
    console.log('  connector         Run Remi Connector verification demo')
    console.log('  connector degradation  Test service-unavailable behavior')
    console.log('  capture-demo      Run v0.9 capture-to-inbox smoke test')
    process.exit(1)
}
