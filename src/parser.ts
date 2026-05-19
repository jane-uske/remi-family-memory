import matter from 'gray-matter'
import { nanoid } from 'nanoid'
import { SCHEMA_VERSION } from './types.js'
import type { BabyEvent, BabyEventType } from './types.js'

const VALID_TYPES: Set<string> = new Set([
  'pregnancy_checkup',
  'fetal_movement',
  'birth',
  'milestone',
  'parent_note',
  'family_event',
  'medical_record',
  'vaccine',
  'growth_metric',
  'photo_memory',
  'voice_memory',
  'video',
  'system_event',
])

export function parseMarkdownNote(
  content: string,
  sourcePath: string,
  childId: string = 'default',
): BabyEvent {
  const { data: frontmatter, content: body } = matter(content)

  const type = VALID_TYPES.has(frontmatter.type)
    ? (frontmatter.type as BabyEventType)
    : 'parent_note'

  const titleMatch = body.match(/^#\s+(.+)$/m)
  const title = frontmatter.title || (titleMatch ? titleMatch[1].trim() : 'Untitled')

  const summaryText = body
    .replace(/^#\s+.+$/m, '')
    .trim()
  const summary = summaryText || undefined

  const occurredAt = frontmatter.date
    ? new Date(frontmatter.date).toISOString()
    : new Date().toISOString()

  const people: string[] = Array.isArray(frontmatter.people)
    ? frontmatter.people
    : typeof frontmatter.people === 'string'
      ? frontmatter.people.split(',').map((s: string) => s.trim())
      : []

  const tags: string[] = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(',').map((s: string) => s.trim())
      : []

  const sensitivity = frontmatter.sensitivity || 'normal'

  const isRemiCapture = frontmatter.source === 'remi'
  const isAssetIntake = frontmatter.source === 'asset_intake'
  const source = isRemiCapture
    ? { kind: 'manual' as const, path: sourcePath, externalId: 'remi' }
    : isAssetIntake
      ? { kind: 'document' as const, path: sourcePath, externalId: 'asset_intake' }
      : { kind: 'folder' as const, path: sourcePath }

  const confirmedByParent = frontmatter.confirmedByParent === true

  const attachmentIds: string[] | undefined = Array.isArray(frontmatter.attachmentIds)
    ? frontmatter.attachmentIds
    : undefined

  const facts: string[] | undefined = Array.isArray(frontmatter.facts) && frontmatter.facts.length > 0
    ? frontmatter.facts
    : undefined

  const now = new Date().toISOString()

  return {
    id: nanoid(),
    childId,
    schemaVersion: SCHEMA_VERSION,
    occurredAt,
    type,
    title,
    summary,
    facts,
    source,
    attachmentIds,
    people,
    tags,
    sensitivity,
    confirmedByParent,
    createdAt: now,
    updatedAt: now,
  }
}
