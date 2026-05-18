import express from 'express'
import path from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { listEvents } from './store.js'
import { loadProfile, getGestationalWeeks, getStage } from './profile.js'
import { loadAttachments } from './attachments.js'
import { loadMemories, buildMemories } from './memory.js'
import { generateContext } from './context.js'
import { search } from './search.js'
import { runDoctor } from './doctor.js'
import { SCHEMA_VERSION } from './types.js'

export function startServer(port = 3456) {
  const app = express()

  app.use(express.static(path.resolve('web')))

  // --- User-facing APIs (web dashboard — shows all data, user owns it) ---

  app.get('/api/profile', (_req, res) => {
    const profile = loadProfile()
    if (!profile) {
      res.status(404).json({ error: 'No profile found' })
      return
    }
    const weeks = getGestationalWeeks(profile)
    const stage = getStage(profile)
    const events = listEvents()
    const lastEvent = events.length > 0 ? events[events.length - 1] : null
    res.json({ profile, weeks, stage, totalEvents: events.length, lastEvent })
  })

  app.get('/api/events', (_req, res) => {
    const events = listEvents()
    res.json(events)
  })

  app.get('/api/stats', (_req, res) => {
    const events = listEvents()
    const byType: Record<string, number> = {}
    for (const e of events) {
      byType[e.type] = (byType[e.type] || 0) + 1
    }
    const attachments = loadAttachments()
    const unattached = attachments.filter((a) => !a.eventId)
    res.json({ total: events.length, byType, attachments: attachments.length, unattachedAssets: unattached.length })
  })

  app.get('/api/attachments', (_req, res) => {
    const attachments = loadAttachments()
    res.json(attachments)
  })

  // --- AI-facing APIs (Remi integration — blocked_from_ai filtered) ---

  app.get('/api/health', (_req, res) => {
    const results = runDoctor()
    const checks: Record<string, string> = {}
    const checkNameMap: Record<string, string> = {
      'Event store': 'events',
      'Baby profile': 'profile',
      'Memory records': 'memories',
      'Context pack': 'context',
      'Archive assets': 'archive',
    }
    for (const r of results) {
      const key = checkNameMap[r.name]
      if (key) checks[key] = r.status
    }
    const ok = results.every((r) => r.status !== 'FAIL')
    res.json({
      ok,
      schemaVersion: SCHEMA_VERSION,
      service: 'family-memory',
      checks,
      updatedAt: new Date().toISOString(),
    })
  })

  app.get('/api/memories', (_req, res) => {
    const memories = loadMemories()
    const importance = _req.query.importance as string | undefined
    const filtered = importance
      ? memories.filter((m) => m.importance === importance)
      : memories
    res.json({
      schemaVersion: SCHEMA_VERSION,
      total: filtered.length,
      memories: filtered,
    })
  })

  app.get('/api/context', (_req, res) => {
    const format = _req.query.format as string | undefined
    const contextJsonPath = path.resolve('data/context/remi-context.json')
    const contextMdPath = path.resolve('data/context/remi-context.md')

    if (format === 'markdown') {
      if (!existsSync(contextMdPath)) {
        res.status(404).json({ error: 'Context pack not generated. Run: npm run context' })
        return
      }
      const md = readFileSync(contextMdPath, 'utf-8')
      res.type('text/markdown').send(md)
      return
    }

    if (!existsSync(contextJsonPath)) {
      res.status(404).json({ error: 'Context pack not generated. Run: npm run context' })
      return
    }
    const json = JSON.parse(readFileSync(contextJsonPath, 'utf-8'))
    res.json(json)
  })

  app.get('/api/search', (_req, res) => {
    const q = (_req.query.q as string || '').trim()
    if (!q) {
      res.status(400).json({ error: 'Missing query parameter: q' })
      return
    }
    const allResults = search(q)
    const events = listEvents()
    const blockedEvents = events.filter((e) => e.sensitivity === 'blocked_from_ai')
    const blockedTitles = new Set(blockedEvents.map((e) => e.title))
    const blockedSummaries = new Set(
      blockedEvents.map((e) => e.summary).filter(Boolean)
    )
    const filtered = allResults.filter((r) => {
      if (blockedTitles.has(r.title)) return false
      if (r.type === 'report') {
        for (const title of blockedTitles) {
          if (r.matchedText.includes(title)) return false
        }
        for (const summary of blockedSummaries) {
          if (summary && r.matchedText.includes(summary.slice(0, 50))) return false
        }
      }
      return true
    })
    res.json({
      query: q,
      total: filtered.length,
      results: filtered,
    })
  })

  app.post('/api/rebuild', (_req, res) => {
    try {
      const memoryResult = buildMemories()
      const contextResult = generateContext()
      res.json({
        ok: true,
        memory: {
          total: memoryResult.total,
          created: memoryResult.created,
          updated: memoryResult.updated,
        },
        context: {
          mdPath: path.relative(path.resolve('.'), contextResult.mdPath),
          jsonPath: path.relative(path.resolve('.'), contextResult.jsonPath),
        },
        rebuiltAt: new Date().toISOString(),
      })
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) })
    }
  })

  app.listen(port, () => {
    console.log(`Remi Family Memory Service: http://localhost:${port}`)
    console.log()
    console.log('  Web:')
    console.log(`    Timeline:  http://localhost:${port}/`)
    console.log(`    Profile:   http://localhost:${port}/profile.html`)
    console.log()
    console.log('  API (Remi Integration):')
    console.log(`    Health:    GET /api/health`)
    console.log(`    Profile:   GET /api/profile`)
    console.log(`    Events:    GET /api/events`)
    console.log(`    Memories:  GET /api/memories`)
    console.log(`    Context:   GET /api/context`)
    console.log(`    Search:    GET /api/search?q=keyword`)
    console.log(`    Rebuild:   POST /api/rebuild`)
  })
}
