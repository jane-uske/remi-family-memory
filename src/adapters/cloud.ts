import type { LLMAdapter, LLMInput, LLMOutput, PayloadAudit, SourceRef } from './types.js'
import { DeterministicAdapter } from './deterministic.js'

export type CloudConfig = {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
}

const PROMPT_CONTRACT = `You are a family memory assistant. Answer ONLY based on the evidence provided.

Rules:
1. If evidence is empty or insufficient, set answerable=false with reason="no_evidence".
2. If evidence exists but is incomplete for the question (partial), set answerable=true, reason="partial_evidence", confidence="low" or "medium", and explain that evidence is limited.
3. Every answerable=true response MUST include sourceRefs from the evidence items.
4. sourceRefs MUST reference memoryId or sourceEventId values from the evidence.
5. Never invent events, dates, or facts not in the evidence.
6. Never extrapolate beyond what evidence states.
7. If your answer text mentions any date, title, or content from the evidence, you MUST include matching sourceRefs. Empty sourceRefs with evidence-referencing text is a protocol violation.
8. reason="no_evidence" is ONLY valid when evidence items array is empty. If items exist, use "evidence_found" or "partial_evidence".
9. Answer in Chinese (Mandarin).
10. Be warm and caring in tone.

Respond with valid JSON matching this schema:
{
  "answerable": boolean,
  "answer": string,
  "confidence": "high" | "medium" | "low" | "none",
  "reason": "evidence_found" | "no_evidence" | "partial_evidence",
  "sourceRefs": [{ "memoryId"?: string, "sourceEventId"?: string, "date"?: string, "title"?: string }]
}`

export class CloudAdapter implements LLMAdapter {
  type = 'cloud' as const
  private config: CloudConfig
  private fallback: DeterministicAdapter

  constructor(config: CloudConfig) {
    this.config = config
    this.fallback = new DeterministicAdapter()
  }

  async generate(input: LLMInput): Promise<LLMOutput> {
    const audit = this.auditPayload(input)
    this.logAudit(audit)

    if (!audit.safe) {
      console.error(`[cloud-adapter] BLOCKED: payload failed safety audit — ${audit.risks.join(', ')}`)
      const result = await this.fallback.generate(input)
      return { ...result, resultSource: 'audit_blocked' }
    }

    if (input.evidence.items.length === 0) {
      return {
        answerable: false,
        answer: '当前家庭记忆库里没有找到相关记录，无法确认。',
        confidence: 'none',
        reason: 'no_evidence',
        sourceRefs: [],
        resultSource: 'cloud',
      }
    }

    let raw: LLMOutput
    try {
      raw = await this.callLLM(input)
    } catch (e) {
      console.error(`[cloud-adapter] LLM call failed: ${e instanceof Error ? e.message : e}`)
      const result = await this.fallback.generate(input)
      return { ...result, resultSource: 'deterministic_fallback' }
    }

    const validated = this.validateOutput(raw, input)
    return { ...validated, resultSource: 'cloud' }
  }

