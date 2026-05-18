import type { MemoryRecord, MemoryImportance } from './types.js'

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
  evidence: EvidencePack
  serviceStatus: ConnectorStatus
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

  constructor(baseUrl = DEFAULT_BASE_URL, token: string | null = null) {
    this.baseUrl = baseUrl
    this.token = token
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
    const isPartial = this.isPartialEvidence(question, evidence)

    if (evidence.items.length === 0 && !isPartial) {
      return {
        question,
        answerable: false,
        answer: '当前家庭记忆库里没有找到相关记录，无法确认。',
        confidence: 'none',
        reason: 'no_evidence',
        sources: [],
        evidence,
        serviceStatus: this.status,
        generatedAt: now,
      }
    }

    if (isPartial) {
      const sources = evidence.items.map((e) => ({
        memoryId: e.memoryId,
        sourceEventId: e.sourceEventId,
        date: e.date,
        title: e.title,
        path: e.path,
      }))
      return {
        question,
        answerable: evidence.items.length > 0,
        answer: this.buildPartialAnswer(question, evidence),
        confidence: 'low',
        reason: 'partial_evidence',
        sources,
        evidence,
        serviceStatus: this.status,
        generatedAt: now,
      }
    }

    const answer = this.buildGroundedAnswer(question, evidence)
    const sources = evidence.items.map((e) => ({
      memoryId: e.memoryId,
      sourceEventId: e.sourceEventId,
      date: e.date,
      title: e.title,
      path: e.path,
    }))
    const confidence = this.assessConfidence(evidence)

    return {
      question,
      answerable: true,
      answer,
      confidence,
      reason: 'evidence_found',
      sources,
      evidence,
      serviceStatus: this.status,
      generatedAt: now,
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

  private isPartialEvidence(question: string, evidence: EvidencePack): boolean {
    const broadPatterns = ['身体状态', '发育情况', '整体', '最近怎么样', '健康状况', '状态怎么样']
    const isBroad = broadPatterns.some((bp) => question.includes(bp))
    if (isBroad) return true

    return false
  }

  private assessConfidence(evidence: EvidencePack): Confidence {
    if (evidence.items.length === 0) return 'none'

    const hasCoreOrHigh = evidence.items.some((e) => e.importance === 'core' || e.importance === 'high')
    const hasMultiple = evidence.items.length >= 2
    const hasMemory = evidence.items.some((e) => e.source === 'memory' || e.source === 'context')

    if (hasCoreOrHigh && hasMemory) return 'high'
    if (hasMemory && hasMultiple) return 'high'
    if (hasMemory) return 'medium'
    return 'low'
  }

  private buildGroundedAnswer(question: string, evidence: EvidencePack): string {
    const items = evidence.items

    if (question.includes('核心记忆')) {
      const coreItems = items.filter((e) => e.importance === 'core')
      if (coreItems.length > 0) {
        return `当前核心记忆有 ${coreItems.length} 条：${coreItems.map((e) => `${e.date}「${e.title}」`).join('；')}`
      }
    }

    if (question.includes('胎动')) {
      const fetalItem = items.find((e) => e.title?.includes('胎动'))
      if (fetalItem) {
        return `根据家庭记忆记录（${fetalItem.date}）：${fetalItem.snippet}`
      }
    }

    if (question.includes('孕检')) {
      const checkupItem = items.find((e) => e.title?.includes('孕检'))
      if (checkupItem) {
        return `根据家庭记忆记录（${checkupItem.date}）：${checkupItem.title}。${checkupItem.snippet}`
      }
    }

    if (question.includes('记忆系统') || question.includes('家庭记忆')) {
      const systemItem = items.find((e) => e.title?.includes('家庭记忆'))
      if (systemItem) {
        return `根据家庭记忆记录（${systemItem.date}）：${systemItem.title}。${systemItem.snippet}`
      }
    }

    const best = items[0]
    return `根据家庭记忆记录（${best.date}）：${best.title}。${best.snippet}`
  }

  private buildPartialAnswer(question: string, evidence: EvidencePack): string {
    const items = evidence.items

    if (items.length === 0) {
      return `当前家庭记忆库里没有找到足够的相关记录来完整回答该问题。如需更准确的回答，请补充更多家庭记录。`
    }

    const dates = [...new Set(items.map((e) => e.date).filter(Boolean))]
    const titles = items.map((e) => e.title).filter(Boolean).slice(0, 3)

    let prefix = `目前只找到 ${items.length} 条相关记录`
    if (dates.length > 0) {
      prefix += `（${dates.join('、')}）`
    }

    let detail = ''
    if (titles.length > 0) {
      detail = `：${titles.join('、')}`
    }

    return `${prefix}${detail}，不能据此完整回答该问题。如需更准确的回答，请补充更多家庭记录。`
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
