import type { MemoryImportance } from '../types.js'

export type AdapterType = 'deterministic' | 'cloud' | 'local'

export type LLMInput = {
  question: string
  evidence: EvidencePayload
  promptContract: string
}

export type EvidencePayload = {
  query: string
  items: EvidencePayloadItem[]
  fromContext: boolean
  fromSearch: boolean
  collectedAt: string
}

export type EvidencePayloadItem = {
  source: 'memory' | 'event' | 'context' | 'search'
  memoryId?: string
  sourceEventId?: string
  date?: string
  title?: string
  snippet: string
  importance?: MemoryImportance
}

export type ResultSource = 'cloud' | 'deterministic' | 'deterministic_fallback' | 'audit_blocked'

export type LLMOutput = {
  answerable: boolean
  answer: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason: string
  sourceRefs: SourceRef[]
  resultSource?: ResultSource
}

export type SourceRef = {
  memoryId?: string
  sourceEventId?: string
  date?: string
  title?: string
}

export type PayloadAudit = {
  evidenceItemCount: number
  sourceCount: number
  hasBlockedFromAi: boolean
  hasRawEvents: boolean
  hasAttachmentRawPath: boolean
  hasReportContent: boolean
  hasOwnerApi: boolean
  byteSize: number
  safe: boolean
  risks: string[]
}

export interface LLMAdapter {
  type: AdapterType
  generate(input: LLMInput): Promise<LLMOutput>
}
