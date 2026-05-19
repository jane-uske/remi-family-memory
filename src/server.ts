import express from 'express'
import path from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { dataDir } from './paths.js'
import { listEvents, listAISafeEvents } from './store.js'
import { loadProfile, getGestationalWeeks, getStage } from './profile.js'
import { loadAttachments, scanAssets } from './attachments.js'
import { loadMemories, buildMemories } from './memory.js'
import { generateContext } from './context.js'
import { aiSearch } from './search.js'
import { runDoctor } from './doctor.js'
import { scanInbox } from './scanner.js'
import { SCHEMA_VERSION } from './types.js'
import { RemiMemoryAdapter } from './remi-adapter.js'
import { writeInboxNote, writeParentCapture, checkStageGuardrail, getCurrentStage } from './capture.js'
import { loadPendingDrafts, confirmDraft, rejectDraft } from './drafts.js'
import { enrichDraft, enrichPendingDrafts } from './draft_enrichment.js'
import { intakeAssets } from './intake.js'
import { computeDailyMetrics, recordDailyMetrics, getTrialSummary, loadTrialLog } from './trial.js'
import { DraftCapability } from './draft-capability.js'
import type { DraftSessionState } from './draft-capability.js'
import type { Request, Response, NextFunction } from 'express'

function getToken(): string | null {
  return process.env.FAMILY_MEMORY_TOKEN || null
}

function aiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = getToken()

  if (!token) {
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or malformed Authorization header. Use: Bearer <token>',
    })
    return
  }

  const provided = authHeader.slice(7)
  if (provided !== token) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Invalid token.',
    })
    return
  }

  next()
}

