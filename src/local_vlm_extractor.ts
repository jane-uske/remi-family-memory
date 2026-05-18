export type VlmConfig = {
  baseUrl: string
  model: string
  timeoutMs: number
}

export type VlmDraftOutput = {
  inferredDate: string | null
  inferredType: string | null
  inferredTitle: string | null
  inferredSummary: string | null
  facts: string[]
  inferredTags: string[]
  uncertainFields: string[]
  warnings: string[]
  needsParentReview: true
}

export type VlmResult =
  | { ok: true; output: VlmDraftOutput; validationWarnings: string[]; rawResponseLength: number }
  | { ok: false; reason: 'no_model' | 'connection_refused' | 'timeout' | 'http_error' | 'parse_error'; message: string }

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const SYSTEM_PROMPT = `你是一个家庭记录提取助手。你的任务是从图片中提取结构化信息，生成 JSON 草稿。

严格规则：
1. 你只能生成待确认草稿（needsParentReview 必须为 true）。
2. 你不能做任何医学诊断。
3. 你绝对不能说"宝宝很健康"、"一切正常"、"没问题"、"无需担心"等结论性表达。
4. 如果某项内容看不清或无法确定，必须将对应字段名加入 uncertainFields。
5. facts 只能包含从图片中直接可见的文字/数值，不能包含推断。
6. 你只能输出纯 JSON，不能输出 Markdown、解释文字或任何 JSON 以外的内容。
7. 如果图片无法识别或不是医疗/育儿相关内容，返回所有字段为 null/空，warnings 写明原因。

输出格式（严格遵循）：
{
  "inferredDate": "ISO date 或 null",
  "inferredType": "pregnancy_checkup|fetal_movement|birth|milestone|parent_note|family_event|medical_record|vaccine|growth_metric|photo_memory|voice_memory|video|system_event 或 null",
  "inferredTitle": "简短标题 或 null",
  "inferredSummary": "1-2句客观描述 或 null",
  "facts": ["从图片直接可见的文字/数值"],
  "inferredTags": ["标签"],
  "uncertainFields": ["不确定的字段名"],
  "warnings": ["需要家长注意的信息"],
  "needsParentReview": true
}`

const USER_PROMPT = '请从这张图片中提取结构化信息，只输出 JSON。'

const VALID_EVENT_TYPES = new Set([
  'pregnancy_checkup', 'fetal_movement', 'birth', 'milestone',
  'parent_note', 'family_event', 'medical_record', 'vaccine',
  'growth_metric', 'photo_memory', 'voice_memory', 'video', 'system_event',
])

const BANNED_PATTERNS = [
  /很?健康/, /一切正常/, /没问题/, /无异常/,
  /不用担心/, /可以放心/, /诊断为/, /确诊/,
]

const MAX_IMAGE_SIZE = 10 * 1024 * 1024

export function getVlmConfig(): VlmConfig | null {
  const model = process.env.VLM_MODEL
  if (!model) return null
  return {
    baseUrl: process.env.VLM_BASE_URL || 'http://localhost:1234/v1',
    model,
    timeoutMs: Number(process.env.VLM_TIMEOUT_MS) || 120_000,
  }
}

export function validateVlmOutput(draft: VlmDraftOutput): string[] {
  const warnings: string[] = []

  if (draft.needsParentReview !== true) {
    (draft as any).needsParentReview = true
    warnings.push('[VALIDATION] needsParentReview was not true, forced to true')
  }

  if (!Array.isArray(draft.facts)) draft.facts = []
  if (!Array.isArray(draft.uncertainFields)) draft.uncertainFields = []
  if (!Array.isArray(draft.warnings)) draft.warnings = []
  if (!Array.isArray(draft.inferredTags)) draft.inferredTags = []

  if (draft.inferredType && !VALID_EVENT_TYPES.has(draft.inferredType)) {
    warnings.push(`[VALIDATION] inferredType "${draft.inferredType}" is not a valid BabyEventType, set to null`)
    draft.inferredType = null
    if (!draft.uncertainFields.includes('inferredType')) {
      draft.uncertainFields.push('inferredType')
    }
  }

  if (draft.inferredDate && !/^\d{4}-\d{2}-\d{2}/.test(draft.inferredDate)) {
    warnings.push(`[VALIDATION] inferredDate "${draft.inferredDate}" is not valid ISO date, set to null`)
    draft.inferredDate = null
    if (!draft.uncertainFields.includes('inferredDate')) {
      draft.uncertainFields.push('inferredDate')
    }
  }

  const textToScan = [
    draft.inferredSummary || '',
    ...draft.facts,
    ...draft.warnings,
  ].join(' ')

  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(textToScan)) {
      warnings.push(`[VALIDATION] 检测到医学结论化表达 (${pattern.source})，已标记`)
    }
  }

  if (draft.uncertainFields.length === 0) {
    const shouldBeUncertain =
      draft.inferredDate === null ||
      draft.inferredType === null ||
      draft.facts.length === 0 ||
      /可能|疑似|不确定|unclear|maybe/.test(draft.inferredSummary || '')

    if (shouldBeUncertain) {
      warnings.push('[VALIDATION] uncertainFields 为空但内容存在不确定性，建议家长仔细核对')
    }
  }

  return warnings
}

function parseVlmResponse(responseText: string): VlmDraftOutput | null {
  try {
    return JSON.parse(responseText) as VlmDraftOutput
  } catch {
    const match = responseText.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0]) as VlmDraftOutput
      } catch {
        return null
      }
    }
    return null
  }
}

export async function callVlm(
  imageBuffer: Buffer,
  mimeType: string,
  config: VlmConfig,
  fetchFn?: FetchFn,
): Promise<VlmResult> {
  if (imageBuffer.length > MAX_IMAGE_SIZE) {
    return { ok: false, reason: 'parse_error', message: `Image too large (${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB > 10MB limit)` }
  }

  const base64 = imageBuffer.toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64}`

  const requestBody = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  }

  const doFetch = fetchFn || fetch
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs)

  let responseText: string
  try {
    const res = await doFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutHandle)

    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: 'http_error', message: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }

    const json = await res.json() as any
    responseText = json.choices?.[0]?.message?.content || ''
  } catch (err: any) {
    clearTimeout(timeoutHandle)

    if (err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `Request timed out after ${config.timeoutMs}ms` }
    }
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.cause?.code === 'ECONNREFUSED') {
      return { ok: false, reason: 'connection_refused', message: `Cannot connect to VLM at ${config.baseUrl}` }
    }
    return { ok: false, reason: 'connection_refused', message: `Network error: ${err.message}` }
  }

  const draft = parseVlmResponse(responseText)
  if (!draft) {
    return { ok: false, reason: 'parse_error', message: `Failed to parse VLM response: ${responseText.slice(0, 200)}` }
  }

  const validationWarnings = validateVlmOutput(draft)

  return {
    ok: true,
    output: draft,
    validationWarnings,
    rawResponseLength: responseText.length,
  }
}
