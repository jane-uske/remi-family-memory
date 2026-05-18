import { CloudAdapter } from './adapters/cloud.js'
import { DeterministicAdapter } from './adapters/deterministic.js'
import type { LLMInput, LLMOutput, PayloadAudit } from './adapters/types.js'
import type { CloudConfig } from './adapters/cloud.js'

const SMOKE_QUESTIONS: { question: string; category: 'answerable' | 'unanswerable' | 'partial'; evidence: LLMInput['evidence'] }[] = [
  {
    question: '宝宝第一次胎动是什么时候？',
    category: 'answerable',
    evidence: {
      query: '胎动',
      items: [{
        source: 'memory',
        memoryId: 'mem-fetal-001',
        sourceEventId: 'evt-fetal-001',
        date: '2026-05-10',
        title: '第一次感受到胎动',
        snippet: '妈妈第一次明显感受到胎动，像是小鱼在肚子里游动。约16周+2天。',
        importance: 'core',
      }],
      fromContext: true,
      fromSearch: false,
      collectedAt: new Date().toISOString(),
    },
  },
  {
    question: '最近一次孕检是什么？',
    category: 'answerable',
    evidence: {
      query: '孕检',
      items: [{
        source: 'memory',
        memoryId: 'mem-checkup-001',
        sourceEventId: 'evt-checkup-001',
        date: '2026-05-15',
        title: '16周常规孕检',
        snippet: 'NT检查通过，各项指标正常。胎心率152次/分。体重增加1.5kg。',
        importance: 'high',
      }],
      fromContext: false,
      fromSearch: true,
      collectedAt: new Date().toISOString(),
    },
  },
  {
    question: '现在有哪些核心记忆？',
    category: 'answerable',
    evidence: {
      query: '核心记忆',
      items: [
        {
          source: 'context',
          memoryId: 'mem-fetal-001',
          date: '2026-05-10',
          title: '第一次感受到胎动',
          snippet: '妈妈第一次明显感受到胎动',
          importance: 'core',
        },
        {
          source: 'context',
          memoryId: 'mem-pregnancy-001',
          date: '2026-02-08',
          title: '确认怀孕',
          snippet: '验孕棒两条线，确认怀孕。预产期2026-11-15。',
          importance: 'core',
        },
      ],
      fromContext: true,
      fromSearch: false,
      collectedAt: new Date().toISOString(),
    },
  },
  {
    question: '宝宝第一次说话是什么时候？',
    category: 'unanswerable',
    evidence: {
      query: '说话',
      items: [],
      fromContext: false,
      fromSearch: true,
      collectedAt: new Date().toISOString(),
    },
  },
  {
    question: '宝宝喜欢什么颜色？',
    category: 'unanswerable',
    evidence: {
      query: '颜色',
      items: [],
      fromContext: false,
      fromSearch: true,
      collectedAt: new Date().toISOString(),
    },
  },
  {
    question: '宝宝最近身体状态怎么样？',
    category: 'partial',
    evidence: {
      query: '身体',
      items: [{
        source: 'memory',
        memoryId: 'mem-checkup-001',
        sourceEventId: 'evt-checkup-001',
        date: '2026-05-15',
        title: '16周常规孕检',
        snippet: 'NT检查通过，各项指标正常。',
        importance: 'high',
      }],
      fromContext: false,
      fromSearch: true,
      collectedAt: new Date().toISOString(),
    },
  },
]

type SmokeResult = {
  question: string
  category: string
  answerable: boolean
  confidence: string
  reason: string
  answer: string
  sourceRefs: LLMOutput['sourceRefs']
  validatorPassed: boolean
  validatorNote: string
  fallback: boolean
  audit: PayloadAudit
}