export function startServer(port = 3456) {
  const app = express()

  app.use(express.json())
  app.use(express.static(path.resolve('web')))

  // ============================================================
  // Owner-facing APIs — full data access for web dashboard
  // These endpoints return ALL events including blocked_from_ai.
  // They are NOT safe for AI/LLM consumption.
  // ============================================================

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

  app.get('/api/memories', (_req, res) => {
    const memories = loadMemories()
    res.json({ total: memories.length, memories })
  })

  app.get('/api/dashboard', (_req, res) => {
    const drafts = loadPendingDrafts()
    const memories = loadMemories()
    const today = new Date().toISOString().slice(0, 10)

    const pendingCount = drafts.length
    const needsTitleCount = drafts.filter(d => !d.inferredTitle).length
    const ocrErrorCount = drafts.filter(d => d.ocrStatus === 'error').length
    const enrichedCount = drafts.filter(d => d.extractedFacts && d.extractedFacts.length > 0).length
    const confirmedTodayCount = memories.filter(m => m.createdAt && m.createdAt.startsWith(today)).length

    res.json({
      today,
      pending: {
        total: pendingCount,
        needsTitle: needsTitleCount,
        ocrError: ocrErrorCount,
        enriched: enrichedCount,
        readyToConfirm: drafts.filter(d => d.inferredTitle && d.inferredDate).length,
      },
      confirmed: {
        total: memories.length,
        today: confirmedTodayCount,
      },
    })
  })

  app.post('/api/capture', (req, res) => {
    const { text, date } = req.body || {}

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ ok: false, error: 'missing_text', message: '请输入记录内容。' })
      return
    }

    const result = writeParentCapture({ text: text.trim(), date: typeof date === 'string' ? date : undefined })
    if (!result.ok) {
      const status = result.error === 'stage_guardrail' ? 409 : 400
      res.status(status).json(result)
      return
    }
    res.json(result)
  })

  app.post('/api/sync', async (_req, res) => {
    try {
      const notes = scanInbox()
      const assets = scanAssets()
      const intake = await intakeAssets()
      const memResult = buildMemories()
      generateContext()
      const doctorResults = runDoctor()
      const fails = doctorResults.filter(r => r.status === 'FAIL')

      res.json({
        ok: true,
        scan: { notesAdded: notes.added, assetsAdded: assets.added },
        intake: { draftsCreated: intake.draftsCreated, skipped: intake.skipped },
        memory: { total: memResult.total, created: memResult.created, updated: memResult.updated },
        health: { pass: doctorResults.length - fails.length, fail: fails.length },
        syncedAt: new Date().toISOString(),
      })
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) })
    }
  })

  app.get('/api/drafts/pending', (_req, res) => {
    const drafts = loadPendingDrafts()
    res.json({ total: drafts.length, drafts })
  })

  app.post('/api/drafts/:draftId/confirm', (req, res) => {
    const { draftId } = req.params
    const { title, date, type, summary, tags } = req.body || {}
    const overrides: Record<string, unknown> = {}
    if (title) overrides.title = title
    if (date) overrides.date = date
    if (type) overrides.type = type
    if (summary) overrides.summary = summary
    if (tags) overrides.tags = tags

    const result = confirmDraft(draftId, Object.keys(overrides).length > 0 ? overrides as any : undefined)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400
      res.status(status).json(result)
      return
    }
    res.json(result)
  })

  app.post('/api/drafts/:draftId/reject', (req, res) => {
    const { draftId } = req.params
    const result = rejectDraft(draftId)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400
      res.status(status).json(result)
      return
    }
    res.json(result)
  })

  app.get('/api/trial', (_req, res) => {
    const metrics = computeDailyMetrics()
    const summary = getTrialSummary()
    const log = loadTrialLog()
    res.json({ today: metrics, summary, totalDaysLogged: log.days.length })
  })

  app.post('/api/trial/record', (_req, res) => {
    const metrics = computeDailyMetrics()
    const log = recordDailyMetrics(metrics)
    res.json({ ok: true, date: metrics.date, totalDays: log.days.length })
  })

  // ============================================================
  // AI-facing APIs — filtered, token-protected
  // These endpoints NEVER return blocked_from_ai content.
  // RemiConnector MUST use only these endpoints.
  // Protected by FAMILY_MEMORY_TOKEN when configured.
  // ============================================================

  app.use('/api/ai', aiAuthMiddleware)

  app.get('/api/ai/health', (_req, res) => {
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

  app.get('/api/ai/memories', (_req, res) => {
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

  app.get('/api/ai/context', (_req, res) => {
    const format = _req.query.format as string | undefined
    const contextJsonPath = path.join(dataDir(), 'context/remi-context.json')
    const contextMdPath = path.join(dataDir(), 'context/remi-context.md')

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

  app.get('/api/ai/search', (_req, res) => {
    const q = (_req.query.q as string || '').trim()
    if (!q) {
      res.status(400).json({ error: 'Missing query parameter: q' })
      return
    }
    const results = aiSearch(q)
    res.json({
      query: q,
      total: results.length,
      results,
    })
  })

  app.post('/api/ai/rebuild', (_req, res) => {
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

  app.get('/api/ai/stage', (_req, res) => {
    const stage = getCurrentStage()
    res.json({ stage })
  })

  app.post('/api/ai/capture', (req, res) => {
    const { text, date, confirmedByParent, source } = req.body || {}

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ ok: false, error: 'missing_text', message: '缺少必填字段: text' })
      return
    }
    if (confirmedByParent !== true) {
      res.status(400).json({ ok: false, error: 'not_confirmed', message: '必须在用户确认后才能写入记录。' })
      return
    }
    if (source !== 'remi') {
      res.status(400).json({ ok: false, error: 'invalid_source', message: 'source 字段必须为 "remi"。' })
      return
    }

    const result = writeInboxNote({
      text: text.trim(),
      date: typeof date === 'string' ? date : undefined,
      confirmedByParent: true,
      source: 'remi',
    })

    if (!result.ok) {
      res.status(400).json(result)
      return
    }

    res.json(result)
  })

  app.get('/api/ai/drafts/pending', (_req, res) => {
    const drafts = loadPendingDrafts()
    res.json({ total: drafts.length, drafts })
  })

  app.post('/api/ai/drafts/:draftId/confirm', (req, res) => {
    const { draftId } = req.params
    const { title, date, type, summary, tags } = req.body || {}
    const overrides: Record<string, unknown> = {}
    if (title) overrides.title = title
    if (date) overrides.date = date
    if (type) overrides.type = type
    if (summary) overrides.summary = summary
    if (tags) overrides.tags = tags

    const result = confirmDraft(draftId, Object.keys(overrides).length > 0 ? overrides as any : undefined)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400
      res.status(status).json(result)
      return
    }
    res.json(result)
  })

  app.post('/api/ai/drafts/:draftId/reject', (req, res) => {
    const { draftId } = req.params
    const result = rejectDraft(draftId)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400
      res.status(status).json(result)
      return
    }
    res.json(result)
  })

  app.post('/api/ai/drafts/:draftId/enrich', async (req, res) => {
    const { draftId } = req.params
    try {
      const result = await enrichDraft(draftId)
      if (!result.ok) {
        const status = result.error === 'not_found' ? 404
          : result.error === 'no_vlm_config' ? 503
          : 400
        res.status(status).json(result)
        return
      }
      res.json(result)
    } catch (e) {
      res.status(500).json({ ok: false, error: 'internal', message: `Enrich failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  })

  app.post('/api/ai/drafts/enrich-all', async (_req, res) => {
    try {
      const stats = await enrichPendingDrafts()
      res.json(stats)
    } catch (e) {
      res.status(500).json({ ok: false, error: 'internal', message: `Enrich failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  })

  app.post('/api/ai/drafts/chat', (req, res) => {
    const { input, sessionState } = req.body || {}
    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'Missing required field: input (string)' })
      return
    }

    const cap = new DraftCapability()
    if (sessionState) {
      cap.setState(sessionState as DraftSessionState)
    }

    const result = cap.handle(input)
    res.json({
      ...result,
      sessionState: cap.getState(),
    })
  })

  const askAdapter = new RemiMemoryAdapter({
    enabled: true,
    serviceUrl: `http://localhost:${port}`,
    token: null,
  })

  app.post('/api/ai/ask', async (req, res) => {
    const { question } = req.body || {}
    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Missing required field: question (string)' })
      return
    }

    try {
      if (!askAdapter.isEnabled()) {
        res.status(503).json({ error: 'Adapter not enabled' })
        return
      }
      await askAdapter.ensureConnected()
      const result = await askAdapter.handleQuestion(question)
      res.json(result)
    } catch (e) {
      res.status(500).json({ error: `Ask failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  })

  const server = app.listen(port, () => {
    const tokenSet = !!getToken()
    console.log(`Remi Family Memory Service: http://localhost:${port}`)
    console.log()
    console.log('  Web (owner-facing):')
    console.log(`    Timeline:    http://localhost:${port}/`)
    console.log(`    Review:      http://localhost:${port}/review.html`)
    console.log(`    Profile:     http://localhost:${port}/profile.html`)
    console.log()
    console.log(`  AI API (token: ${tokenSet ? 'required' : 'open (set FAMILY_MEMORY_TOKEN to protect)'}):`)
    console.log(`    Health:      GET  /api/ai/health`)
    console.log(`    Context:     GET  /api/ai/context`)
    console.log(`    Stage:       GET  /api/ai/stage`)
    console.log(`    Memories:    GET  /api/ai/memories`)
    console.log(`    Search:      GET  /api/ai/search?q=keyword`)
    console.log(`    Ask:         POST /api/ai/ask`)
    console.log(`    Capture:     POST /api/ai/capture`)
    console.log(`    Drafts:      GET  /api/ai/drafts/pending`)
    console.log(`    Confirm:     POST /api/ai/drafts/:id/confirm`)
    console.log(`    Reject:      POST /api/ai/drafts/:id/reject`)
    console.log(`    Draft Chat:  POST /api/ai/drafts/chat`)
    console.log(`    Rebuild:     POST /api/ai/rebuild`)
    console.log()
    console.log('  Owner API (no auth, web dashboard):')
    console.log(`    Dashboard:   GET  /api/dashboard`)
    console.log(`    Capture:     POST /api/capture`)
    console.log(`    Sync:        POST /api/sync`)
    console.log(`    Events:      GET  /api/events`)
    console.log(`    Memories:    GET  /api/memories`)
    console.log(`    Drafts:      GET  /api/drafts/pending`)
    console.log(`    Confirm:     POST /api/drafts/:id/confirm`)
    console.log(`    Reject:      POST /api/drafts/:id/reject`)
    console.log(`    Profile:     GET  /api/profile`)
    console.log(`    Stats:       GET  /api/stats`)
    console.log(`    Attachments: GET  /api/attachments`)
  })

  return server
}
