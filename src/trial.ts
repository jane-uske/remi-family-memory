import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { loadAttachments } from './attachments.js'
import { loadPendingDrafts, loadAllDrafts } from './drafts.js'
import { listEvents } from './store.js'
import { loadMemories } from './memory.js'

export interface DailyMetrics {
  date: string
  assetsImported: number
  draftsCreated: number
  draftsConfirmed: number
  draftsRejected: number
  draftsNeedingMajorEdit: number
  ocrFailures: number
  ocrErrors: string[]
  memoriesTotal: number
  pendingTotal: number
  confirmedToday: number
  unconfirmedLeakDetected: boolean
  notes: string
}

export interface TrialLog {
  startDate: string
  days: DailyMetrics[]
}

function trialDir(): string {
  return path.join(dataDir(), 'trial')
}

function trialLogPath(): string {
  return path.join(trialDir(), 'trial-log.json')
}

function ensureTrialDir(): void {
  const dir = trialDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadTrialLog(): TrialLog {
  ensureTrialDir()
  const file = trialLogPath()
  if (!existsSync(file)) {
    return { startDate: new Date().toISOString().slice(0, 10), days: [] }
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as TrialLog
}

function saveTrialLog(log: TrialLog): void {
  ensureTrialDir()
  writeFileSync(trialLogPath(), JSON.stringify(log, null, 2), 'utf-8')
}

export function computeDailyMetrics(date?: string): DailyMetrics {
  const today = date || new Date().toISOString().slice(0, 10)

  const attachments = loadAttachments()
  const allDrafts = loadAllDrafts()
  const pendingDrafts = loadPendingDrafts()
  const events = listEvents()
  const memories = loadMemories()

  const todayAttachments = attachments.filter(a => a.importedAt.startsWith(today))
  const todayDraftsCreated = allDrafts.filter(d => d.createdAt.startsWith(today))
  const todayConfirmed = allDrafts.filter(d =>
    d.status === 'confirmed' && d.confirmedAt && d.confirmedAt.startsWith(today)
  )
  const todayRejected = allDrafts.filter(d =>
    d.status === 'rejected' && d.createdAt.startsWith(today)
  )

  const ocrFailures = pendingDrafts.filter(d => d.ocrStatus === 'error' || d.ocrStatus === 'no_text')

  const confirmedEvents = events.filter(e => e.createdAt.startsWith(today) && e.confirmedByParent)

  return {
    date: today,
    assetsImported: todayAttachments.length,
    draftsCreated: todayDraftsCreated.length,
    draftsConfirmed: todayConfirmed.length,
    draftsRejected: todayRejected.length,
    draftsNeedingMajorEdit: 0,
    ocrFailures: ocrFailures.length,
    ocrErrors: ocrFailures.map(d => `${d.originalFilenames.join(',')}:${d.ocrStatus}`),
    memoriesTotal: memories.length,
    pendingTotal: pendingDrafts.length,
    confirmedToday: confirmedEvents.length,
    unconfirmedLeakDetected: false,
    notes: '',
  }
}

export function recordDailyMetrics(metrics: DailyMetrics): TrialLog {
  const log = loadTrialLog()
  const existing = log.days.findIndex(d => d.date === metrics.date)
  if (existing >= 0) {
    log.days[existing] = metrics
  } else {
    log.days.push(metrics)
    log.days.sort((a, b) => a.date.localeCompare(b.date))
  }
  saveTrialLog(log)
  return log
}

export function getTrialSummary(): {
  totalDays: number
  totalAssets: number
  totalDraftsCreated: number
  totalConfirmed: number
  totalRejected: number
  totalOcrFailures: number
  avgConfirmCost: string
  streakDays: number
  leakDetected: boolean
  commonOcrErrors: string[]
} {
  const log = loadTrialLog()
  const days = log.days

  if (days.length === 0) {
    return {
      totalDays: 0,
      totalAssets: 0,
      totalDraftsCreated: 0,
      totalConfirmed: 0,
      totalRejected: 0,
      totalOcrFailures: 0,
      avgConfirmCost: 'N/A',
      streakDays: 0,
      leakDetected: false,
      commonOcrErrors: [],
    }
  }

  const totalAssets = days.reduce((s, d) => s + d.assetsImported, 0)
  const totalDraftsCreated = days.reduce((s, d) => s + d.draftsCreated, 0)
  const totalConfirmed = days.reduce((s, d) => s + d.draftsConfirmed, 0)
  const totalRejected = days.reduce((s, d) => s + d.draftsRejected, 0)
  const totalOcrFailures = days.reduce((s, d) => s + d.ocrFailures, 0)
  const leakDetected = days.some(d => d.unconfirmedLeakDetected)

  const allOcrErrors = days.flatMap(d => d.ocrErrors)
  const errorCounts = new Map<string, number>()
  for (const e of allOcrErrors) {
    errorCounts.set(e, (errorCounts.get(e) || 0) + 1)
  }
  const commonOcrErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([err, count]) => `${err} (×${count})`)

  let streak = 0
  const today = new Date()
  for (let i = 0; i < 30; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    if (days.some(day => day.date === dateStr)) {
      streak++
    } else if (i > 0) {
      break
    }
  }

  const daysWithActivity = days.filter(d => d.draftsConfirmed > 0 || d.assetsImported > 0)
  const avgConfirmCost = totalConfirmed > 0
    ? `~${Math.round(totalConfirmed / Math.max(daysWithActivity.length, 1))} confirms/active-day`
    : 'N/A'

  return {
    totalDays: days.length,
    totalAssets,
    totalDraftsCreated,
    totalConfirmed,
    totalRejected,
    totalOcrFailures,
    avgConfirmCost,
    streakDays: streak,
    leakDetected,
    commonOcrErrors,
  }
}

export function printTrialReport(): void {
  const metrics = computeDailyMetrics()
  const summary = getTrialSummary()
  const log = loadTrialLog()

  console.log('═══════════════════════════════════════════')
  console.log('  Remi Family Memory — Trial Daily Report')
  console.log('═══════════════════════════════════════════')
  console.log()
  console.log(`  Today: ${metrics.date}`)
  console.log(`  Trial day: #${log.days.length + 1} (streak: ${summary.streakDays} days)`)
  console.log()
  console.log('  --- Today ---')
  console.log(`  Assets imported:    ${metrics.assetsImported}`)
  console.log(`  Drafts created:     ${metrics.draftsCreated}`)
  console.log(`  Drafts confirmed:   ${metrics.draftsConfirmed}`)
  console.log(`  Drafts rejected:    ${metrics.draftsRejected}`)
  console.log(`  OCR failures:       ${metrics.ocrFailures}`)
  console.log(`  Pending drafts:     ${metrics.pendingTotal}`)
  console.log(`  Memories total:     ${metrics.memoriesTotal}`)
  console.log()
  console.log('  --- Trial Summary ---')
  console.log(`  Total days logged:  ${summary.totalDays}`)
  console.log(`  Total assets:       ${summary.totalAssets}`)
  console.log(`  Total confirmed:    ${summary.totalConfirmed}`)
  console.log(`  Total OCR failures: ${summary.totalOcrFailures}`)
  console.log(`  Confirm rate:       ${summary.avgConfirmCost}`)
  console.log(`  Leak detected:      ${summary.leakDetected ? 'YES ⚠️' : 'No ✓'}`)
  console.log()

  if (summary.commonOcrErrors.length > 0) {
    console.log('  --- Common OCR Errors ---')
    for (const e of summary.commonOcrErrors) {
      console.log(`    ${e}`)
    }
    console.log()
  }

  console.log('═══════════════════════════════════════════')
}
