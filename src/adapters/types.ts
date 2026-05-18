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

export type LLMOutput = {
  answerable: boolean
  answer: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason: string
  sourceRefs: SourceRef[]
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
  hasBlockedFromAi: false
  hasRawEvents: false
  hasAttachmentRawPath: false
  byteSize: number
}

export interface LLMAdapter {
  type: AdapterType
  generate(input: LLMInput): Promise<LLMOutput>
}
