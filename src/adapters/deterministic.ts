import type { LLMAdapter, LLMInput, LLMOutput, SourceRef } from './types.js'
import { isBroadHealthQuestion, containsBannedBroadConclusion } from './cloud.js'

export class DeterministicAdapter implements LLMAdapter {
  type = 'deterministic' as const

  async generate(input: LLMInput): Promise<LLMOutput> {
    const { question, evidence } = input
    const items = evidence.items

    if (items.length === 0) {
      return {
        answerable: false,
        answer: '当前家庭记忆库里没有找到相关记录，无法确认。',
        confidence: 'none',
        reason: 'no_evidence',
        sourceRefs: [],
        resultSource: 'deterministic',
      }
    }

    const isBroad = isBroadHealthQuestion(question)

    if (isBroad) {
      const sources = items.map(toSourceRef)
      return {
        answerable: items.length > 0,
        answer: this.buildPartialAnswer(items),
        confidence: 'low',
        reason: 'partial_evidence',
        sourceRefs: sources,
        resultSource: 'deterministic',
      }
    }

    const answer = this.buildAnswer(question, items)
    const confidence = this.assessConfidence(items)
    const sources = items.map(toSourceRef)

    return {
      answerable: true,
      answer,
      confidence,
      reason: 'evidence_found',
      sourceRefs: sources,
      resultSource: 'deterministic',
    }
  }

  private buildAnswer(question: string, items: LLMInput['evidence']['items']): string {
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

  private buildPartialAnswer(items: LLMInput['evidence']['items']): string {
    if (items.length === 0) {
      return '当前家庭记忆库里没有找到足够的相关记录来完整回答该问题。如需更准确的回答，请补充更多家庭记录。'
    }

    const dates = [...new Set(items.map((e) => e.date).filter(Boolean))]
    const titles = items.map((e) => e.title).filter(Boolean).slice(0, 3)

    let prefix = `目前只找到 ${items.length} 条相关记录`
    if (dates.length > 0) prefix += `（${dates.join('、')}）`

    let detail = ''
    if (titles.length > 0) detail = `：${titles.join('、')}`

    return `${prefix}${detail}，不能据此完整回答该问题。如需更准确的回答，请补充更多家庭记录。`
  }

  private assessConfidence(items: LLMInput['evidence']['items']): 'high' | 'medium' | 'low' | 'none' {
    if (items.length === 0) return 'none'
    const hasCoreOrHigh = items.some((e) => e.importance === 'core' || e.importance === 'high')
    const hasMultiple = items.length >= 2
    const hasMemory = items.some((e) => e.source === 'memory' || e.source === 'context')

    if (hasCoreOrHigh && hasMemory) return 'high'
    if (hasMemory && hasMultiple) return 'high'
    if (hasMemory) return 'medium'
    return 'low'
  }
}

function toSourceRef(item: LLMInput['evidence']['items'][number]): SourceRef {
  return {
    memoryId: item.memoryId,
    sourceEventId: item.sourceEventId,
    date: item.date,
    title: item.title,
  }
}