async function runSmoke() {
  const provider = process.env.FAMILY_MEMORY_LLM_PROVIDER
  const apiKey = process.env.FAMILY_MEMORY_LLM_API_KEY
  const model = process.env.FAMILY_MEMORY_LLM_MODEL
  const baseUrl = process.env.FAMILY_MEMORY_LLM_BASE_URL

  if (!provider || !apiKey || !model) {
    console.log('═══════════════════════════════════════════════════════')
    console.log('  LLM Smoke Test — SKIPPED (not configured)')
    console.log('═══════════════════════════════════════════════════════')
    console.log('')
    console.log('  Required environment variables:')
    console.log('    FAMILY_MEMORY_LLM_PROVIDER  (e.g., openai)')
    console.log('    FAMILY_MEMORY_LLM_API_KEY   (your API key)')
    console.log('    FAMILY_MEMORY_LLM_MODEL     (e.g., gpt-4o-mini)')
    console.log('')
    console.log('  Optional:')
    console.log('    FAMILY_MEMORY_LLM_BASE_URL  (custom endpoint)')
    console.log('')
    console.log('  Example:')
    console.log('    FAMILY_MEMORY_LLM_PROVIDER=openai \\')
    console.log('    FAMILY_MEMORY_LLM_API_KEY=sk-... \\')
    console.log('    FAMILY_MEMORY_LLM_MODEL=gpt-4o-mini \\')
    console.log('    npm run llm:smoke')
    console.log('')
    console.log('  Exiting safely (0). No tests failed.')
    process.exit(0)
  }

  const config: CloudConfig = { provider, apiKey, model, baseUrl }
  const adapter = new CloudAdapter(config)

  console.log('═══════════════════════════════════════════════════════')
  console.log('  LLM Smoke Test — RUNNING')
  console.log(`  Provider: ${provider}`)
  console.log(`  Model: ${model}`)
  console.log(`  Base URL: ${baseUrl || '(default)'}`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')

  const results: SmokeResult[] = []
  let passed = 0
  let failed = 0

  for (const q of SMOKE_QUESTIONS) {
    const input: LLMInput = {
      question: q.question,
      evidence: q.evidence,
      promptContract: 'grounded_answer_v1',
    }

    const audit = adapter.auditPayload(input)
    let output: LLMOutput
    let fallback = false
    let validatorPassed = true
    let validatorNote = 'OK'

    if (!audit.safe) {
      output = await new DeterministicAdapter().generate(input)
      fallback = true
      validatorNote = `BLOCKED by audit: ${audit.risks.join(', ')}`
      validatorPassed = false
    } else {
      output = await adapter.generate(input)

      if (output.reason === 'validation_failed_no_sources' || output.reason === 'validation_failed_phantom_sources') {
        validatorPassed = false
        validatorNote = `Validator rejected: ${output.reason}`
      }

      // Detect fallback: if cloud was supposed to call LLM but we got deterministic-style answer
      // (heuristic: check if adapter internally fell back)
      if (output.answerable && output.answer.startsWith('根据家庭记忆记录') && q.evidence.items.length > 0) {
        fallback = true
        validatorNote = 'Appears to be deterministic fallback'
      }
    }

    // Evaluate correctness
    let correct = true
    let issue = ''

    if (q.category === 'answerable') {
      if (!output.answerable) {
        correct = false
        issue = 'Expected answerable=true but got false'
      } else if (output.sourceRefs.length === 0) {
        correct = false
        issue = 'answerable=true but no sourceRefs'
      } else {
        const validSourceIds = q.evidence.items.map((i) => i.memoryId).filter(Boolean)
        const phantoms = output.sourceRefs.filter((r) => r.memoryId && !validSourceIds.includes(r.memoryId))
        if (phantoms.length > 0) {
          correct = false
          issue = `Phantom sources: ${phantoms.map((p) => p.memoryId).join(', ')}`
        }
      }
    } else if (q.category === 'unanswerable') {
      if (output.answerable) {
        correct = false
        issue = 'Expected answerable=false but LLM answered (fabrication!)'
      }
    } else if (q.category === 'partial') {
      if (output.answerable && output.confidence === 'high') {
        correct = false
        issue = 'Partial evidence but LLM claimed high confidence (extrapolation!)'
      }
    }

    if (correct) passed++
    else failed++

    const result: SmokeResult = {
      question: q.question,
      category: q.category,
      answerable: output.answerable,
      confidence: output.confidence,
      reason: output.reason,
      answer: output.answer,
      sourceRefs: output.sourceRefs,
      validatorPassed,
      validatorNote,
      fallback,
      audit,
    }
    results.push(result)

    const status = correct ? '✓ PASS' : '✗ FAIL'
    console.log(`─── ${status}: ${q.question}`)
    console.log(`    Category: ${q.category}`)
    console.log(`    Answerable: ${output.answerable}`)
    console.log(`    Confidence: ${output.confidence}`)
    console.log(`    Reason: ${output.reason}`)
    console.log(`    Answer: ${output.answer.slice(0, 100)}${output.answer.length > 100 ? '...' : ''}`)
    console.log(`    Sources: ${output.sourceRefs.length > 0 ? output.sourceRefs.map((s) => s.memoryId || s.sourceEventId || '?').join(', ') : '(none)'}`)
    console.log(`    Validator: ${validatorNote}`)
    console.log(`    Fallback: ${fallback}`)
    console.log(`    Audit: ${audit.safe ? 'SAFE' : 'UNSAFE'} | ${audit.evidenceItemCount} items | ${audit.byteSize}B`)
    if (!correct) console.log(`    ISSUE: ${issue}`)
    console.log('')
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${results.length} total`)
  console.log('═══════════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n  ⚠ Some tests failed. Review LLM output above.')
    process.exit(1)
  } else {
    console.log('\n  All smoke tests passed.')
    process.exit(0)
  }
}

runSmoke().catch((e) => {
  console.error(`Smoke test crashed: ${e instanceof Error ? e.message : e}`)
  process.exit(2)
})
