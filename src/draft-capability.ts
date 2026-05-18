import { loadPendingDrafts, confirmDraft, rejectDraft } from './drafts.js'
import type { DraftNote } from './types.js'
import type { DraftOverrides, ConfirmResult, RejectResult } from './drafts.js'

export type DraftCapabilityResponse = {
  handled: boolean
  response: string
  activeDraftId?: string | null
  activeSummary?: string | null
  pendingCount?: number
}

export type DraftSessionState = {
  activeDraftId: string | null
  activeSummary: string | null
}

const INTENT_LIST = /待确认|有什么.*确认|pending|有.*draft/i
const INTENT_CONFIRM = /^(确认|确认吧|好的确认|好，确认|好,确认|确定)$/
const INTENT_REJECT = /^(跳过|skip|不要了|算了)$/
const INTENT_SELECT = /^(?:选择?\s*|#)(\d+)$/
const INTENT_SUMMARY = /^补充摘要[：:]\s*(.+)/

export class DraftCapability {
  private activeDraftId: string | null = null
  private activeSummary: string | null = null
  private serviceAvailable = true

  setServiceAvailable(available: boolean): void {
    this.serviceAvailable = available
  }

  getState(): DraftSessionState {
    return { activeDraftId: this.activeDraftId, activeSummary: this.activeSummary }
  }

  setState(state: DraftSessionState): void {
    this.activeDraftId = state.activeDraftId
    this.activeSummary = state.activeSummary
  }

  isDraftIntent(input: string): boolean {
    const trimmed = input.trim()
    return (
      INTENT_LIST.test(trimmed) ||
      INTENT_CONFIRM.test(trimmed) ||
      INTENT_REJECT.test(trimmed) ||
      INTENT_SELECT.test(trimmed) ||
      INTENT_SUMMARY.test(trimmed)
    )
  }

  handle(input: string): DraftCapabilityResponse {
    const trimmed = input.trim()

    if (!this.serviceAvailable) {
      return { handled: true, response: '家庭记忆服务暂不可用' }
    }

    if (INTENT_LIST.test(trimmed)) {
      return this.handleList()
    }

    if (INTENT_SELECT.test(trimmed)) {
      const match = trimmed.match(INTENT_SELECT)!
      const num = parseInt(match[1], 10)
      return this.handleSelect(num)
    }

    if (INTENT_SUMMARY.test(trimmed)) {
      const match = trimmed.match(INTENT_SUMMARY)!
      const summary = match[1].trim()
      return this.handleUpdateSummary(summary)
    }

    if (INTENT_CONFIRM.test(trimmed)) {
      return this.handleConfirm()
    }

    if (INTENT_REJECT.test(trimmed)) {
      return this.handleReject()
    }

    return { handled: false, response: '' }
  }

  private handleList(): DraftCapabilityResponse {
    const drafts = loadPendingDrafts()

    if (drafts.length === 0) {
      this.activeDraftId = null
      this.activeSummary = null
      return {
        handled: true,
        response: '当前没有待确认的 draft。',
        pendingCount: 0,
        activeDraftId: null,
      }
    }

    if (drafts.length === 1) {
      this.activeDraftId = drafts[0].draftId
      this.activeSummary = null
      return {
        handled: true,
        response: this.formatDraftList(drafts) + '\n\n只有一条，可以直接回复"确认"或"跳过"。',
        pendingCount: 1,
        activeDraftId: this.activeDraftId,
      }
    }

    this.activeDraftId = null
    this.activeSummary = null
    return {
      handled: true,
      response: this.formatDraftList(drafts) + '\n\n请先选择编号（如"选择 1"），再确认或跳过。',
      pendingCount: drafts.length,
      activeDraftId: null,
    }
  }

  private handleSelect(num: number): DraftCapabilityResponse {
    const drafts = loadPendingDrafts()

    if (drafts.length === 0) {
      return { handled: true, response: '当前没有待确认的 draft。', pendingCount: 0 }
    }

    if (num < 1 || num > drafts.length) {
      return {
        handled: true,
        response: `编号无效，请输入 1~${drafts.length} 之间的数字。`,
        pendingCount: drafts.length,
      }
    }

    const draft = drafts[num - 1]
    this.activeDraftId = draft.draftId
    this.activeSummary = null
    return {
      handled: true,
      response: `已选择第 ${num} 条：\n${this.formatSingleDraft(draft)}\n\n可以"补充摘要：xxx"、"确认"或"跳过"。`,
      pendingCount: drafts.length,
      activeDraftId: this.activeDraftId,
    }
  }

  private handleUpdateSummary(summary: string): DraftCapabilityResponse {
    if (!this.activeDraftId) {
      const drafts = loadPendingDrafts()
      if (drafts.length === 1) {
        this.activeDraftId = drafts[0].draftId
      } else if (drafts.length > 1) {
        return {
          handled: true,
          response: `有 ${drafts.length} 条待确认，请先选择编号。`,
          pendingCount: drafts.length,
        }
      } else {
        return { handled: true, response: '当前没有待确认的 draft。', pendingCount: 0 }
      }
    }

    this.activeSummary = summary
    return {
      handled: true,
      response: `摘要已更新：「${summary}」\n回复"确认"保存，或继续补充。`,
      activeDraftId: this.activeDraftId,
      activeSummary: this.activeSummary,
    }
  }

  private handleConfirm(): DraftCapabilityResponse {
    const drafts = loadPendingDrafts()

    if (drafts.length === 0) {
      this.activeDraftId = null
      return { handled: true, response: '当前没有待确认的 draft。', pendingCount: 0 }
    }

    if (!this.activeDraftId && drafts.length === 1) {
      this.activeDraftId = drafts[0].draftId
    }

    if (!this.activeDraftId && drafts.length > 1) {
      return {
        handled: true,
        response: `有 ${drafts.length} 条待确认，请先选择编号（如"选择 1"），不能直接确认。`,
        pendingCount: drafts.length,
        activeDraftId: null,
      }
    }

    const overrides: DraftOverrides = {}
    if (this.activeSummary) {
      overrides.summary = this.activeSummary
    }

    const result: ConfirmResult = confirmDraft(
      this.activeDraftId!,
      Object.keys(overrides).length > 0 ? overrides : undefined,
    )

    if (!result.ok) {
      return {
        handled: true,
        response: `确认失败：${result.message}`,
        activeDraftId: this.activeDraftId,
      }
    }

    const response = '已确认。已生成待同步 note，运行 npm run sync 后会进入正式时间线和 Remi 可查询记忆。'
    this.activeDraftId = null
    this.activeSummary = null
    return { handled: true, response, pendingCount: drafts.length - 1 }
  }

  private handleReject(): DraftCapabilityResponse {
    const drafts = loadPendingDrafts()

    if (drafts.length === 0) {
      this.activeDraftId = null
      return { handled: true, response: '当前没有待确认的 draft。', pendingCount: 0 }
    }

    if (!this.activeDraftId && drafts.length === 1) {
      this.activeDraftId = drafts[0].draftId
    }

    if (!this.activeDraftId && drafts.length > 1) {
      return {
        handled: true,
        response: `有 ${drafts.length} 条待确认，请先选择编号再跳过。`,
        pendingCount: drafts.length,
        activeDraftId: null,
      }
    }

    const result: RejectResult = rejectDraft(this.activeDraftId!)

    if (!result.ok) {
      return {
        handled: true,
        response: `跳过失败：${result.message}`,
        activeDraftId: this.activeDraftId,
      }
    }

    this.activeDraftId = null
    this.activeSummary = null
    return { handled: true, response: '已跳过。', pendingCount: drafts.length - 1 }
  }

  private formatDraftList(drafts: DraftNote[]): string {
    const lines = drafts.map((d, i) => {
      const date = d.inferredDate || '日期未知'
      const files = d.originalFilenames.join(', ')
      return `${i + 1}. [${date}] ${files}`
    })
    return `待确认 draft（共 ${drafts.length} 条）：\n${lines.join('\n')}`
  }

  private formatSingleDraft(draft: DraftNote): string {
    const date = draft.inferredDate || '日期未知'
    const files = draft.originalFilenames.join(', ')
    return `[${date}] ${files}`
  }
}
