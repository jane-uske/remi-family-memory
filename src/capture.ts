import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { dataDir } from './paths.js'
import { loadProfile, getStage } from './profile.js'

// --- Types ---

export type CapturePayload = {
  text: string
  date?: string
  confirmedByParent: true
  source: 'remi'
}

export type CaptureStage = '孕期' | '已出生' | 'unknown'

export type StageGuardrailResult =
  | { blocked: false }
  | { blocked: true; reason: 'post_birth_content_during_pregnancy'; keywords: string[] }

export type CaptureResult =
  | { ok: true; noteId: string; filePath: string; message: string; lifecycle: 'captured_to_inbox' }
  | { ok: false; error: 'privacy_blocked' | 'not_confirmed' | 'write_failed' | 'stage_guardrail'; message: string }

// --- Intent Detection ---

const RECORD_INTENT_PATTERNS: RegExp[] = [
  /帮我记/,
  /记录一下/,
  /记一下/,
  /记下来/,
  /帮记一下/,
  /把.{0,10}记录/,
  /记住.{0,6}这/,
  /存档一下/,
  /留个记录/,
  /帮忙记/,
  /写进记忆/,
  /加到记忆/,
  /记到家庭记忆/,
]

export function detectRecordIntent(text: string): boolean {
  return RECORD_INTENT_PATTERNS.some((p) => p.test(text))
}

// --- Privacy Detection ---

const PRIVACY_BLOCK_PATTERNS: RegExp[] = [
  /不要给\s*AI\s*看/i,
  /私密/,
  /只给我看/,
  /别让\s*Remi.*说出来/i,
  /blocked_from_ai/i,
  /不让\s*AI/i,
  /不要\s*AI\s*知道/i,
]

export function detectPrivacyBlock(text: string): boolean {
  return PRIVACY_BLOCK_PATTERNS.some((p) => p.test(text))
}

// --- Stage-Aware Guardrail ---

const POST_BIRTH_MILESTONE_PATTERNS: { pattern: RegExp; keyword: string }[] = [
  { pattern: /翻身/, keyword: '翻身' },
  { pattern: /抬头/, keyword: '抬头' },
  { pattern: /坐[起了]/, keyword: '坐起' },
  { pattern: /[爬会]爬/, keyword: '爬行' },
  { pattern: /[站会]站/, keyword: '站立' },
  { pattern: /走路|学走|迈步/, keyword: '走路' },
  { pattern: /说话|开口|叫[妈爸]/, keyword: '说话' },
  { pattern: /长牙|出牙|冒牙/, keyword: '长牙' },
  { pattern: /上学|入[园学]|幼儿园/, keyword: '上学' },
  { pattern: /断奶|断[了]奶/, keyword: '断奶' },
  { pattern: /出生后.*疫苗|打.*疫苗/, keyword: '出生后疫苗' },
  { pattern: /辅食|加餐/, keyword: '辅食' },
]

export function getCurrentStage(): CaptureStage {
  const profile = loadProfile()
  if (!profile) return 'unknown'
  return getStage(profile)
}

export function checkStageGuardrail(text: string, stage?: CaptureStage): StageGuardrailResult {
  const currentStage = stage ?? getCurrentStage()
  if (currentStage !== '孕期') return { blocked: false }

  const matched: string[] = []
  for (const { pattern, keyword } of POST_BIRTH_MILESTONE_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(keyword)
    }
  }

  if (matched.length === 0) return { blocked: false }
  return { blocked: true, reason: 'post_birth_content_during_pregnancy', keywords: matched }
}

// --- Parent Quick Capture (owner-facing, direct from web UI) ---

export type ParentCapturePayload = {
  text: string
  date?: string
}

