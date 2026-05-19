/**
 * v0.8: Remi Integration Smoke
 *
 * Minimal integration point for Remi to access family-memory.
 * NOT a formal plugin — just proves Remi can call family-memory
 * via AI-facing APIs and get grounded answers.
 *
 * Config:
 *   FAMILY_MEMORY_ENABLED=true        (default: false)
 *   FAMILY_MEMORY_SERVICE_URL=...     (default: http://localhost:3456)
 *   FAMILY_MEMORY_AI_TOKEN=...        (required when enabled)
 *
 * Remi only calls:
 *   /api/ai/health, /api/ai/context, /api/ai/search
 *   via RemiConnector (never /api/events)
 *
 * blocked_from_ai content never reaches Remi.
 */

import { RemiConnector } from './connector.js'
import type { GroundedAnswer, ConnectorStatus } from './connector.js'
import type { ResultSource } from './adapters/types.js'

export type RemiMemoryConfig = {
  enabled: boolean
  serviceUrl: string
  token: string | null
}

export type RemiMemoryResponse = {
  handled: boolean
  question: string
  answerable: boolean
  answer: string
  confidence: string
  reason: string
  sources: GroundedAnswer['sources']
  provenanceNote?: string
  serviceStatus: ConnectorStatus
  resultSource?: ResultSource
}

const FAMILY_QUESTION_PATTERNS: RegExp[] = [
  /胎动/, /孕检/, /核心记忆/, /家庭记忆/,
  /里程碑/, /怀孕/, /预产期/, /产检/,
  /宝宝.{0,6}(第一次|什么时候|怎么样|多大|多重|多高)/,
  /宝宝.{0,6}(喜欢|最近|身体|发育|健康|状态)/,
  /家庭.{0,4}(记录|记忆|日记)/,
  /孕期/, /胎心/, /B超/, /唐筛/, /糖耐/,
]

export function isFamilyMemoryQuestion(question: string): boolean {
  return FAMILY_QUESTION_PATTERNS.some((p) => p.test(question))
}

export function loadConfig(): RemiMemoryConfig {
  return {
    enabled: process.env.FAMILY_MEMORY_ENABLED === 'true',
    serviceUrl: process.env.FAMILY_MEMORY_SERVICE_URL || 'http://localhost:3456',
    token: process.env.FAMILY_MEMORY_AI_TOKEN || null,
  }
}

export class RemiMemoryAdapter {
  private config: RemiMemoryConfig
  private connector: RemiConnector | null = null
  private connected = false

  constructor(config?: RemiMemoryConfig) {
    this.config = config || loadConfig()
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  async ensureConnected(): Promise<boolean> {
    if (!this.config.enabled) return false
    if (this.connected && this.connector) return true

    this.connector = new RemiConnector(this.config.serviceUrl, this.config.token)
    const result = await this.connector.connect()
    if (result.ok) {
      this.connected = true
      await this.connector.loadContext()
      return true
    }
    return false
  }

  async handleQuestion(question: string): Promise<RemiMemoryResponse> {
    if (!this.config.enabled) {
      return {
        handled: false,
        question,
        answerable: false,
        answer: '',
        confidence: 'none',
        reason: 'disabled',
        sources: [],
        serviceStatus: 'unavailable',
      }
    }

    if (!isFamilyMemoryQuestion(question)) {
      return {
        handled: false,
        question,
        answerable: false,
        answer: '',
        confidence: 'none',
        reason: 'not_family_question',
        sources: [],
        serviceStatus: this.connector?.getStatus() || 'unavailable',
      }
    }

    const ok = await this.ensureConnected()
    if (!ok || !this.connector) {
      return {
        handled: true,
        question,
        answerable: false,
        answer: '家庭记忆服务暂不可用，无法回答家庭相关问题。请稍后再试。',
        confidence: 'none',
        reason: 'service_unavailable',
        sources: [],
        serviceStatus: 'unavailable',
      }
    }

    const grounded = await this.connector.answer(question)

    if (!grounded.answerable) {
      return {
        handled: true,
        question,
        answerable: false,
        answer: '家庭记忆里还没有相关记录。',
        confidence: 'none',
        reason: grounded.reason,
        sources: [],
        serviceStatus: grounded.serviceStatus,
        resultSource: grounded.resultSource,
      }
    }

    return {
      handled: true,
      question,
      answerable: true,
      answer: grounded.answer,
      confidence: grounded.confidence,
      reason: grounded.reason,
      sources: grounded.sources,
      provenanceNote: grounded.provenanceNote,
      serviceStatus: grounded.serviceStatus,
      resultSource: grounded.resultSource,
    }
  }
}
