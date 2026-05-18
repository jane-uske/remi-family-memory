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
import { EVENT_TYPE_LABELS } from './types.js'
import { runConnectorDemo, runDegradationDemo } from './connector-demo.js'

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

  default:
    console.log(`Remi Family Memory CLI`)
    console.log()
    console.log(`Usage: tsx src/cli.ts <command>`)
    console.log()
    console.log('Commands:')
    console.log('  scan              Scan inbox (notes + assets)')
    console.log('  scan-assets       Scan assets inbox only')
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
    process.exit(1)
}
