import { RemiMemoryAdapter, isFamilyMemoryQuestion, loadConfig } from './remi-adapter.js'
import type { RemiMemoryResponse } from './remi-adapter.js'

const SMOKE_QUESTIONS = [
  '宝宝第一次胎动是什么时候？',
  '最近一次孕检是什么？',
  '宝宝第一次说话是什么时候？',
  '宝宝最近身体状态怎么样？',
  '现在有哪些核心记忆？',
  '今天天气怎么样？',
]

async function runRemiSmoke() {
  const config = loadConfig()

  console.log('═══════════════════════════════════════════════════════')
  console.log('  v0.8: Remi Integration Smoke')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Enabled: ${config.enabled}`)
  console.log(`  Service URL: ${config.serviceUrl}`)
  console.log(`  Token: ${config.token ? '***' : '(none)'}`)
  console.log('')

  if (!config.enabled) {
    console.log('  FAMILY_MEMORY_ENABLED is not true. Skipping.')
    console.log('')
    console.log('  To run:')
    console.log('    FAMILY_MEMORY_ENABLED=true \\')
    console.log('    FAMILY_MEMORY_SERVICE_URL=http://localhost:3456 \\')
    console.log('    FAMILY_MEMORY_AI_TOKEN=your-token \\')
    console.log('    npm run remi:smoke')
    console.log('')
    console.log('  Also requires family-memory service: npm run serve')
    console.log('')
    console.log('  Exiting safely (0).')
    process.exit(0)
  }

  const adapter = new RemiMemoryAdapter(config)

  console.log('  Classifier check:')
  for (const q of SMOKE_QUESTIONS) {
    const isFamily = isFamilyMemoryQuestion(q)
    console.log(`    ${isFamily ? '✓' : '✗'} ${q}`)
  }
  console.log('')

  console.log('  Connecting to family-memory service...')
  const connected = await adapter.ensureConnected()
  if (!connected) {
    console.log('  ERROR: Cannot connect to family-memory service.')
    console.log('  Make sure the service is running: npm run serve')
    process.exit(1)
  }
  console.log('  Connected.')
  console.log('')

  const results: RemiMemoryResponse[] = []

  for (const question of SMOKE_QUESTIONS) {
    console.log(`─── ${question}`)
    const result = await adapter.handleQuestion(question)
    results.push(result)

    console.log(`    Handled: ${result.handled}`)
    console.log(`    Answerable: ${result.answerable}`)
    console.log(`    Confidence: ${result.confidence}`)
    console.log(`    Reason: ${result.reason}`)
    console.log(`    Answer: ${result.answer.slice(0, 120)}${result.answer.length > 120 ? '...' : ''}`)
    console.log(`    Sources: ${result.sources.length > 0 ? result.sources.map((s) => s.memoryId || s.title || '?').join(', ') : '(none)'}`)
    console.log(`    Service: ${result.serviceStatus}`)
    console.log(`    Result source: ${result.resultSource || 'n/a'}`)
    console.log('')
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('═══════════════════════════════════════════════════════')

  const handled = results.filter((r) => r.handled)
  const answered = results.filter((r) => r.answerable)
  const refused = handled.filter((r) => !r.answerable)
  const skipped = results.filter((r) => !r.handled)
  const withSources = answered.filter((r) => r.sources.length > 0)

  console.log(`  Total questions: ${results.length}`)
  console.log(`  Handled (family): ${handled.length}`)
  console.log(`  Answered: ${answered.length}`)
  console.log(`  Refused (no evidence): ${refused.length}`)
  console.log(`  Skipped (not family): ${skipped.length}`)
  console.log(`  With sources: ${withSources.length}/${answered.length}`)
  console.log('')

  const issues: string[] = []
  for (const r of results) {
    if (r.handled && r.answerable && r.sources.length === 0) {
      issues.push(`${r.question}: answerable but no sources`)
    }
  }

  if (issues.length > 0) {
    console.log('  ISSUES:')
    for (const i of issues) console.log(`    - ${i}`)
    process.exit(1)
  }

  console.log('  All checks passed.')
  process.exit(0)
}

runRemiSmoke().catch((e) => {
  console.error(`Remi smoke crashed: ${e instanceof Error ? e.message : e}`)
  process.exit(2)
})
