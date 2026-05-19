import { loadOcrResult, loadOcrText } from './drafts.js'
import type { Attachment, BabyEventType, DraftNote, OcrStatus } from './types.js'

export type DraftAttachmentEvidence = {
  attachmentId: string
  filename: string
  type: string
  url: string
  ocrStatus: OcrStatus | 'partial' | 'missing'
  ocrLines: string[]
}

export type DraftReviewEvidence = {
  usefulVlmFacts: string[]
  discardedVlmFacts: string[]
  suggestedTitle: string | null
  suggestedType: BabyEventType | null
  suggestedSummary: string
  suggestedFacts: string[]
  attachments: DraftAttachmentEvidence[]
}

const MEDICAL_KEYWORDS = [
  'HCG', '孕酮', '雌二醇', 'TSH', '促甲状腺', '甲状腺', '超声', '胎心', '胎动', '头臀', '胚囊',
  '卵黄囊', 'NT', '白带', '生化', '维生素', '乙肝', 'HIV', '梅毒', '风疹', '巨细胞',
  '弓形虫', '疱疹', 'ABO', 'Rh', '检验', '检查', '报告', '结果', '项目',
]

const CONFIRMABLE_FACT_KEYWORDS = [
  'HCG', '孕酮', '雌二醇', 'TSH', '促甲状腺', '甲状腺', '超声', '胎心', '胎动', '头臀', '胚囊',
  '卵黄囊', 'NT', '白带', '生化', '维生素', '乙肝', 'HIV', '梅毒', '风疹', '巨细胞',
  '弓形虫', '疱疹', 'ABO', 'Rh', '检验时间', '报告时间', '标本接收时间', '日期',
]

export function isUsefulVlmFact(fact: string): boolean {
  const text = fact.trim()
  if (text.length < 4) return false
  if (/^(?:1234567890|0123456789|abcdefghijklmnopqrstuvwxyz)$/i.test(text.replace(/\s/g, ''))) return false
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false
  return MEDICAL_KEYWORDS.some((kw) => text.toLowerCase().includes(kw.toLowerCase()))
}

export function extractOcrKeyLines(text: string, maxLines = 10): string[] {
  const rawLines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4)

  const candidates: string[] = []
  for (const line of rawLines) {
    if (isUsefulOcrLine(line)) {
      candidates.push(line.slice(0, 180))
    }
  }

  if (candidates.length === 0 && rawLines.length > 0) {
    candidates.push(...rawLines.slice(0, 3).map((line) => line.slice(0, 180)))
  }

  return dedupe(candidates).slice(0, maxLines)
}

export function buildDraftReviewEvidence(draft: DraftNote, attachments: Attachment[]): DraftReviewEvidence {
  const attachmentById = new Map(attachments.map((a) => [a.attachmentId, a]))
  const attachmentEvidence: DraftAttachmentEvidence[] = []
  const allLines: string[] = []
  const allTextParts: string[] = []

  for (const attachmentId of draft.attachmentIds) {
    const attachment = attachmentById.get(attachmentId)
    if (!attachment) continue

    const ocrResult = loadOcrResult(attachmentId)
    const ocrText = loadOcrText(attachmentId) || ''
    const ocrLines = extractOcrKeyLines(ocrText)
    allLines.push(...ocrLines)
    if (ocrText) allTextParts.push(ocrText)

    attachmentEvidence.push({
      attachmentId,
      filename: attachment.originalFilename,
      type: attachment.type,
      url: `/api/attachments/${encodeURIComponent(attachmentId)}/file`,
      ocrStatus: ocrResult?.status || 'missing',
      ocrLines,
    })
  }

  const usefulVlmFacts = (draft.extractedFacts || []).filter(isUsefulVlmFact)
  const discardedVlmFacts = (draft.extractedFacts || []).filter((fact) => !isUsefulVlmFact(fact))
  const fullText = allTextParts.join('\n')
  const suggestedType = inferTypeFromText(fullText, draft.inferredType)
  const suggestedTitle = inferTitleFromText(draft.inferredDate, fullText, suggestedType)
  const suggestedFacts = dedupe([
    ...usefulVlmFacts,
    ...allLines.filter(isConfirmableFactLine),
  ]).slice(0, 16)
  const suggestedSummary = suggestedFacts.slice(0, 5).join('；')

  return {
    usefulVlmFacts,
    discardedVlmFacts,
    suggestedTitle,
    suggestedType,
    suggestedSummary,
    suggestedFacts,
    attachments: attachmentEvidence,
  }
}

function isUsefulOcrLine(line: string): boolean {
  if (/^[\d\s:.,，。/_\-]+$/.test(line)) return false
  if (/(20\d{2}[.\-/年]\d{1,2}[.\-/月]\d{1,2})/.test(line)) return true
  return MEDICAL_KEYWORDS.some((kw) => line.toLowerCase().includes(kw.toLowerCase()))
}

function isConfirmableFactLine(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  if (/报告详情|报告机构|检验报告单|NO\s*项目|项目\/单位|此报告仅对|仅供临床医生参考|联系电话|地址：/.test(text)) {
    return false
  }
  if (/(20\d{2}[.\-/年]\d{1,2}[.\-/月]\d{1,2})/.test(text)) return true
  if (/[<>]?\d/.test(text) && CONFIRMABLE_FACT_KEYWORDS.some((kw) => text.toLowerCase().includes(kw.toLowerCase()))) {
    return true
  }
  if (/阴性|阳性|可及|未及|正常|异常/.test(text) && CONFIRMABLE_FACT_KEYWORDS.some((kw) => text.toLowerCase().includes(kw.toLowerCase()))) {
    return true
  }
  return false
}

function inferTypeFromText(text: string, fallback: BabyEventType | null): BabyEventType {
  if (/孕|胎心|胎动|头臀|胚囊|卵黄囊|NT|产前|HCG|孕酮|雌二醇|孕检/.test(text)) {
    return 'pregnancy_checkup'
  }
  return fallback || 'medical_record'
}

function inferTitleFromText(date: string | null, text: string, type: BabyEventType | null): string | null {
  const prefix = date ? `${date} ` : ''
  const hasUltrasound = /超声|胎心|胎动|头臀|胚囊|卵黄囊|NT/.test(text)
  const hasHormone = /HCG|孕酮|雌二醇|绒毛膜促性腺激素/.test(text)
  const hasThyroid = /TSH|促甲状腺|甲状腺/.test(text)
  const hasBiochem = /生化|白带|维生素D|乙肝|HIV|梅毒|风疹|巨细胞|弓形虫|疱疹|ABO|Rh/.test(text)

  if (hasUltrasound && hasHormone) return `${prefix}早孕血检+超声`
  if (hasUltrasound) return `${prefix}早孕超声`
  if (hasHormone && hasThyroid) return `${prefix}早孕血检+甲功`
  if (hasHormone) return `${prefix}早孕血检`
  if (hasBiochem) return `${prefix}孕检化验`
  if (type === 'pregnancy_checkup') return `${prefix}孕检记录`
  if (type === 'medical_record') return `${prefix}医疗记录`
  return null
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const normalized = item.replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}
