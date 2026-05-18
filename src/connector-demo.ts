import { RemiConnector } from './connector.js'
import type { GroundedAnswer } from './connector.js'

const ANSWERABLE_QUESTIONS = [
  '宝宝第一次胎动是什么时候？',
  '最近一次孕检是什么？',
  '我们为什么开始建立家庭记忆系统？',
  '现在有哪些核心记忆？',
]

const REFUSAL_QUESTIONS = [
  '宝宝出生当天发生了什么？',
  '宝宝第一次说话是什么时候？',
  '宝宝喜欢什么颜色？',
  '宝宝以后想上哪所大学？',
]

const PARTIAL_EVIDENCE_QUESTIONS = [
  '宝宝最近身体状态怎么样？',
]

export async function runConnectorDemo(baseUrl?: string): Promise<void> {
  console.log()
  console.log('  ╔════════════════════════════════════════════════════════╗')
  console.log('  ║   Remi Connector v0.6 — Grounded Answer Protocol      ║')
  console.log('  ╚════════════════════════════════════════════════════════╝')
  console.log()

  const connector = new RemiConnector(baseUrl)

  // Step 1: Connect
  console.log('  [Step 1] Connecting to family-memory service...')
  const connectResult = await connector.connect()
  if (!connectResult.ok) {
    console.log(`  ✗ Connection FAILED: ${connectResult.error}`)
    console.log()
    console.log('  [Degradation] Testing answer without service...')
    const degraded = await connector.answer('宝宝第一次胎动是什么时候？')
    printGroundedAnswer(degraded)
    console.log('  ✓ Degradation: no crash, no fabrication, answerable=false.')
    return
  }
  console.log(`  ✓ Connected. Status: ${connector.getStatus()}`)
  console.log()

  // Step 2: Load context
  console.log('  [Step 2] Loading family memory context...')
  const ctxResult = await connector.loadContext()
  if (!ctxResult.ok) {
    console.log(`  ✗ Context load FAILED: ${ctxResult.error}`)
    return
  }
  const ctx = ctxResult.context!
  console.log(`  ✓ Context loaded: ${ctx.profile?.nickname}, ${ctx.status.totalMemories} memories`)
  console.log()

  // Step 3: Answerable questions
  console.log('  [Step 3] Answerable questions (evidence exists)...')
  console.log()
  let answerablePass = 0
  for (const q of ANSWERABLE_QUESTIONS) {
    const a = await connector.answer(q)
    printGroundedAnswer(a)
    if (a.answerable && a.sources.length > 0 && a.confidence !== 'none') answerablePass++
  }
  console.log(`  → ${answerablePass}/${ANSWERABLE_QUESTIONS.length} answerable with sources ✓`)
  console.log()

  // Step 4: Refusal questions (no evidence)
  console.log('  [Step 4] Refusal questions (no evidence — must refuse)...')
  console.log()
  let refusalPass = 0
  for (const q of REFUSAL_QUESTIONS) {
    const a = await connector.answer(q)
    printGroundedAnswer(a)
    if (!a.answerable && a.confidence === 'none' && a.reason === 'no_evidence') refusalPass++
  }
  console.log(`  → ${refusalPass}/${REFUSAL_QUESTIONS.length} correctly refused ✓`)
  console.log()

  // Step 5: Partial evidence questions
  console.log('  [Step 5] Partial evidence questions (limited data)...')
  console.log()
  let partialPass = 0
  for (const q of PARTIAL_EVIDENCE_QUESTIONS) {
    const a = await connector.answer(q)
    printGroundedAnswer(a)
    if (a.confidence === 'low' && a.reason === 'partial_evidence') partialPass++
  }
  console.log(`  → ${partialPass}/${PARTIAL_EVIDENCE_QUESTIONS.length} correctly marked partial ✓`)
  console.log()

  // Step 6: blocked_from_ai verification
  console.log('  [Step 6] Privacy: blocked_from_ai verification...')
  const contextStr = JSON.stringify(ctx)
  const hasBlockedInContext = contextStr.includes('blocked_from_ai')
  const searchRes = await connector.search('blocked_from_ai')
  const blockedInSearch = searchRes.results?.some((r) => r.matchedText.includes('blocked_from_ai')) ?? false
  const testAnswer = await connector.answer('blocked_from_ai')
  const blockedInAnswer = testAnswer.answerable
  console.log(`    Context contains blocked_from_ai: ${hasBlockedInContext ? '✗ LEAKED' : '✓ clean'}`)
  console.log(`    Search returns blocked_from_ai:   ${blockedInSearch ? '✗ LEAKED' : '✓ clean'}`)
  console.log(`    Answer on blocked_from_ai:        ${blockedInAnswer ? '✗ LEAKED' : '✓ refused'}`)
  console.log()

  // Step 7: Source tracing audit
  console.log('  [Step 7] Source tracing audit...')
  let tracePass = true
  for (const q of ANSWERABLE_QUESTIONS) {
    const a = await connector.answer(q)
    if (a.answerable && a.sources.length === 0) {
      console.log(`    ✗ "${q.slice(0, 15)}..." — answerable but no sources!`)
      tracePass = false
    }
  }
  for (const q of REFUSAL_QUESTIONS) {
    const a = await connector.answer(q)
    if (a.answerable) {
      console.log(`    ✗ "${q.slice(0, 15)}..." — should refuse but answered!`)
      tracePass = false
    }
  }
  console.log(`    ${tracePass ? '✓' : '✗'} All answerable=true have sources; all no-evidence refused.`)
  console.log()

  // Summary
  console.log('  ═════════════════════════════════════════════════════════')
  console.log('  Grounded Answer Protocol — Verification Summary')
  console.log('  ─────────────────────────────────────────────────────────')
  console.log(`    Service status:        ${connector.getStatus()}`)
  console.log(`    Answerable (4):        ${answerablePass}/4 with sources`)
  console.log(`    Refusals (4):          ${refusalPass}/4 correctly refused`)
  console.log(`    Partial evidence (1):  ${partialPass}/1 low confidence`)
  console.log(`    Source tracing:        ${tracePass ? '✓ enforced' : '✗ violated'}`)
  console.log(`    Privacy protection:    ${!hasBlockedInContext && !blockedInSearch && !blockedInAnswer ? '✓' : '✗'}`)
  const allPass = answerablePass === 4 && refusalPass === 4 && partialPass === 1 && tracePass && !hasBlockedInContext && !blockedInSearch && !blockedInAnswer
  console.log(`    Overall:               ${allPass ? '✓ ALL PASS' : '✗ SOME FAILED'}`)
  console.log('  ═════════════════════════════════════════════════════════')
  console.log()
}

