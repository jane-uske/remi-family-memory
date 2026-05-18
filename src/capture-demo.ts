import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectRecordIntent, detectPrivacyBlock, writeInboxNote } from './capture.js'
import { scanInbox } from './scanner.js'
import { loadEvents } from './store.js'

export async function runCaptureDemo(): Promise<void> {
  console.log('═══════════════════════════════════════════════════')
  console.log(' v0.9 Capture-to-Inbox Loop — Smoke Test')
  console.log('═══════════════════════════════════════════════════')
  console.log()

  let pass = 0
  let fail = 0

  function check(label: string, condition: boolean) {
    if (condition) {
      pass++
      console.log(`  ✓ ${label}`)
    } else {
      fail++
      console.log(`  ✗ ${label}`)
    }
  }

  // --- Step 1: Intent Detection ---

  console.log('Step 1: Record Intent Detection')
  console.log()

  const intentPositive = [
    '帮我记一下，今天宝宝第一次翻身了',
    '记录一下今天的检查结果',
    '记一下这件事',
    '帮忙记下来',
    '把今天的事记录一下',
  ]
  const intentNegative = [
    '今天天气怎么样？',
    '宝宝什么时候会走路？',
    '宝宝今天好可爱啊',
    '最近一次孕检情况如何？',
  ]

  for (const text of intentPositive) {
    check(`intent=true: "${text.slice(0, 20)}..."`, detectRecordIntent(text))
  }
  for (const text of intentNegative) {
    check(`intent=false: "${text.slice(0, 20)}..."`, !detectRecordIntent(text))
  }
  console.log()

  // --- Step 2: Privacy Detection ---

  console.log('Step 2: Privacy Block Detection')
  console.log()

  const privacyPositive = [
    '这个不要给AI看',
    '私密内容，帮我记一下',
    '只给我看的内容',
    '别让Remi以后说出来',
    'blocked_from_ai',
    '不让AI知道这件事',
  ]
  const privacyNegative = [
    '今天宝宝第一次翻身了',
    '孕检结果一切正常',
    '我们全家去公园了',
  ]

  for (const text of privacyPositive) {
    check(`privacy=true: "${text.slice(0, 20)}..."`, detectPrivacyBlock(text))
  }
  for (const text of privacyNegative) {
    check(`privacy=false: "${text.slice(0, 20)}..."`, !detectPrivacyBlock(text))
  }
  console.log()

  // --- Step 3: Privacy Block Rejection ---

  console.log('Step 3: Privacy Block Rejection (writeInboxNote)')
  console.log()

  const tempDir = mkdtempSync(path.join(tmpdir(), 'remi-capture-demo-'))
  const origDataDir = process.env.REMI_DATA_DIR
  process.env.REMI_DATA_DIR = tempDir

  try {
    const privacyResult = writeInboxNote({
      text: '私密内容，不要给AI看，帮我记下',
      confirmedByParent: true,
      source: 'remi',
    })
    check('privacy text rejected', !privacyResult.ok)
    if (!privacyResult.ok) {
      check('error = privacy_blocked', privacyResult.error === 'privacy_blocked')
    }
    console.log()

    // --- Step 4: Successful Write ---

    console.log('Step 4: Successful Write')
    console.log()

    const writeResult = writeInboxNote({
      text: '今天宝宝第一次翻身了！好开心！',
      date: '2026-05-18',
      confirmedByParent: true,
      source: 'remi',
    })

    check('write ok=true', writeResult.ok === true)
    if (writeResult.ok) {
      const absPath = path.resolve(writeResult.filePath)
      check('file exists', existsSync(absPath))
      const content = readFileSync(absPath, 'utf-8')
      check('contains source: remi', content.includes('source: remi'))
      check('contains confirmedByParent: true', content.includes('confirmedByParent: true'))
      check('contains reviewStatus: captured', content.includes('reviewStatus: captured'))
      check('contains user text', content.includes('今天宝宝第一次翻身了'))
      check('filename starts with date', path.basename(absPath).startsWith('2026-05-18-remi-'))
      console.log(`    → ${writeResult.filePath}`)
    }
    console.log()

    // --- Step 5: Scanner Processes Remi Note ---

    console.log('Step 5: Scanner Processes Remi Note')
    console.log()

    const scanResult = scanInbox()
    check('scan added=1', scanResult.added === 1)

    const events = loadEvents()
    const remiEvent = events.find((e) => e.source.externalId === 'remi')
    check('event found with externalId=remi', !!remiEvent)

    if (remiEvent) {
      check('source.kind = manual', remiEvent.source.kind === 'manual')
      check('confirmedByParent = true', remiEvent.confirmedByParent === true)
      check('type = parent_note', remiEvent.type === 'parent_note')
      check('sensitivity = normal', remiEvent.sensitivity === 'normal')
      check('summary contains original text', !!remiEvent.summary?.includes('今天宝宝第一次翻身了'))
    }

    const processedDir = path.join(tempDir, 'processed/notes')
    const processedFiles = existsSync(processedDir)
      ? readdirSync(processedDir)
      : []
    check('file moved to processed/', processedFiles.length === 1)
    console.log()

    // --- Step 6: Non-intent Text (no trigger) ---

    console.log('Step 6: Non-intent Text Detection')
    console.log()

    check('"宝宝今天好可爱啊" → no intent', !detectRecordIntent('宝宝今天好可爱啊'))
    check('"天气真好" → no intent', !detectRecordIntent('天气真好'))
    console.log()

  } finally {
    process.env.REMI_DATA_DIR = origDataDir
    rmSync(tempDir, { recursive: true, force: true })
  }

  // --- Summary ---

  console.log('═══════════════════════════════════════════════════')
  if (fail === 0) {
    console.log(` ALL PASS (${pass}/${pass + fail})`)
  } else {
    console.log(` FAILED: ${fail}/${pass + fail} checks failed`)
  }
  console.log('═══════════════════════════════════════════════════')

  if (fail > 0) process.exit(1)
}
