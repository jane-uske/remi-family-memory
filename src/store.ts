import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'
import type { BabyEvent } from './types.js'

function eventsFile() {
  return path.join(dataDir(), 'events', 'events.json')
}

function ensureFile() {
  const file = eventsFile()
  const dir = path.dirname(file)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(file)) {
    writeFileSync(file, '[]', 'utf-8')
  }
}

export function loadEvents(): BabyEvent[] {
  ensureFile()
  const raw = readFileSync(eventsFile(), 'utf-8')
  return JSON.parse(raw) as BabyEvent[]
}

export function saveEvent(event: BabyEvent): void {
  const events = loadEvents()
  events.push(event)
  writeFileSync(eventsFile(), JSON.stringify(events, null, 2), 'utf-8')
}

export function listEvents(): BabyEvent[] {
  return loadEvents().sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  )
}

export function hasSourcePath(sourcePath: string): boolean {
  return loadEvents().some((e) => e.source.path === sourcePath)
}

export function listAISafeEvents(): BabyEvent[] {
  return listEvents().filter(
    (e) => e.sensitivity !== 'blocked_from_ai' && e.confirmedByParent === true
  )
}

export function listOwnerVisibleEvents(): BabyEvent[] {
  return listEvents().filter((e) => e.sensitivity !== 'blocked_from_ai')
}
