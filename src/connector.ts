import type { MemoryRecord, MemoryImportance, MemoryProvenance } from './types.js'
import { createAdapter } from './adapters/index.js'
import type { LLMAdapter, EvidencePayload, EvidencePayloadItem } from './adapters/index.js'
import type { ResultSource } from './adapters/types.js'

const DEFAULT_BASE_URL = 'http://localhost:3456'

// --- Service Status ---

export type ConnectorStatus = 'connected' | 'degraded' | 'unavailable'

// --- Confidence Levels ---

export type Confidence = 'high' | 'medium' | 'low' | 'none'

// --- Evidence ---

export type EvidenceItem = {
  source: 'memory' | 'event' | 'context' | 'search' | 'report'
  memoryId?: string
  sourceEventId?: string
  date?: string
  title?: string
  path?: string
  snippet: string
  importance?: MemoryImportance
}

export type EvidencePack = {
  query: string
  items: EvidenceItem[]
  fromContext: boolean
  fromSearch: boolean
  collectedAt: string
}

// --- Grounded Answer ---

export type GroundedAnswer = {
  question: string
  answerable: boolean
  answer: string
  confidence: Confidence
  reason: string
  sources: {
    memoryId?: string
    sourceEventId?: string
    date?: string
    title?: string
    path?: string
  }[]
  provenanceNote?: string
  evidence: EvidencePack
  serviceStatus: ConnectorStatus
  resultSource?: ResultSource
  generatedAt: string
}

// --- API Response Types ---

export type HealthResponse = {
  ok: boolean
  schemaVersion: string
  service: string
  checks: Record<string, string>
  updatedAt: string
}

export type ContextResponse = {
  schemaVersion: string
  generatedAt: string
  profile: {
    nickname: string
    expectedBirthDate: string
    stage: string
    gestationalWeeks: number | null
    parents: { role: string; name: string; nickname?: string }[]
  } | null
  status: {
    totalEvents: number
    totalMemories: number
    totalAttachments: number
    unattachedAssets: number
  }
  coreMemories: {
    memoryId: string
    date: string
    title: string
    summary: string
    facts: string[]
    people: string[]
    tags: string[]
  }[]
  highMemories: {
    memoryId: string
    date: string
    type: string
    title: string
    summary: string
  }[]
  recentEvents: {
    id: string
    date: string
    type: string
    title: string
  }[]
  recentParentNotes: {
    date: string
    title: string
    summary?: string
  }[]
}

export type SearchResultItem = {
  type: 'event' | 'memory' | 'report' | 'attachment'
  date: string
  eventType?: string
  title: string
  matchedText: string
  sourcePath?: string
  importance?: MemoryImportance
  memoryId?: string
  sourceEventId?: string
}

export type SearchResponse = {
  query: string
  total: number
  results: SearchResultItem[]
}

export type MemoriesResponse = {
  schemaVersion: string
  total: number
  memories: MemoryRecord[]
}

// --- Connector ---

export class RemiConnector {
  private baseUrl: string
  private token: string | null
  private status: ConnectorStatus = 'unavailable'
  private context: ContextResponse | null = null
  private adapter: LLMAdapter

  constructor(baseUrl = DEFAULT_BASE_URL, token: string | null = null) {
    this.baseUrl = baseUrl
    this.token = token
    this.adapter = createAdapter()
  }

  getAdapterType(): string {
    return this.adapter.type
  }

  private headers(): Record<string, string> {
    if (this.token) {
      return { 'Authorization': `Bearer ${this.token}` }
    }
    return {}
  }

  getStatus(): ConnectorStatus {
    return this.status
  }

  getContext(): ContextResponse | null {
    return this.context
  }