  buildPayload(input: LLMInput): { messages: { role: string; content: string }[] } {
    const systemPrompt = PROMPT_CONTRACT
    const userContent = JSON.stringify({
      question: input.question,
      evidence: {
        query: input.evidence.query,
        items: input.evidence.items.map((item) => ({
          source: item.source,
          memoryId: item.memoryId,
          sourceEventId: item.sourceEventId,
          date: item.date,
          title: item.title,
          snippet: item.snippet,
          importance: item.importance,
        })),
        fromContext: input.evidence.fromContext,
        fromSearch: input.evidence.fromSearch,
      },
    })

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }
  }

  auditPayload(input: LLMInput): PayloadAudit {
    const payloadStr = JSON.stringify(input)
    const risks: string[] = []

    const blockedPatterns: [RegExp, string][] = [
      [/blocked_from_ai/i, 'contains blocked_from_ai sensitivity marker'],
      [/BLOCKED_SECRET/i, 'contains BLOCKED_SECRET content'],
      [/data\/events/i, 'contains raw event store path'],
      [/data\/inbox/i, 'contains inbox path'],
      [/data\/archive/i, 'contains archive path'],
      [/\/api\/events/i, 'contains owner-facing /api/events reference'],
      [/data\/attachments/i, 'contains attachment registry path'],
      [/\.jpg|\.png|\.mp4|\.wav|\.pdf/i, 'contains attachment file extension'],
      [/data\/reports/i, 'contains report store path'],
      [/"source"\s*:\s*"report"/i, 'contains report-type source item'],
    ]

    for (const [pattern, risk] of blockedPatterns) {
      if (pattern.test(payloadStr)) {
        risks.push(risk)
      }
    }

    const hasBlockedFromAi = /blocked_from_ai|BLOCKED_SECRET/i.test(payloadStr)
    const hasRawEvents = /data\/events|data\/inbox|data\/archive/i.test(payloadStr)
    const hasAttachmentRawPath = /data\/attachments|\.jpg|\.png|\.mp4|\.wav|\.pdf/i.test(payloadStr)
    const hasReportContent = /data\/reports|"source"\s*:\s*"report"/i.test(payloadStr)
    const hasOwnerApi = /\/api\/events/i.test(payloadStr)

    return {
      evidenceItemCount: input.evidence.items.length,
      sourceCount: input.evidence.items.filter((i) => i.memoryId || i.sourceEventId).length,
      hasBlockedFromAi,
      hasRawEvents,
      hasAttachmentRawPath,
      hasReportContent,
      hasOwnerApi,
      byteSize: Buffer.byteLength(payloadStr, 'utf-8'),
      safe: risks.length === 0,
      risks,
    }
  }

  private logAudit(audit: PayloadAudit): void {
    const status = audit.safe ? 'SAFE' : `UNSAFE [${audit.risks.join('; ')}]`
    console.log(`[cloud-adapter] Payload audit: ${audit.evidenceItemCount} evidence, ${audit.sourceCount} sources, ${audit.byteSize}B — ${status}`)
  }

  private async callLLM(input: LLMInput): Promise<LLMOutput> {
    const payload = this.buildPayload(input)

    const url = this.resolveEndpoint()
    const body = {
      model: this.config.model,
      messages: payload.messages,
      temperature: 0.3,
      max_tokens: 1024,
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`LLM API returned ${res.status}: ${await res.text()}`)
    }

    const data = await res.json() as {
      choices?: { message?: { content?: string } }[]
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('LLM returned empty content')
    }

    return this.parseLLMResponse(content)
  }

  private resolveEndpoint(): string {
    if (this.config.baseUrl) {
      return `${this.config.baseUrl}/chat/completions`
    }
    if (this.config.provider === 'anthropic') {
      throw new Error('Anthropic provider not supported in v0.7.1 — requires different request/response format. Use OpenAI-compatible provider or set FAMILY_MEMORY_LLM_BASE_URL.')
    }
    return 'https://api.openai.com/v1/chat/completions'
  }

  private parseLLMResponse(content: string): LLMOutput {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('LLM response does not contain JSON')
    }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      answerable: Boolean(parsed.answerable),
      answer: String(parsed.answer || ''),
      confidence: parsed.confidence || 'none',
      reason: parsed.reason || 'no_evidence',
      sourceRefs: Array.isArray(parsed.sourceRefs) ? parsed.sourceRefs : [],
    }
  }

  validateOutput(output: LLMOutput, input: LLMInput): LLMOutput {
    if (output.answerable && output.sourceRefs.length === 0) {
      return {
        answerable: false,
        answer: output.answer,
        confidence: 'none',
        reason: 'validation_failed_no_sources',
        sourceRefs: [],
      }
    }

    if (output.answerable) {
      const validSources = output.sourceRefs.filter((ref) =>
        input.evidence.items.some((item) =>
          (ref.memoryId && item.memoryId === ref.memoryId) ||
          (ref.sourceEventId && item.sourceEventId === ref.sourceEventId)
        )
      )

      if (validSources.length === 0) {
        return {
          answerable: false,
          answer: output.answer,
          confidence: 'none',
          reason: 'validation_failed_phantom_sources',
          sourceRefs: [],
        }
      }

      let result = { ...output, sourceRefs: validSources }

      if (isBroadHealthQuestion(input.question)) {
        result = this.enforceBroadHealthGuardrail(result, input)
      }

      return result
    }

    // --- Partial evidence correction ---
    // If evidence exists but LLM claimed no_evidence, check if answer uses evidence content
    if (input.evidence.items.length > 0 && output.reason === 'no_evidence') {
      const usesEvidence = this.answerUsesEvidence(output.answer, input.evidence.items)
      if (usesEvidence.length > 0) {
        const corrected: LLMOutput = {
          answerable: true,
          answer: output.answer,
          confidence: 'low',
          reason: 'partial_evidence',
          sourceRefs: usesEvidence.map((item) => ({
            memoryId: item.memoryId,
            sourceEventId: item.sourceEventId,
            date: item.date,
            title: item.title,
          })),
        }
        if (isBroadHealthQuestion(input.question)) {
          return this.enforceBroadHealthGuardrail(corrected, input)
        }
        return corrected
      }
    }

    // If answer text references evidence content but sourceRefs is empty
    if (input.evidence.items.length > 0 && output.sourceRefs.length === 0) {
      const usesEvidence = this.answerUsesEvidence(output.answer, input.evidence.items)
      if (usesEvidence.length > 0) {
        const corrected: LLMOutput = {
          answerable: true,
          answer: output.answer,
          confidence: output.confidence === 'none' ? 'low' : output.confidence,
          reason: 'partial_evidence',
          sourceRefs: usesEvidence.map((item) => ({
            memoryId: item.memoryId,
            sourceEventId: item.sourceEventId,
            date: item.date,
            title: item.title,
          })),
        }
        if (isBroadHealthQuestion(input.question)) {
          return this.enforceBroadHealthGuardrail(corrected, input)
        }
        return corrected
      }
    }

    return output
  }

  private answerUsesEvidence(answer: string, items: LLMInput['evidence']['items']): LLMInput['evidence']['items'] {
    return items.filter((item) => {
      if (item.date && answer.includes(item.date)) return true
      if (item.title && item.title.length >= 3 && answer.includes(item.title)) return true
      if (item.snippet && item.snippet.length >= 5) {
        const snippetHead = item.snippet.slice(0, 20)
        if (answer.includes(snippetHead)) return true
      }
      return false
    })
  }

  private enforceBroadHealthGuardrail(output: LLMOutput, input: LLMInput): LLMOutput {
    const capped: LLMOutput = {
      ...output,
      confidence: output.confidence === 'high' ? 'medium' : output.confidence,
      reason: 'partial_evidence',
    }

    if (containsBannedBroadConclusion(capped.answer)) {
      capped.answer = buildSafeBroadAnswer(input.evidence.items)
    }

    return capped
  }
}

