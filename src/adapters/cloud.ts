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
1. If evidence is empty or insufficient, set answerable=false.
2. Every answerable=true response MUST include sourceRefs from the evidence items.
3. sourceRefs MUST reference memoryId or sourceEventId values from the evidence.
4. Never invent events, dates, or facts not in the evidence.
5. Never extrapolate beyond what evidence states.
6. Answer in Chinese (Mandarin).
7. Be warm and caring in tone.

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

    if (input.evidence.items.length === 0) {
      return {
        answerable: false,
        answer: '当前家庭记忆库里没有找到相关记录，无法确认。',
        confidence: 'none',
        reason: 'no_evidence',
        sourceRefs: [],
      }
    }

    let raw: LLMOutput
    try {
      raw = await this.callLLM(input)
    } catch (e) {
      console.error(`[cloud-adapter] LLM call failed: ${e instanceof Error ? e.message : e}`)
      return this.fallback.generate(input)
    }

    const validated = this.validateOutput(raw, input)
    return validated
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
    return {
      evidenceItemCount: input.evidence.items.length,
      sourceCount: input.evidence.items.filter((i) => i.memoryId || i.sourceEventId).length,
      hasBlockedFromAi: false,
      hasRawEvents: false,
      hasAttachmentRawPath: false,
      byteSize: Buffer.byteLength(payloadStr, 'utf-8'),
    }
  }

  private logAudit(audit: PayloadAudit): void {
    console.log(`[cloud-adapter] Payload audit: ${audit.evidenceItemCount} evidence items, ${audit.sourceCount} sources, ${audit.byteSize} bytes`)
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
    switch (this.config.provider) {
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions'
      case 'anthropic':
        return 'https://api.anthropic.com/v1/messages'
      default:
        return 'https://api.openai.com/v1/chat/completions'
    }
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

      return { ...output, sourceRefs: validSources }
    }

    return output
  }
}
