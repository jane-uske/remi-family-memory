import { RemiConnector } from './connector.js'
import { CloudAdapter } from './adapters/cloud.js'
import type { LLMInput } from './adapters/types.js'
import type { CloudConfig } from './adapters/cloud.js'
import type { GroundedAnswer } from './connector.js'

const E2E_QUESTIONS = [
  '宝宝第一次胎动是什么时候？',
  '最近一次孕检是什么？',
  '现在有哪些核心记忆？',
  '宝宝第一次说话是什么时候？',
  '宝宝最近身体状态怎么样？',
]

type E2EResult = {
  question: string
  answerable: boolean
  confidence: string
  reason: string
  answer: string
  sources: GroundedAnswer['sources']
  evidenceItemCount: number
  fromContext: boolean
  fromSearch: boolean
  validatorStatus: string
  resultSource: string
  auditStatus: string
}

async function runE2E() {
  const provider = process.env.FAMILY_MEMORY_LLM_PROVIDER
  const apiKey = process.env.FAMILY_MEMORY_LLM_API_KEY
  const model = process.env.FAMILY_MEMORY_LLM_MODEL
  const baseUrl = process.env.FAMILY_MEMORY_LLM_BASE_URL
  const serviceUrl = process.env.FAMILY_MEMORY_SERVICE_URL || 'http://localhost:3456'
  const serviceToken = process.env.FAMILY_MEMORY_AI_TOKEN

  if (!provider || !apiKey || !model) {
    console.log('═══════════════════════════════════════════════════════')
    console.log('  LLM E2E Test — SKIPPED (not configured)')
    console.log('═══════════════════════════════════════════════════════')
    console.log('')
    console.log('  Required environment variables:')
    console.log('    FAMILY_MEMORY_LLM_PROVIDER   (e.g., openai)')
    console.log('    FAMILY_MEMORY_LLM_API_KEY    (your API key)')
    console.log('    FAMILY_MEMORY_LLM_MODEL      (e.g., gpt-4o-mini)')
    console.log('')
    console.log('  Optional:')
    console.log('    FAMILY_MEMORY_LLM_BASE_URL   (custom LLM endpoint)')
    console.log('    FAMILY_MEMORY_SERVICE_URL    (default: http://localhost:3456)')
    console.log('    FAMILY_MEMORY_AI_TOKEN       (service auth token)')
    console.log('')
    console.log('  Also requires family-memory service running:')
    console.log('    npm run serve')
    console.log('')
    console.log('  Exiting safely (0).')
    process.exit(0)
  }

  // Override adapter env vars so connector picks up cloud config
  process.env.FAMILY_MEMORY_LLM_PROVIDER = provider
  process.env.FAMILY_MEMORY_LLM_API_KEY = apiKey
  process.env.FAMILY_MEMORY_LLM_MODEL = model
  if (baseUrl) process.env.FAMILY_MEMORY_LLM_BASE_URL = baseUrl

  console.log('═══════════════════════════════════════════════════════')
  console.log('  LLM E2E Test — RUNNING (real service + real LLM)')
  console.log(`  Service: ${serviceUrl}`)
  console.log(`  Provider: ${provider}`)
  console.log(`  Model: ${model}`)
  console.log(`  Base URL: ${baseUrl || '(default)'}`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')

  // Connect to real service
  const connector = new RemiConnector(serviceUrl, serviceToken || null)
  const connectResult = await connector.connect()

  if (!connectResult.ok) {
    console.log(`  ERROR: Cannot connect to service at ${serviceUrl}`)
    console.log(`  ${connectResult.error}`)
    console.log('')
    console.log('  Make sure the service is running: npm run serve')
    console.log('  Or set FAMILY_MEMORY_SERVICE_URL to correct address.')
    process.exit(1)
  }

  console.log('  Service connected. Loading context...')
  const ctxResult = await connector.loadContext()
  if (ctxResult.ok && ctxResult.context) {
    console.log(`  Context loaded: ${ctxResult.context.coreMemories?.length || 0} core, ${ctxResult.context.highMemories?.length || 0} high memories`)
  } else {
    console.log(`  Warning: Context load failed — ${ctxResult.error}`)
  }
  console.log('')

  // Create cloud adapter for audit checks
  const cloudConfig: CloudConfig = { provider, apiKey, model, baseUrl }
  const cloudAdapter = new CloudAdapter(cloudConfig)

  const results: E2EResult[] = []

  for (const question of E2E_QUESTIONS) {
    console.log(`─── Question: ${question}`)

    // Use connector.answer() which goes through the full chain:
    // collectEvidence (context + search) → toAdapterEvidence → adapter.generate
    const answer = await connector.answer(question)

    // Audit the evidence that would be sent
    const adapterInput: LLMInput = {
      question,
      evidence: {
        query: answer.evidence.query,
        items: answer.evidence.items
          .filter((i) => i.source !== 'report')
          .map((i) => ({
            source: i.source === 'report' ? 'search' as const : i.source as 'memory' | 'event' | 'context' | 'search',
            memoryId: i.memoryId,
            sourceEventId: i.sourceEventId,
            date: i.date,
            title: i.title,
            snippet: i.snippet,
            importance: i.importance,
          })),
        fromContext: answer.evidence.fromContext,
        fromSearch: answer.evidence.fromSearch,
        collectedAt: answer.evidence.collectedAt,
      },
      promptContract: 'grounded_answer_v1',
    }
    const audit = cloudAdapter.auditPayload(adapterInput)

    // Validator status
    let validatorStatus = 'OK'
    if (answer.reason === 'validation_failed_no_sources') validatorStatus = 'REJECTED: no sources'
    else if (answer.reason === 'validation_failed_phantom_sources') validatorStatus = 'REJECTED: phantom sources'
    else if (answer.reason === 'validation_failed_missing_sources_for_used_evidence') validatorStatus = 'REJECTED: missing sources for used evidence'

    const resultSource = answer.resultSource || (connector.getAdapterType() === 'deterministic' ? 'deterministic' : 'unknown')

    const result: E2EResult = {
      question,
      answerable: answer.answerable,
      confidence: answer.confidence,
      reason: answer.reason,
      answer: answer.answer,
      sources: answer.sources,
      evidenceItemCount: answer.evidence.items.length,
      fromContext: answer.evidence.fromContext,
      fromSearch: answer.evidence.fromSearch,
      validatorStatus,
      resultSource,
      auditStatus: audit.safe ? 'SAFE' : `UNSAFE [${audit.risks.join('; ')}]`,
    }
    results.push(result)

    console.log(`    Answerable: ${answer.answerable}`)
    console.log(`    Confidence: ${answer.confidence}`)
    console.log(`    Reason: ${answer.reason}`)
    console.log(`    Answer: ${answer.answer.slice(0, 120)}${answer.answer.length > 120 ? '...' : ''}`)
    console.log(`    Sources: ${answer.sources.length > 0 ? answer.sources.map((s) => s.memoryId || s.title || '?').join(', ') : '(none)'}`)
    console.log(`    Evidence: ${answer.evidence.items.length} items (context=${answer.evidence.fromContext}, search=${answer.evidence.fromSearch})`)
    console.log(`    Validator: ${validatorStatus}`)
    console.log(`    Result source: ${resultSource}`)
    console.log(`    Audit: ${audit.safe ? 'SAFE' : 'UNSAFE'}`)
    console.log('')
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log(`  E2E COMPLETE: ${results.length} questions tested`)
  console.log(`  Adapter: ${connector.getAdapterType()}`)
  console.log(`  Service: ${connector.getStatus()}`)
  console.log('═══════════════════════════════════════════════════════')

  // Summary checks
  const issues: string[] = []
  for (const r of results) {
    if (r.auditStatus !== 'SAFE') issues.push(`${r.question}: unsafe audit`)
    if (r.answerable && r.sources.length === 0) issues.push(`${r.question}: answerable but no sources`)
    if (r.reason === 'no_evidence' && r.evidenceItemCount > 0) issues.push(`${r.question}: has evidence but claimed no_evidence`)
  }

  if (issues.length > 0) {
    console.log('\n  ISSUES:')
    for (const i of issues) console.log(`    - ${i}`)
    process.exit(1)
  }

  process.exit(0)
}

runE2E().catch((e) => {
  console.error(`E2E test crashed: ${e instanceof Error ? e.message : e}`)
  process.exit(2)
})
