import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { listAISafeEvents } from './store.js'
import { loadAttachments } from './attachments.js'
import { loadMemories } from './memory.js'
import { EVENT_TYPE_LABELS } from './types.js'
import type { SearchResult } from './types.js'

const REPORTS_DIR = path.resolve('data/reports')

export function search(keyword: string): SearchResult[] {
  const results: SearchResult[] = []
  const kw = keyword.toLowerCase()

  const events = listAISafeEvents()
  for (const e of events) {
    const searchable = [e.title, e.summary || '', e.tags.join(' '), e.people.join(' ')].join(' ')
    if (searchable.toLowerCase().includes(kw)) {
      results.push({
        type: 'event',
        date: e.occurredAt.slice(0, 10),
        eventType: EVENT_TYPE_LABELS[e.type] || e.type,
        title: e.title,
        matchedText: extractContext(searchable, kw),
        sourcePath: e.source.path,
      })
    }
  }

  const memories = loadMemories()
  for (const m of memories) {
    const searchable = [m.title, m.summary, m.facts.join(' '), m.tags.join(' '), m.people.join(' ')].join(' ')
    if (searchable.toLowerCase().includes(kw)) {
      results.push({
        type: 'memory',
        date: m.date,
        eventType: EVENT_TYPE_LABELS[m.type] || m.type,
        title: m.title,
        matchedText: extractContext(searchable, kw),
        importance: m.importance,
        memoryId: m.memoryId,
        sourceEventId: m.sourceEventId,
      })
    }
  }

  if (existsSync(REPORTS_DIR)) {
    const reports = readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.md'))
    for (const file of reports) {
      const filePath = path.join(REPORTS_DIR, file)
      const content = readFileSync(filePath, 'utf-8')
      if (content.toLowerCase().includes(kw)) {
        results.push({
          type: 'report',
          date: file.replace('.md', ''),
          title: `月报 ${file.replace('.md', '')}`,
          matchedText: extractContext(content, kw),
          sourcePath: path.relative(path.resolve('.'), filePath),
        })
      }
    }
  }

  const attachments = loadAttachments()
  for (const a of attachments) {
    const searchable = [a.originalFilename, a.description || ''].join(' ')
    if (searchable.toLowerCase().includes(kw)) {
      results.push({
        type: 'attachment',
        date: a.createdAt.slice(0, 10),
        title: a.originalFilename,
        matchedText: a.description || a.originalFilename,
        sourcePath: a.storedPath,
      })
    }
  }

  return results
}

export function aiSearch(keyword: string): SearchResult[] {
  const results: SearchResult[] = []
  const kw = keyword.toLowerCase()

  const events = listAISafeEvents()
  for (const e of events) {
    const searchable = [e.title, e.summary || '', e.tags.join(' '), e.people.join(' ')].join(' ')
    if (searchable.toLowerCase().includes(kw)) {
      results.push({
        type: 'event',
        date: e.occurredAt.slice(0, 10),
        eventType: EVENT_TYPE_LABELS[e.type] || e.type,
        title: e.title,
        matchedText: extractContext(searchable, kw),
        sourcePath: e.source.path,
      })
    }
  }

  const memories = loadMemories()
  for (const m of memories) {
    const searchable = [m.title, m.summary, m.facts.join(' '), m.tags.join(' '), m.people.join(' ')].join(' ')
    if (searchable.toLowerCase().includes(kw)) {
      results.push({
        type: 'memory',
        date: m.date,
        eventType: EVENT_TYPE_LABELS[m.type] || m.type,
        title: m.title,
        matchedText: extractContext(searchable, kw),
        importance: m.importance,
        memoryId: m.memoryId,
        sourceEventId: m.sourceEventId,
      })
    }
  }

  return results
}

function extractContext(text: string, keyword: string, windowSize = 60): string {
  const lower = text.toLowerCase()
  const idx = lower.indexOf(keyword)
  if (idx === -1) return text.slice(0, windowSize)

  const start = Math.max(0, idx - 20)
  const end = Math.min(text.length, idx + keyword.length + windowSize - 20)
  let snippet = text.slice(start, end).replace(/\n/g, ' ').trim()
  if (start > 0) snippet = '...' + snippet
  if (end < text.length) snippet = snippet + '...'
  return snippet
}
