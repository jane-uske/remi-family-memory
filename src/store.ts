import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { BabyEvent } from './types.js'

const DATA_DIR = path.resolve('data')
const EVENTS_FILE = path.join(DATA_DIR, 'events', 'events.json')

function ensureFile() {
  const dir = path.dirname(EVENTS_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(EVENTS_FILE)) {
    writeFileSync(EVENTS_FILE, '[]', 'utf-8')
  }
}

export function loadEvents(): BabyEvent[] {
  ensureFile()
  const raw = readFileSync(EVENTS_FILE, 'utf-8')
  return JSON.parse(raw) as BabyEvent[]
}

export function saveEvent(event: BabyEvent): void {
  const events = loadEvents()
  events.push(event)
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8')
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
  return listEvents().filter((e) => e.sensitivity !== 'blocked_from_ai')
}
