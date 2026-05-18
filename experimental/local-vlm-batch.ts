/**
 * Local VLM Batch Test — 批量实验脚本
 * 支持单张图片或目录输入，输出每张图片的 JSON 结果、耗时、warnings。
 *
 * 用法:
 *   VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./experimental/samples/
 *   VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./single.png
 *   VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./samples/ --output experimental/output/
 *
 * 不写入 data/，不修改项目状态。
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// --- Config ---

const VLM_BASE_URL = process.env.VLM_BASE_URL || 'http://localhost:1234/v1'
const VLM_MODEL = process.env.VLM_MODEL
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS) || 120_000
const VLM_TEMPERATURE = Number(process.env.VLM_TEMPERATURE) || 0.1
const VLM_MAX_TOKENS = Number(process.env.VLM_MAX_TOKENS) || 2048

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

type BatchResult = {
  file: string
  success: boolean
  latencyMs: number
  draft: VlmDraftOutput | null
  validationWarnings: string[]
  error: string | null
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

// --- Image Helpers ---

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.heic'])

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase())
}

function collectImages(inputPath: string): string[] {
  const resolved = path.resolve(inputPath)
  const stat = statSync(resolved)

  if (stat.isFile()) {
    if (!isImageFile(resolved)) {
      console.error(`WARN: ${resolved} does not look like an image file`)
    }
    return [resolved]
  }

  if (stat.isDirectory()) {
    return readdirSync(resolved)
      .filter(f => isImageFile(f))
      .map(f => path.join(resolved, f))
      .sort()
  }

  return []
}

function imageToDataUrl(filePath: string): string {
  const buffer = readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

// --- VLM Call ---

async function callVlm(imagePath: string): Promise<BatchResult> {
  const startTime = Date.now()
  const fileName = path.basename(imagePath)

  try {
    const dataUrl = imageToDataUrl(imagePath)

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
      temperature: VLM_TEMPERATURE,
      max_tokens: VLM_MAX_TOKENS,
    }

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
      const latencyMs = Date.now() - startTime
      return { file: fileName, success: false, latencyMs, draft: null, validationWarnings: [], error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }

    const json = await res.json() as any
    const responseText: string = json.choices?.[0]?.message?.content || ''
    const latencyMs = Date.now() - startTime

    // Parse JSON
    let draft: VlmDraftOutput
    try {
      draft = JSON.parse(responseText)
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          draft = JSON.parse(match[0])
        } catch {
          return { file: fileName, success: false, latencyMs, draft: null, validationWarnings: [], error: `JSON parse failed. Raw: ${responseText.slice(0, 200)}` }
        }
      } else {
        return { file: fileName, success: false, latencyMs, draft: null, validationWarnings: [], error: `No JSON in response. Raw: ${responseText.slice(0, 200)}` }
      }
    }

    const validationWarnings = validate(draft)
    return { file: fileName, success: true, latencyMs, draft, validationWarnings, error: null }

  } catch (err: any) {
    const latencyMs = Date.now() - startTime
    const msg = err.name === 'AbortError' ? `Timeout after ${VLM_TIMEOUT_MS}ms` : err.message
    return { file: fileName, success: false, latencyMs, draft: null, validationWarnings: [], error: msg }
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2)
  const outputFlagIdx = args.indexOf('--output')
  let outputDir: string | null = null

  if (outputFlagIdx !== -1) {
    outputDir = args[outputFlagIdx + 1]
    if (!outputDir) {
      console.error('ERROR: --output requires a directory path')
      process.exit(1)
    }
    args.splice(outputFlagIdx, 2)
  }

  const inputPath = args[0]

  if (!inputPath) {
    console.error('Usage: npx tsx experimental/local-vlm-batch.ts <image-or-directory> [--output <dir>]')
    console.error('Example: VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./experimental/samples/')
    process.exit(1)
  }

  if (!VLM_MODEL) {
    console.error('ERROR: VLM_MODEL environment variable is required.')
    process.exit(1)
  }

  if (!existsSync(inputPath)) {
    console.error(`ERROR: Path does not exist: ${inputPath}`)
    process.exit(1)
  }

  const images = collectImages(inputPath)
  if (images.length === 0) {
    console.error('ERROR: No image files found.')
    process.exit(1)
  }

  // Validate output dir is not in data/
  if (outputDir) {
    const resolvedOutput = path.resolve(outputDir)
    if (resolvedOutput.includes('/data/')) {
      console.error('ERROR: Output directory must not be inside data/')
      process.exit(1)
    }
    if (!existsSync(resolvedOutput)) {
      mkdirSync(resolvedOutput, { recursive: true })
    }
  }

  console.log('=== Local VLM Batch Test ===')
  console.log(`Model: ${VLM_MODEL}`)
  console.log(`Endpoint: ${VLM_BASE_URL}/chat/completions`)
  console.log(`Temperature: ${VLM_TEMPERATURE}`)
  console.log(`Max tokens: ${VLM_MAX_TOKENS}`)
  console.log(`Timeout: ${VLM_TIMEOUT_MS}ms`)
  console.log(`Images: ${images.length}`)
  if (outputDir) console.log(`Output dir: ${outputDir}`)
  console.log('===\n')

  const results: BatchResult[] = []

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    console.log(`[${i + 1}/${images.length}] Processing: ${path.basename(img)}`)

    const result = await callVlm(img)
    results.push(result)

    if (result.success) {
      console.log(`  OK — ${result.latencyMs}ms`)
      if (result.validationWarnings.length > 0) {
        for (const w of result.validationWarnings) {
          console.log(`  ⚠ ${w}`)
        }
      }
    } else {
      console.log(`  FAIL — ${result.latencyMs}ms — ${result.error}`)
    }
    console.log()
  }

  // Summary
  console.log('=== Summary ===')
  const successes = results.filter(r => r.success)
  const failures = results.filter(r => !r.success)
  const avgLatency = successes.length > 0
    ? Math.round(successes.reduce((s, r) => s + r.latencyMs, 0) / successes.length)
    : 0

  console.log(`Total: ${results.length} | Pass: ${successes.length} | Fail: ${failures.length}`)
  console.log(`Avg latency (success): ${avgLatency}ms`)

  const allWarnings = successes.flatMap(r => r.validationWarnings)
  const medicalClaims = allWarnings.filter(w => w.includes('医学结论'))
  console.log(`Validation warnings: ${allWarnings.length} (medical claims: ${medicalClaims.length})`)

  // Write output
  if (outputDir) {
    const resolvedOutput = path.resolve(outputDir)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outFile = path.join(resolvedOutput, `batch-${timestamp}.json`)

    const output = {
      config: { model: VLM_MODEL, baseUrl: VLM_BASE_URL, temperature: VLM_TEMPERATURE, maxTokens: VLM_MAX_TOKENS },
      timestamp: new Date().toISOString(),
      summary: { total: results.length, pass: successes.length, fail: failures.length, avgLatencyMs: avgLatency },
      results,
    }

    writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8')
    console.log(`\nResults written to: ${outFile}`)
  }

  console.log('\nNOTE: This is a batch test only. No data was written to data/ directories.')
}

main()
