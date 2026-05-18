import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { listAISafeEvents } from './store.js'
import { loadProfile, getGestationalWeeks, getStage } from './profile.js'
import { EVENT_TYPE_LABELS } from './types.js'
import type { BabyEvent } from './types.js'

function reportsDir() { return path.join(dataDir(), 'reports') }

export function generateReport(yearMonth?: string): string {
  const now = new Date()
  const targetMonth = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [year, month] = targetMonth.split('-').map(Number)

  const allEvents = listAISafeEvents()
  const monthEvents = allEvents.filter((e) => {
    const d = new Date(e.occurredAt)
    return d.getFullYear() === year && d.getMonth() + 1 === month
  })

  const profile = loadProfile()

  const milestones = monthEvents.filter((e) => e.type === 'milestone')
  const checkups = monthEvents.filter((e) => e.type === 'pregnancy_checkup')
  const parentNotes = monthEvents.filter((e) => e.type === 'parent_note')
  const fetalMovements = monthEvents.filter((e) => e.type === 'fetal_movement')
  const otherEvents = monthEvents.filter(
    (e) => !['milestone', 'pregnancy_checkup', 'parent_note', 'fetal_movement'].includes(e.type),
  )

  let md = `# ${targetMonth} 宝宝成长记录\n\n`

  if (profile) {
    const stage = getStage(profile)
    const reportDate = new Date(year, month - 1, 28)
    const weeks = getGestationalWeeks(profile, reportDate)
    md += `> ${profile.familyName || ''}${profile.nickname} | ${stage}`
    if (weeks !== null) md += ` | 孕周：第 ${weeks} 周`
    md += `\n\n`
  }

  md += `---\n\n`
  md += `## 本月概览\n\n`
  md += `这个月记录了 **${monthEvents.length}** 个家庭事件。\n\n`

  if (monthEvents.length > 0) {
    const byType: Record<string, number> = {}
    for (const e of monthEvents) {
      byType[e.type] = (byType[e.type] || 0) + 1
    }
    md += `| 类型 | 数量 |\n| --- | --- |\n`
    for (const [type, count] of Object.entries(byType)) {
      md += `| ${EVENT_TYPE_LABELS[type as keyof typeof EVENT_TYPE_LABELS] || type} | ${count} |\n`
    }
    md += `\n`
  }

  if (milestones.length > 0) {
    md += `## 关键里程碑\n\n`
    for (const e of milestones) {
      md += `- **${formatDate(e.occurredAt)}** ${e.title}\n`
      if (e.summary) md += `  ${e.summary.split('\n')[0]}\n`
    }
    md += `\n`
  }

  if (checkups.length > 0) {
    md += `## 孕检记录\n\n`
    for (const e of checkups) {
      md += `- **${formatDate(e.occurredAt)}** ${e.title}\n`
      if (e.summary) md += `  ${e.summary.split('\n')[0]}\n`
    }
    md += `\n`
  }

  if (fetalMovements.length > 0) {
    md += `## 胎动记录\n\n`
    for (const e of fetalMovements) {
      md += `- **${formatDate(e.occurredAt)}** ${e.title}\n`
      if (e.summary) md += `  ${e.summary.split('\n')[0]}\n`
    }
    md += `\n`
  }

  if (parentNotes.length > 0) {
    md += `## 父母手记\n\n`
    for (const e of parentNotes) {
      md += `### ${e.title}\n\n`
      md += `_${formatDate(e.occurredAt)}_\n\n`
      if (e.summary) md += `${e.summary}\n\n`
    }
  }

  if (otherEvents.length > 0) {
    md += `## 其他记录\n\n`
    for (const e of otherEvents) {
      md += `- **${formatDate(e.occurredAt)}** [${EVENT_TYPE_LABELS[e.type as keyof typeof EVENT_TYPE_LABELS] || e.type}] ${e.title}\n`
    }
    md += `\n`
  }

  md += `---\n\n`
  md += `## 系统小结\n\n`

  const summaryParts: string[] = []
  if (monthEvents.length > 0) {
    const titles = monthEvents.map((e) => e.title)
    if (titles.length <= 3) {
      summaryParts.push(`本月记录了${titles.join('、')}。`)
    } else {
      summaryParts.push(`本月记录了 ${monthEvents.length} 个事件，包括${titles.slice(0, 3).join('、')}等。`)
    }
  }
  if (milestones.length > 0) {
    summaryParts.push(`达成了 ${milestones.length} 个里程碑。`)
  }
  if (checkups.length > 0) {
    summaryParts.push(`完成了 ${checkups.length} 次孕检。`)
  }
  if (summaryParts.length === 0) {
    summaryParts.push('本月暂无记录。')
  }
  md += summaryParts.join('') + '\n\n'
  md += `_报告生成时间：${now.toISOString().slice(0, 19).replace('T', ' ')}_\n`

  return md
}

export function writeReport(yearMonth?: string): string {
  const now = new Date()
  const targetMonth = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const dir = reportsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const md = generateReport(targetMonth)
  const filePath = path.join(dir, `${targetMonth}.md`)
  writeFileSync(filePath, md, 'utf-8')
  return filePath
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