const BROAD_HEALTH_PATTERNS = [
  /身体状态/, /发育.{0,2}好/, /健康吗/, /最近怎么样/,
  /状态如何/, /状态怎么样/, /一直正常/, /有没有问题/,
  /发育情况/, /健康状况/, /整体.*怎/,
]

export function isBroadHealthQuestion(question: string): boolean {
  return BROAD_HEALTH_PATTERNS.some((p) => p.test(question))
}

const BANNED_BROAD_CONCLUSIONS = [
  '整体情况良好', '目前状态良好', '很健康', '发育很好',
  '没问题', '一切正常', '状态不错', '整体良好',
  '身体状况良好', '发育正常', '一切都好', '非常健康',
]

export function containsBannedBroadConclusion(answer: string): boolean {
  return BANNED_BROAD_CONCLUSIONS.some((phrase) => answer.includes(phrase))
}

function buildSafeBroadAnswer(items: LLMInput['evidence']['items']): string {
  if (items.length === 0) {
    return '当前家庭记忆库里没有找到足够的相关记录来完整判断身体状态。'
  }
  const dates = [...new Set(items.map((e) => e.date).filter(Boolean))]
  const titles = items.map((e) => e.title).filter(Boolean).slice(0, 3)
  let answer = `目前只找到 ${items.length} 条相关记录`
  if (dates.length > 0) answer += `（${dates.join('、')}）`
  if (titles.length > 0) answer += `：${titles.join('、')}`
  answer += '。该记录只能说明当时检查情况，不能据此完整判断整体身体状态。如需更准确的回答，请补充更多家庭记录。'
  return answer
}
