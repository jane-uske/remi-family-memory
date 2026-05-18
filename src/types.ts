export const SCHEMA_VERSION = '0.6.0'

// --- Event Types ---

export type BabyEventType =
  | 'pregnancy_checkup'
  | 'fetal_movement'
  | 'birth'
  | 'milestone'
  | 'parent_note'
  | 'family_event'
  | 'medical_record'
  | 'vaccine'
  | 'growth_metric'
  | 'photo_memory'
  | 'voice_memory'
  | 'video'
  | 'system_event'

export const EVENT_TYPE_LABELS: Record<BabyEventType, string> = {
  pregnancy_checkup: '孕检',
  fetal_movement: '胎动',
  birth: '出生',
  milestone: '里程碑',
  parent_note: '父母手记',
  family_event: '家庭事件',
  medical_record: '医疗记录',
  vaccine: '疫苗',
  growth_metric: '成长指标',
  photo_memory: '照片记忆',
  voice_memory: '语音记忆',
  video: '视频',
  system_event: '系统事件',
}

// --- Attachment ---

export type AttachmentType = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'other'

export type Attachment = {
  attachmentId: string
  eventId?: string
  type: AttachmentType
  originalFilename: string
  storedPath: string
  mimeType: string
  size: number
  sha256: string
  description?: string
  createdAt: string
  importedAt: string
  schemaVersion: string
}

// --- Baby Event ---

export type BabyEvent = {
  id: string
  childId: string
  schemaVersion?: string

  occurredAt: string
  type: BabyEventType

  title: string
  summary?: string

  source: {
    kind: 'manual' | 'folder' | 'photo' | 'video' | 'voice' | 'document' | 'system'
    path?: string
    externalId?: string
  }

  attachmentIds?: string[]

  people: string[]
  tags: string[]

  sensitivity: 'normal' | 'family_private' | 'medical' | 'blocked_from_ai'

  confirmedByParent: boolean

  createdAt: string
  updatedAt: string
}

// --- Baby Profile ---

export type ParentInfo = {
  role: 'father' | 'mother' | 'other'
  name: string
  nickname?: string
}

export type BabyProfile = {
  schemaVersion?: string
  babyId: string
  nickname: string
  familyName?: string
  expectedBirthDate: string
  pregnancyStartDate?: string
  gestationalAgeBaseline?: {
    weeks: number
    date: string
  }
  parents: ParentInfo[]
  createdAt: string
  updatedAt: string
}

// --- Report ---

export type MonthlyReport = {
  schemaVersion?: string
  month: string
  totalEvents: number
  milestones: BabyEvent[]
  checkups: BabyEvent[]
  parentNotes: BabyEvent[]
  otherEvents: BabyEvent[]
  generatedAt: string
}

// --- Memory Record (AI-readable) ---

export type MemoryImportance = 'low' | 'medium' | 'high' | 'core'

export type MemoryRecord = {
  memoryId: string
  sourceEventId: string
  schemaVersion: string

  date: string
  type: BabyEventType
  importance: MemoryImportance

  subjectIds: string[]
  people: string[]

  title: string
  summary: string
  facts: string[]
  emotions?: string[]
  tags: string[]

  attachmentIds?: string[]
  sourceRefs: {
    eventId: string
    path?: string
  }[]

  createdAt: string
  updatedAt: string
}

// --- Search ---

export type SearchResult = {
  type: 'event' | 'report' | 'attachment' | 'memory'
  date: string
  eventType?: string
  title: string
  matchedText: string
  sourcePath?: string
  importance?: MemoryImportance
  memoryId?: string
  sourceEventId?: string
}