export function writeParentCapture(payload: ParentCapturePayload): CaptureResult {
  if (!payload.text || !payload.text.trim()) {
    return { ok: false, error: 'not_confirmed', message: '缺少记录内容。' }
  }

  if (detectPrivacyBlock(payload.text)) {
    return {
      ok: false,
      error: 'privacy_blocked',
      message: '检测到私密内容标记，请通过本地管理方式手动添加为 blocked_from_ai。',
    }
  }

  const guardrail = checkStageGuardrail(payload.text)
  if (guardrail.blocked) {
    return {
      ok: false,
      error: 'stage_guardrail',
      message: `当前阶段为孕期，内容包含出生后里程碑关键词（${guardrail.keywords.join('、')}），请确认是否正确。`,
    }
  }

  const noteId = nanoid()
  const date = payload.date || new Date().toISOString().slice(0, 10)
  const confirmedAt = new Date().toISOString()
  const filename = `${date}-parent-${noteId}.md`
  const inboxDir = path.join(dataDir(), 'inbox/notes')
  const filePath = path.join(inboxDir, filename)

  const title = payload.text.split(/[。！？\n]/)[0].slice(0, 50)

  const content = [
    '---',
    `date: ${date}`,
    'type: parent_note',
    'source: parent_web',
    `title: "${title}"`,
    'confirmedByParent: true',
    'capturedBy: parent',
    'captureSource: review_page',
    'captureStatus: captured_to_inbox',
    `confirmedAt: "${confirmedAt}"`,
    'reviewStatus: captured',
    'sensitivity: normal',
    '---',
    '',
    payload.text.trim(),
    '',
  ].join('\n')

  try {
    if (!existsSync(inboxDir)) {
      mkdirSync(inboxDir, { recursive: true })
    }
    writeFileSync(filePath, content, 'utf-8')
  } catch (e) {
    return {
      ok: false,
      error: 'write_failed',
      message: `写入失败: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const relativePath = path.relative(path.resolve('.'), filePath)
  return {
    ok: true,
    noteId,
    filePath: relativePath,
    message: '已记录到家庭记忆，运行 npm run sync 后生成正式记忆。',
    lifecycle: 'captured_to_inbox',
  }
}

// --- Write Inbox Note ---

export function writeInboxNote(payload: CapturePayload): CaptureResult {
  if (payload.confirmedByParent !== true) {
    return {
      ok: false,
      error: 'not_confirmed',
      message: '必须在用户确认后才能写入记录。',
    }
  }

  if (detectPrivacyBlock(payload.text)) {
    return {
      ok: false,
      error: 'privacy_blocked',
      message: '检测到私密内容标记，无法通过 Remi 记录。请通过本地管理方式手动添加为 blocked_from_ai。',
    }
  }

  const guardrail = checkStageGuardrail(payload.text)
  if (guardrail.blocked) {
    return {
      ok: false,
      error: 'stage_guardrail',
      message: `当前阶段为孕期，内容包含出生后里程碑关键词（${guardrail.keywords.join('、')}），请确认是否正确。`,
    }
  }

  const noteId = nanoid()
  const date = payload.date || new Date().toISOString().slice(0, 10)
  const confirmedAt = new Date().toISOString()
  const filename = `${date}-remi-${noteId}.md`
  const inboxDir = path.join(dataDir(), 'inbox/notes')
  const filePath = path.join(inboxDir, filename)

  const title = payload.text.split(/[。！？\n]/)[0].slice(0, 50)

  const content = [
    '---',
    `date: ${date}`,
    'type: parent_note',
    'source: remi',
    `title: "${title}"`,
    'confirmedByParent: true',
    'capturedBy: remi',
    'captureSource: websocket',
    'captureStatus: captured_to_inbox',
    `confirmedAt: "${confirmedAt}"`,
    'reviewStatus: captured',
    'sensitivity: normal',
    '---',
    '',
    payload.text,
    '',
  ].join('\n')

  try {
    if (!existsSync(inboxDir)) {
      mkdirSync(inboxDir, { recursive: true })
    }
    writeFileSync(filePath, content, 'utf-8')
  } catch (e) {
    return {
      ok: false,
      error: 'write_failed',
      message: `写入失败: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const relativePath = path.relative(path.resolve('.'), filePath)
  return {
    ok: true,
    noteId,
    filePath: relativePath,
    message: '已记录到家庭记忆收件箱，等待下次扫描处理。',
    lifecycle: 'captured_to_inbox',
  }
}
