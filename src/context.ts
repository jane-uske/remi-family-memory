import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import { listEvents, listAISafeEvents } from './store.js'
import { loadProfile, getGestationalWeeks, getStage } from './profile.js'
import { loadAttachments } from './attachments.js'
import { loadMemories } from './memory.js'
import { SCHEMA_VERSION, EVENT_TYPE_LABELS } from './types.js'

function contextDir() { return path.join(dataDir(), 'context') }

function ensureDir() {
  const dir = contextDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function generateContext(): { mdPath: string; jsonPath: string } {
  ensureDir()

  const profile = loadProfile()
  const events = listAISafeEvents()
  const allEvents = listEvents()
  const memories = loadMemories()
  const attachments = loadAttachments()

  const weeks = profile ? getGestationalWeeks(profile) : null
  const stage = profile ? getStage(profile) : '未知'

  const coreMemories = memories.filter((m) => m.importance === 'core')
  const highMemories = memories.filter((m) => m.importance === 'high')
  const recentEvents = events.slice(-5)
  const parentNotes = events.filter((e) => e.type === 'parent_note').slice(-3)
  const unattached = attachments.filter((a) => !a.eventId)

  // Generate Markdown
  let md = `# Remi Family Memory Context\n\n`
  md += `> Schema: ${SCHEMA_VERSION} | Generated: ${new Date().toISOString().slice(0, 19)}\n\n`

  md += `## Baby Profile\n\n`
  if (profile) {
    md += `- 昵称：${profile.familyName || ''}${profile.nickname}\n`
    md += `- 预产期：${profile.expectedBirthDate}\n`
    md += `- 当前阶段：${stage}\n`
    if (weeks !== null) md += `- 当前孕周：第 ${weeks} 周\n`
    if (profile.parents.length > 0) {
      md += `- 家庭成员：${profile.parents.map((p) => `${p.nickname || p.name}(${p.role})`).join('、')}\n`
    }
  } else {
    md += `(No profile configured)\n`
  }
  md += `\n`

  md += `## System Status\n\n`
  md += `- 事件总数：${events.length}\n`
  md += `- 记忆记录：${memories.length}\n`
  md += `- 附件数量：${attachments.length}\n`
  md += `- 未关联附件：${unattached.length}\n`
  md += `\n`

  md += `## Core Memories\n\n`
  if (coreMemories.length > 0) {
    for (const m of coreMemories) {
      md += `- **${m.date}**：${m.title}\n`
      md += `  ${m.summary}\n`
    }
  } else {
    md += `(暂无核心记忆)\n`
  }
  md += `\n`

  md += `## High Importance Memories\n\n`
  if (highMemories.length > 0) {
    for (const m of highMemories) {
      md += `- **${m.date}** [${EVENT_TYPE_LABELS[m.type] || m.type}]：${m.title}\n`
    }
  } else {
    md += `(暂无高重要性记忆)\n`
  }
  md += `\n`

  md += `## Recent Events\n\n`
  if (recentEvents.length > 0) {
    for (const e of recentEvents) {
      md += `- ${e.occurredAt.slice(0, 10)} [${EVENT_TYPE_LABELS[e.type] || e.type}] ${e.title}\n`
    }
  } else {
    md += `(暂无事件)\n`
  }
  md += `\n`

  if (parentNotes.length > 0) {
    md += `## Recent Parent Notes\n\n`
    for (const e of parentNotes) {
      md += `### ${e.title} (${e.occurredAt.slice(0, 10)})\n\n`
      if (e.summary) md += `${e.summary.slice(0, 300)}\n\n`
    }
  }

  if (attachments.length > 0) {
    md += `## Attachments Summary\n\n`
    const byType: Record<string, number> = {}
    for (const a of attachments) { byType[a.type] = (byType[a.type] || 0) + 1 }
    for (const [type, count] of Object.entries(byType)) {
      md += `- ${type}: ${count} files\n`
    }
    md += `\n`
  }

  md += `## How Remi Should Use This\n\n`
  md += `Remi 可以把这些信息作为家庭长期记忆，用于：\n\n`
  md += `- 回答宝宝成长、孕检、家庭记录相关问题\n`
  md += `- 生成阶段总结和成长报告\n`
  md += `- 提醒即将到来的孕检或里程碑\n`
  md += `- 在对话中自然引用家庭事件和情感记录\n`
  md += `- 尊重 sensitivity 标记，不对外暴露 medical / blocked_from_ai 内容\n`

  // Generate JSON
  const contextJson = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    profile: profile ? {
      nickname: `${profile.familyName || ''}${profile.nickname}`,
      expectedBirthDate: profile.expectedBirthDate,
      stage,
      gestationalWeeks: weeks,
      parents: profile.parents,
    } : null,
    status: {
      totalEvents: events.length,
      totalMemories: memories.length,
      totalAttachments: attachments.length,
      unattachedAssets: unattached.length,
    },
    coreMemories: coreMemories.map((m) => ({
      memoryId: m.memoryId,
      date: m.date,
      title: m.title,
      summary: m.summary,
      facts: m.facts,
      people: m.people,
      tags: m.tags,
    })),
    highMemories: highMemories.map((m) => ({
      memoryId: m.memoryId,
      date: m.date,
      type: m.type,
      title: m.title,
      summary: m.summary,
    })),
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      date: e.occurredAt.slice(0, 10),
      type: e.type,
      title: e.title,
    })),
    recentParentNotes: parentNotes.map((e) => ({
      date: e.occurredAt.slice(0, 10),
      title: e.title,
      summary: e.summary?.slice(0, 300),
    })),
  }

  const mdPath = path.join(contextDir(), 'remi-context.md')
  const jsonPath = path.join(contextDir(), 'remi-context.json')

  writeFileSync(mdPath, md, 'utf-8')
  writeFileSync(jsonPath, JSON.stringify(contextJson, null, 2), 'utf-8')

  return { mdPath, jsonPath }
}
