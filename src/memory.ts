import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { dataDir } from './paths.js'
import { listEvents } from './store.js'
import { loadProfile, getGestationalWeeks, getStage } from './profile.js'
import { loadAttachments } from './attachments.js'
import { SCHEMA_VERSION } from './types.js'
import type { BabyEvent, BabyEventType, MemoryImportance, MemoryRecord, MemoryProvenance } from './types.js'

function memoryDir() { return path.join(dataDir(), 'memory') }
function memoriesFile() { return path.join(memoryDir(), 'memories.json') }

const IMPORTANCE_MAP: Record<BabyEventType, MemoryImportance> = {
  fetal_movement: 'core',
  milestone: 'core',
  birth: 'core',
  pregnancy_checkup: 'high',
  medical_record: 'high',
  vaccine: 'high',
  parent_note: 'medium',
  photo_memory: 'medium',
  voice_memory: 'medium',
  family_event: 'medium',
  growth_metric: 'medium',
  video: 'medium',
  system_event: 'low',
}

function ensureDir() {
  const dir = memoryDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadMemories(): MemoryRecord[] {
  ensureDir()
  const file = memoriesFile()
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf-8')
  return JSON.parse(raw) as MemoryRecord[]
}

function saveMemories(memories: MemoryRecord[]): void {
  ensureDir()
  writeFileSync(memoriesFile(), JSON.stringify(memories, null, 2), 'utf-8')
}

function buildFacts(event: BabyEvent): string[] {
  const facts: string[] = []
  const profile = loadProfile()

  if (profile) {
    facts.push(`宝宝昵称：${profile.familyName || ''}${profile.nickname}，预产期 ${profile.expectedBirthDate}`)
  }

  facts.push(`${event.occurredAt.slice(0, 10)} 记录了「${event.title}」`)
  facts.push(`事件类型：${event.type}`)

  if (event.people.length > 0) {
    facts.push(`相关人员：${event.people.join('、')}`)
  }

  if (event.tags.length > 0) {
    facts.push(`标签：${event.tags.join('、')}`)
  }

  if (event.facts && event.facts.length > 0) {
    facts.push(...event.facts)
  }

  return facts
}

function buildSummary(event: BabyEvent): string {
  const profile = loadProfile()
  const weeks = profile ? getGestationalWeeks(profile, new Date(event.occurredAt)) : null
  const stage = profile ? getStage(profile) : '未知'

  let summary = event.summary || event.title

  if (summary.length > 200) {
    summary = summary.slice(0, 200) + '...'
  }

  if (event.type === 'milestone' || event.type === 'fetal_movement') {
    const weekInfo = weeks !== null ? `孕期第 ${weeks} 周左右` : '孕期'
    summary = `${weekInfo}，${summary}`
  }

  return summary
}

function eventToMemory(event: BabyEvent): MemoryRecord {
  const now = new Date().toISOString()

  let provenance: MemoryProvenance | undefined
  if (event.provenance) {
    provenance = {
      sourceType: event.provenance.sourceType,
      confidence: 'confirmed_by_parent',
      draftId: event.provenance.draftId,
      originalFilenames: event.provenance.originalFilenames,
      ocrAssisted: event.provenance.ocrUsed,
      vlmAssisted: event.provenance.vlmUsed,
      vlmModel: event.provenance.vlmModel,
      confirmedAt: event.provenance.confirmedAt,
    }
  }

  return {
    memoryId: nanoid(),
    sourceEventId: event.id,
    schemaVersion: SCHEMA_VERSION,
    date: event.occurredAt.slice(0, 10),
    type: event.type,
    importance: IMPORTANCE_MAP[event.type] || 'medium',
    subjectIds: [event.childId],
    people: event.people,
    title: event.title,
    summary: buildSummary(event),
    facts: buildFacts(event),
    tags: event.tags,
    attachmentIds: event.attachmentIds,
    sourceRefs: [{
      eventId: event.id,
      path: event.source.path,
    }],
    provenance,
    createdAt: now,
    updatedAt: now,
  }
}

export function buildMemories(): { total: number; created: number; updated: number } {
  const events = listEvents()
  const existing = loadMemories()
  const existingByEventId = new Map(existing.map((m) => [m.sourceEventId, m]))

  const memories: MemoryRecord[] = []
  let created = 0
  let updated = 0

  for (const event of events) {
    if (event.sensitivity === 'blocked_from_ai') continue
    if (event.confirmedByParent !== true) continue

    const prev = existingByEventId.get(event.id)
    if (prev) {
      const rebuilt = eventToMemory(event)
      rebuilt.memoryId = prev.memoryId
      rebuilt.createdAt = prev.createdAt
      memories.push(rebuilt)
      updated++
    } else {
      memories.push(eventToMemory(event))
      created++
    }
  }

  saveMemories(memories)
  return { total: memories.length, created, updated }
}