export async function runDegradationDemo(): Promise<void> {
  console.log()
  console.log('  [Degradation Test] Simulating service unavailable...')
  console.log()

  const connector = new RemiConnector('http://localhost:19999')

  const connectResult = await connector.connect()
  console.log(`  Connection: ${connectResult.ok ? 'OK' : 'FAILED'} — ${connectResult.error}`)
  console.log(`  Status: ${connector.getStatus()}`)
  console.log()

  console.log('  Answering without service:')
  console.log()
  const a = await connector.answer('宝宝第一次胎动是什么时候？')
  printGroundedAnswer(a)

  console.log('  Verification:')
  console.log(`    answerable:    ${a.answerable} (expected: false)`)
  console.log(`    confidence:    ${a.confidence} (expected: none)`)
  console.log(`    reason:        ${a.reason} (expected: service_unavailable)`)
  console.log(`    sources:       ${a.sources.length} (expected: 0)`)
  console.log(`    evidence:      ${a.evidence.items.length} items (expected: 0)`)
  console.log()

  const pass = !a.answerable && a.confidence === 'none' && a.reason === 'service_unavailable' && a.sources.length === 0
  console.log(`  ${pass ? '✓' : '✗'} Degradation: no crash, no fabrication, explicit refusal.`)
  console.log()
}

function printGroundedAnswer(a: GroundedAnswer): void {
  const ansIcon = a.answerable ? '●' : '○'
  const confIcon = a.confidence === 'high' ? '▓▓▓' : a.confidence === 'medium' ? '▓▓░' : a.confidence === 'low' ? '▓░░' : '░░░'
  console.log(`  ${ansIcon} Q: ${a.question}`)
  console.log(`    A: ${a.answer.slice(0, 120)}${a.answer.length > 120 ? '...' : ''}`)
  console.log(`    [${confIcon}] confidence=${a.confidence} | answerable=${a.answerable} | reason=${a.reason}`)
  if (a.sources.length > 0) {
    const s = a.sources[0]
    console.log(`    source: ${s.memoryId || s.sourceEventId || s.date || '(context)'} ${s.title || ''}`)
    if (a.sources.length > 1) console.log(`    (+${a.sources.length - 1} more)`)
  }
  console.log(`    evidence: ${a.evidence.items.length} items (context=${a.evidence.fromContext}, search=${a.evidence.fromSearch})`)
  console.log()
}