  async connect(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/ai/health`, { headers: this.headers() })
      if (!res.ok) {
        this.status = 'unavailable'
        return { ok: false, error: `Health check failed: HTTP ${res.status}` }
      }
      const health = await res.json() as HealthResponse
      if (!health.ok) {
        this.status = 'degraded'
        return { ok: true, error: 'Service reports degraded state' }
      }
      this.status = 'connected'
      return { ok: true }
    } catch (e) {
      this.status = 'unavailable'
      return { ok: false, error: `Cannot reach family-memory service: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async loadContext(): Promise<{ ok: boolean; context?: ContextResponse; error?: string }> {
    if (this.status === 'unavailable') {
      return { ok: false, error: '家庭记忆服务暂不可用，无法加载上下文。' }
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/ai/context`, { headers: this.headers() })
      if (!res.ok) {
        this.status = 'degraded'
        return { ok: false, error: `Context load failed: HTTP ${res.status}` }
      }
      this.context = await res.json() as ContextResponse
      return { ok: true, context: this.context }
    } catch (e) {
      this.status = 'degraded'
      this.context = null
      return { ok: false, error: `Context load failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async search(query: string): Promise<{ ok: boolean; results?: SearchResultItem[]; error?: string }> {
    if (this.status === 'unavailable') {
      return { ok: false, error: '家庭记忆服务暂不可用，无法搜索。' }
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/ai/search?q=${encodeURIComponent(query)}`, { headers: this.headers() })
      if (!res.ok) {
        return { ok: false, error: `Search failed: HTTP ${res.status}` }
      }
      const data = await res.json() as SearchResponse
      return { ok: true, results: data.results }
    } catch (e) {
      return { ok: false, error: `Search failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  async answer(question: string): Promise<GroundedAnswer> {
    const now = new Date().toISOString()

    if (this.status === 'unavailable') {
      return {
        question,
        answerable: false,
        answer: '家庭记忆服务暂不可用，无法回答家庭相关问题。请稍后再试。',
        confidence: 'none',
        reason: 'service_unavailable',
        sources: [],
        evidence: { query: question, items: [], fromContext: false, fromSearch: false, collectedAt: now },
        serviceStatus: this.status,
        generatedAt: now,
      }
    }

    const evidence = await this.collectEvidence(question)

    const adapterInput = {
      question,
      evidence: this.toAdapterEvidence(evidence),
      promptContract: 'grounded_answer_v1',
    }

    const output = await this.adapter.generate(adapterInput)

    const sources = output.sourceRefs.map((ref) => ({
      memoryId: ref.memoryId,
      sourceEventId: ref.sourceEventId,
      date: ref.date,
      title: ref.title,
    }))

    const provenanceNote = output.answerable
      ? await this.buildProvenanceNote(sources.map((s) => s.memoryId).filter(Boolean) as string[])
      : undefined

    return {
      question,
      answerable: output.answerable,
      answer: output.answer,
      confidence: output.confidence,
      reason: output.reason,
      sources,
      provenanceNote,
      evidence,
      serviceStatus: this.status,
      resultSource: output.resultSource,
      generatedAt: now,
    }
  }

  private async buildProvenanceNote(memoryIds: string[]): Promise<string | undefined> {
    if (memoryIds.length === 0) return undefined

    try {
      const res = await fetch(`${this.baseUrl}/api/ai/memories`, { headers: this.headers() })
      if (!res.ok) return undefined
      const data = await res.json() as MemoriesResponse
      const matched = data.memories.filter((m) => memoryIds.includes(m.memoryId))
      if (matched.length === 0) return undefined

      return formatProvenanceNote(matched.map((m) => m.provenance).filter(Boolean) as MemoryProvenance[])
    } catch {
      return undefined
    }
  }

  private toAdapterEvidence(evidence: EvidencePack): EvidencePayload {
    return {
      query: evidence.query,
      items: evidence.items
        .filter((i) => i.source !== 'report')
        .map((i): EvidencePayloadItem => ({
          source: i.source === 'report' ? 'search' : i.source as EvidencePayloadItem['source'],
          memoryId: i.memoryId,
          sourceEventId: i.sourceEventId,
          date: i.date,
          title: i.title,
          snippet: i.snippet,
          importance: i.importance,
        })),
      fromContext: evidence.fromContext,
      fromSearch: evidence.fromSearch,
      collectedAt: evidence.collectedAt,
    }
  }

  private async collectEvidence(question: string): Promise<EvidencePack> {
    const now = new Date().toISOString()
    const items: EvidenceItem[] = []
    let fromContext = false
    let fromSearch = false

    if (this.context) {
      const contextItems = this.findInContext(question)
      if (contextItems.length > 0) {
        items.push(...contextItems)
        fromContext = true
      }
    }

    const keywords = extractKeywords(question)
    for (const kw of keywords) {
      const res = await this.search(kw)
      if (res.ok && res.results && res.results.length > 0) {
        fromSearch = true
        for (const r of res.results) {
          const exists = items.some((i) =>
            i.memoryId === r.memoryId && i.date === r.date && i.title === r.title
          )
          if (!exists) {
            items.push({
              source: r.type === 'report' ? 'report' : r.type === 'memory' ? 'memory' : r.type === 'event' ? 'event' : 'search',
              memoryId: r.memoryId,
              sourceEventId: r.sourceEventId,
              date: r.date,
              title: r.title,
              path: r.sourcePath,
              snippet: r.matchedText,
              importance: r.importance,
            })
          }
        }
      }
    }

    const filtered = this.filterRelevantEvidence(question, items)
    return { query: question, items: filtered, fromContext, fromSearch, collectedAt: now }
  }

  private filterRelevantEvidence(question: string, items: EvidenceItem[]): EvidenceItem[] {
    const futureEventPatterns = [
      { pattern: /出生当天|出生那天|出生时/, requiredTitle: /出生/ },
      { pattern: /第一次说话|开口说话/, requiredTitle: /说话|开口/ },
      { pattern: /第一次走路|学走路/, requiredTitle: /走路/ },
    ]

    for (const { pattern, requiredTitle } of futureEventPatterns) {
      if (pattern.test(question)) {
        const relevant = items.filter((e) => e.title && requiredTitle.test(e.title))
        return relevant
      }
    }

    return items
  }

  private findInContext(question: string): EvidenceItem[] {
    if (!this.context) return []
    const items: EvidenceItem[] = []
    const keywords = extractKeywords(question)

    for (const m of this.context.coreMemories) {
      const searchable = [m.title, m.summary, ...m.facts].join(' ')
      if (containsAny(searchable.toLowerCase(), keywords)) {
        items.push({
          source: 'context',
          memoryId: m.memoryId,
          date: m.date,
          title: m.title,
          snippet: m.summary.slice(0, 150),
          importance: 'core',
        })
      }
    }

    for (const m of this.context.highMemories) {
      const searchable = [m.title, m.summary].join(' ')
      if (containsAny(searchable.toLowerCase(), keywords)) {
        items.push({
          source: 'context',
          memoryId: m.memoryId,
          date: m.date,
          title: m.title,
          snippet: m.summary.slice(0, 150),
          importance: 'high',
        })
      }
    }

    if (question.includes('核心记忆') && this.context.coreMemories.length > 0) {
      for (const m of this.context.coreMemories) {
        const exists = items.some((i) => i.memoryId === m.memoryId)
        if (!exists) {
          items.push({
            source: 'context',
            memoryId: m.memoryId,
            date: m.date,
            title: m.title,
            snippet: m.summary.slice(0, 150),
            importance: 'core',
          })
        }
      }
    }

    return items
  }
}

// --- Utilities ---

function extractKeywords(question: string): string[] {
  const words: string[] = []

  const patterns: [RegExp, string[]][] = [
    [/胎动/, ['胎动']],
    [/孕检/, ['孕检']],
    [/记忆系统/, ['记忆系统']],
    [/核心记忆/, ['核心记忆']],
    [/里程碑/, ['里程碑']],
    [/家庭记忆/, ['家庭记忆']],
    [/身体状态|健康状况|发育情况/, ['孕检', '身体']],
  ]
  for (const [p, kws] of patterns) {
    if (p.test(question)) {
      words.push(...kws)
    }
  }

  if (words.length === 0) {
    const cleaned = question.replace(/[？?！!。，、\s]/g, '')
    const stopWords = ['是', '什么', '时候', '的', '吗', '了', '呢', '吧', '有', '哪些', '我们', '为什么', '怎么', '宝宝', '最近', '一次', '现在', '开始', '喜欢', '以后', '想', '当天', '发生', '第一次', '哪所', '上']
    let remaining = cleaned
    for (const sw of stopWords) {
      remaining = remaining.replaceAll(sw, '')
    }
    if (remaining.length > 0 && remaining.length <= 10) {
      words.push(remaining)
    }
    if (words.length === 0 && cleaned.length <= 15) {
      words.push(cleaned)
    }
  }

  return [...new Set(words)]
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw.toLowerCase()))
}

export function formatProvenanceNote(provenances: MemoryProvenance[]): string | undefined {
  if (provenances.length === 0) return undefined

  const parts: string[] = []

  const allConfirmed = provenances.every((p) => p.confidence === 'confirmed_by_parent')
  if (allConfirmed) parts.push('已由家长确认')

  const anyVlm = provenances.some((p) => p.vlmAssisted)
  const anyOcr = provenances.some((p) => p.ocrAssisted)

  if (anyVlm && anyOcr) {
    parts.push('OCR + VLM 辅助整理')
  } else if (anyVlm) {
    parts.push('VLM 辅助整理')
  } else if (anyOcr) {
    parts.push('OCR 辅助提取')
  }

  if (parts.length === 0) return undefined
  return `（${parts.join('，')}）`
}
