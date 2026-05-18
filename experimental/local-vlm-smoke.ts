/**
 * Local VLM Smoke Test — 最小实验脚本
 * 读取本地图片 → 调用 LM Studio VLM → 输出 DraftNote JSON + validation warnings
 *
 * 用法: npx tsx experimental/local-vlm-smoke.ts ./sample.png
 *
 * 不写入任何 data 目录，不修改项目状态。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

// --- Config ---

const VLM_BASE_URL = process.env.VLM_BASE_URL || 'http://localhost:1234/v1'
const VLM_MODEL = process.env.VLM_MODEL
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS) || 120_000

// --- Types ---

type VlmDraftOutput = {
  inferredDate: string | null
  inferredType: string | null
  inferredTitle: string | null
  inferredSummary: string | null
  facts: string[]
  inferredTags: string[]
  uncertainFields: string[]
  warnings: string[]
  needsParentReview: boolean
}

// --- Prompt ---

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

// --- Validation ---

const VALID_EVENT_TYPES = new Set([
  'pregnancy_checkup', 'fetal_movement', 'birth', 'milestone',
  'parent_note', 'family_event', 'medical_record', 'vaccine',
  'growth_metric', 'photo_memory', 'voice_memory', 'video', 'system_event',
])

const BANNED_PATTERNS = [
  /很?健康/, /一切正常/, /没问题/, /无异常/,
  /不用担心/, /可以放心/, /诊断为/, /确诊/,
]

function validate(draft: VlmDraftOutput): string[] {
  const warnings: string[] = []

  if (draft.needsParentReview !== true) {
    draft.needsParentReview = true
    warnings.push('[VALIDATION] needsParentReview was not true, forced to true')
  }

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

  if (!Array.isArray(draft.facts)) draft.facts = []
  if (!Array.isArray(draft.uncertainFields)) draft.uncertainFields = []
  if (!Array.isArray(draft.warnings)) draft.warnings = []
  if (!Array.isArray(draft.inferredTags)) draft.inferredTags = []

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

// --- Main ---

async function main() {
  const imagePath = process.argv[2]

  if (!imagePath) {
    console.error('Usage: npx tsx experimental/local-vlm-smoke.ts <image-path>')
    console.error('Example: npx tsx experimental/local-vlm-smoke.ts ./sample.png')
    process.exit(1)
  }

  if (!VLM_MODEL) {
    console.error('ERROR: VLM_MODEL environment variable is required.')
    console.error('Example: VLM_MODEL=moondream2 npx tsx experimental/local-vlm-smoke.ts ./sample.png')
    process.exit(1)
  }

  const resolvedPath = path.resolve(imagePath)
  let imageBuffer: Buffer
  try {
    imageBuffer = readFileSync(resolvedPath)
  } catch {
    console.error(`ERROR: Cannot read image file: ${resolvedPath}`)
    process.exit(1)
  }

  const ext = path.extname(resolvedPath).toLowerCase().replace('.', '')
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  const base64 = imageBuffer.toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64}`

  console.log(`Image: ${resolvedPath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`)
  console.log(`Model: ${VLM_MODEL}`)
  console.log(`Endpoint: ${VLM_BASE_URL}/chat/completions`)
  console.log('---')

  const requestBody = {
    model: VLM_MODEL,
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

  let responseText: string
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS)

    const res = await fetch(`${VLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text()
      console.error(`ERROR: LM Studio returned ${res.status}`)
      console.error(body.slice(0, 500))
      if (res.status === 400 || res.status === 422) {
        console.error('\nModel does not appear to support vision input.')
        console.error('Please load a VLM model (e.g. moondream2, llava-1.6) in LM Studio.')
      }
      process.exit(1)
    }

    const json = await res.json() as any
    responseText = json.choices?.[0]?.message?.content || ''
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error(`ERROR: Request timed out after ${VLM_TIMEOUT_MS}ms`)
    } else {
      console.error(`ERROR: Failed to connect to LM Studio at ${VLM_BASE_URL}`)
      console.error(err.message)
    }
    process.exit(1)
  }

  console.log('Raw VLM output:')
  console.log(responseText.slice(0, 1000))
  console.log('---')

  // Parse JSON
  let draft: VlmDraftOutput
  try {
    draft = JSON.parse(responseText)
  } catch {
    // Try to extract first JSON object
    const match = responseText.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        draft = JSON.parse(match[0])
      } catch {
        console.error('ERROR: Failed to parse VLM output as JSON (even after extraction attempt)')
        console.error('First 200 chars:', responseText.slice(0, 200))
        process.exit(1)
      }
    } else {
      console.error('ERROR: VLM output contains no JSON object')
      console.error('First 200 chars:', responseText.slice(0, 200))
      process.exit(1)
    }
  }

  // Validate
  const validationWarnings = validate(draft)

  console.log('Parsed DraftNote:')
  console.log(JSON.stringify(draft, null, 2))
  console.log('---')

  if (validationWarnings.length > 0) {
    console.log('Validation Warnings:')
    for (const w of validationWarnings) {
      console.log(`  ⚠ ${w}`)
    }
  } else {
    console.log('Validation: PASS (no warnings)')
  }

  console.log('---')
  console.log('NOTE: This is a smoke test only. Output was NOT written to any data directory.')
}

main()
