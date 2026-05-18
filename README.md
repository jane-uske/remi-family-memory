# Remi Family Memory

> A local-first family memory system — from archive to **AI-readable memory layer** to **Local Memory Service** to **Grounded Answer Protocol**.

## What This Is

This is **not** a baby tracker app, photo album, or AI chatbot.

This is a **local-first, private, long-term family memory operating system** that:

- Captures life events from pregnancy onwards into a structured, versioned timeline
- Archives media files with SHA256 integrity verification
- **Derives AI-readable memory records** from raw events (MemoryRecord)
- **Generates context packs** that Remi/AI can load directly
- **Serves a local HTTP API** for Remi/AI to query family memory
- **Enforces grounded answers** — every AI response must cite real records, never fabricate
- Stores everything locally as files you own forever — no cloud, no database
- Provides health checks, full-text search, and portable exports

### v0.6: Grounded Answer Protocol

v0.6 defines and enforces a strict answer protocol: AI responses about family memories must be **evidence-based, source-traced, and refusal-safe**.

| Layer | Purpose | Format |
|-------|---------|--------|
| **Events** | Raw structured records (source of truth) | `BabyEvent` JSON |
| **Memories** | AI-derived cards with importance, facts, summaries | `MemoryRecord` JSON |
| **Context** | Pre-built pack for Remi/AI to load | Markdown + JSON |
| **Service** | HTTP API for reading, searching, rebuilding memory | REST JSON |
| **Connector** | Remi integration client with source tracing + degradation | TypeScript module |
| **Protocol** | Grounded Answer rules: evidence required, refusal on no data | `GroundedAnswer` |

**Architecture evolution:**

```
v0.2: Events (archive)
v0.3: Events → Memories → Context (AI-readable)
v0.4: Events → Memories → Context → Service (AI-queryable)
v0.5: Events → Memories → Context → Service → Connector (AI-consumable, verified)
v0.6: Events → Memories → Context → Service → Connector → Protocol (grounded, auditable)
```

## Commands

```bash
npm run scan              # Scan inbox (notes + assets)
npm run scan-assets       # Scan assets inbox only
npm run report [YYYY-MM]  # Generate monthly report
npm run build-memory      # Build AI memory records from events
npm run context           # Generate Remi context pack
npm run search -- <kw>    # Search events, memories, reports, attachments
npm run serve             # Start local memory service (API + web)
npm run dev               # Scan + serve
npm run export            # Export full portable archive
npm run doctor            # Run data health check
npm run connector         # Run Remi Connector verification demo
npm run connector:degradation  # Test service-unavailable behavior
```

## Quick Start

```bash
npm install

# 1. Add notes to inbox
echo '---
date: 2026-05-15
type: pregnancy_checkup
people: [妈妈, 爸爸]
tags: [孕检, 16周]
---
# 16周孕检
一切正常。' > data/inbox/notes/checkup.md

# 2. Drop media into assets inbox
cp ultrasound.jpg data/inbox/assets/

# 3. Process everything
npm run scan

# 4. Build AI memory layer
npm run build-memory
npm run context

# 5. Start local memory service
npm run serve

# 6. Run Remi Connector verification
npm run connector

# 7. Check system health
npm run doctor
```

## Remi Connector

### What It Does

The Remi Connector (`src/connector.ts`) is the verified integration layer between Remi/AI and the family memory service. It provides:

1. **Context loading** — Remi loads the full family memory context on startup
2. **On-demand search** — Remi queries specific memories when users ask questions
3. **Source-traced answers** — Every answer includes `memoryId`, `sourceEventId`, or `date` for traceability
4. **Privacy enforcement** — `blocked_from_ai` content never reaches Remi
5. **Graceful degradation** — When the service is down, Remi reports unavailability without fabricating

### How Remi Uses the Connector

```typescript
import { RemiConnector } from './connector.js'

const connector = new RemiConnector('http://localhost:3456')

// 1. Connect and check health
const { ok } = await connector.connect()
if (!ok) {
  // Degradation: don't answer family questions
}

// 2. Load context (startup)
const ctx = await connector.loadContext()
// ctx.context contains: profile, coreMemories, highMemories, recentEvents

// 3. Answer user questions (on demand)
const answer = await connector.answer('宝宝第一次胎动是什么时候？')
// answer.answer: "根据家庭记忆记录：2026-05-10，..."
// answer.sources: [{ memoryId, date, title }]
// answer.confident: true
// answer.serviceStatus: 'connected'
```

### Answer Format

Every connector answer includes:

```typescript
{
  question: string       // The user's question
  answer: string         // Answer based on real records (never fabricated)
  sources: [{            // Traceable sources
    type: 'memory' | 'event' | 'context' | 'search'
    memoryId?: string
    sourceEventId?: string
    date?: string
    title?: string
  }]
  confident: boolean     // false = no matching records found
  serviceStatus: 'connected' | 'degraded' | 'unavailable'
}
```

### Degradation Behavior

When the family-memory service is unavailable:

| Situation | Behavior |
|-----------|----------|
| Service unreachable | `serviceStatus: 'unavailable'`, `confident: false` |
| Answer attempt | Returns "家庭记忆服务暂不可用" — never fabricates |
| Search attempt | Returns `ok: false` with clear error message |
| Context load attempt | Returns `ok: false`, no stale data used |

### Privacy Protection

The connector inherits all privacy layers:

1. **Memory layer**: `blocked_from_ai` events are never converted to MemoryRecords
2. **Context layer**: Context pack only includes memories (never raw blocked events)
3. **Search API**: Filters blocked events from search results
4. **Connector**: Only consumes API data — cannot access raw files

### Running the Verification

```bash
# Start the service first
npm run serve

# In another terminal — run full verification
npm run connector

# Test degradation (no service needed)
npm run connector:degradation
```

### Current Limitations (v0.5)

- Connector uses deterministic template matching, not a real LLM
- Answer quality depends on keyword extraction (not semantic understanding)
- This is a **verification layer**, not a production Remi plugin
- Future versions will replace the template engine with actual Remi integration

## Grounded Answer Protocol (v0.6)

### What It Solves

When AI answers questions about family memories, it must **never fabricate**. The Grounded Answer Protocol enforces:

1. **Evidence required** — No answer without real data backing it
2. **Refusal on no data** — "I don't know" when records don't exist
3. **Partial confidence** — When evidence is incomplete, say so explicitly
4. **Source tracing** — Every fact traces to memoryId / sourceEventId
5. **Privacy enforcement** — blocked_from_ai never enters evidence
6. **Graceful degradation** — Service down = explicit refusal, not hallucination

### GroundedAnswer Structure

```typescript
{
  question: string          // What was asked
  answerable: boolean       // true only when evidence exists
  answer: string            // Based on evidence, or refusal message
  confidence: Confidence    // 'high' | 'medium' | 'low' | 'none'
  reason: string            // 'evidence_found' | 'no_evidence' | 'partial_evidence' | 'service_unavailable'
  sources: [{               // Traceable references
    memoryId?: string
    sourceEventId?: string
    date?: string
    title?: string
    path?: string
  }]
  evidence: EvidencePack    // All evidence considered
  serviceStatus: ConnectorStatus
  generatedAt: string
}
```

### EvidencePack Structure

```typescript
{
  query: string             // Original question
  items: [{                 // Evidence items collected
    source: 'memory' | 'event' | 'context' | 'search' | 'report'
    memoryId?: string
    sourceEventId?: string
    date?: string
    title?: string
    path?: string
    snippet: string         // Relevant text excerpt
    importance?: MemoryImportance
  }]
  fromContext: boolean      // Was context pack consulted?
  fromSearch: boolean       // Was search API used?
  collectedAt: string
}
```

### Answer Decision Logic

```
Question received
  → Collect evidence (context + search)
  → Filter for relevance
  │
  ├─ 0 items + broad question → partial_evidence (confidence=low)
  ├─ 0 items + specific question → no_evidence (answerable=false)
  ├─ Items found + broad question → partial_evidence (confidence=low)
  └─ Items found + specific question → evidence_found (confidence=high/medium)
```

### Refusal Examples

| Question | Response | Reason |
|----------|----------|--------|
| 宝宝出生当天发生了什么？ | 当前家庭记忆库里没有找到相关记录 | no_evidence |
| 宝宝第一次说话是什么时候？ | 当前家庭记忆库里没有找到相关记录 | no_evidence |
| 宝宝喜欢什么颜色？ | 当前家庭记忆库里没有找到相关记录 | no_evidence |

### Partial Evidence Examples

| Question | Response | Reason |
|----------|----------|--------|
| 宝宝最近身体状态怎么样？ | 目前只找到 N 条相关记录...不能据此完整回答 | partial_evidence |

## Prompt Contract (Future LLM Integration)

This section defines the rules that any LLM integration **must** follow when answering family memory questions. This is the contract between family-memory and Remi.

### Rules

1. **Evidence-only answers**: LLM may ONLY generate answers based on the provided evidence pack. No knowledge from training data about this family.

2. **Mandatory refusal**: If evidence pack is empty, LLM MUST respond with a refusal. No guessing, no "based on typical families..." responses.

3. **Source citation**: Every factual claim in the answer MUST reference at least one source from the evidence pack (memoryId or sourceEventId).

4. **No extrapolation**: LLM may NOT extend a single record into a broad conclusion. "16周孕检正常" does NOT mean "宝宝一直很健康".

5. **Confidence honesty**: If evidence is partial or indirect, the answer MUST say so. Use phrases like "根据目前仅有的记录..." or "只找到一条相关记录...".

6. **Privacy boundary**: LLM never sees `blocked_from_ai` content. This is enforced at the service layer, not the prompt layer.

7. **Degradation protocol**: If service is unavailable, LLM MUST respond "家庭记忆服务暂不可用" — not attempt to answer from cached/stale data.

8. **No creative additions**: LLM may NOT add emotional flourishes, predictions, or advice that aren't grounded in evidence. "爸爸一定很开心" is only valid if a record says so.

9. **Temporal accuracy**: LLM must respect dates in evidence. Do NOT conflate "2026-05-10 first fetal movement" with "baby is very active" (a general claim).

10. **Audit trail**: The GroundedAnswer structure is the audit trail. Any answer that passes `answerable=true` without sources is a protocol violation.

### Prompt Template (Reference)

When integrating with a real LLM, the prompt should follow this structure:

```
你是 Remi，一个家庭记忆助手。

## 规则
- 你只能基于下面的 evidence pack 回答家庭相关问题
- 如果 evidence pack 为空，你必须说"没有找到相关记录"
- 每个事实都必须引用来源（memoryId 或日期）
- 不要编造、不要猜测、不要外推
- 如果证据不足以完整回答，明确说明

## Evidence Pack
{evidence_pack_json}

## 用户问题
{question}

## 回答要求
- 基于证据回答
- 引用来源
- 不确定时明确说明
```

### Verification

Run `npm run connector` to verify the protocol is enforced:

```
✓ 4/4 answerable questions with sources
✓ 4/4 refusal questions correctly refused
✓ 1/1 partial evidence correctly marked
✓ Privacy: blocked_from_ai clean
✓ Source tracing enforced
✓ Overall: ALL PASS
```

## Local Memory Service API

When the service is running (`npm run serve`), the following APIs are available at `http://localhost:3456`:

### Health Check

```
GET /api/health
```

Returns system health status. Use this to verify the service is running and data is intact.

```json
{
  "ok": true,
  "schemaVersion": "0.6.0",
  "service": "family-memory",
  "checks": {
    "events": "PASS",
    "profile": "PASS",
    "memories": "PASS",
    "context": "PASS",
    "archive": "PASS"
  },
  "updatedAt": "2026-05-18T00:00:00.000Z"
}
```

### Baby Profile

```
GET /api/profile
```

Returns current baby profile with gestational info and last event.

### Events

```
GET /api/events
```

Returns all events (chronological). Used by the timeline web UI.

### Memory Records (AI-facing)

```
GET /api/memories
GET /api/memories?importance=core
```

Returns AI-readable memory records. Optionally filter by importance level (`core`, `high`, `medium`, `low`).

```json
{
  "schemaVersion": "0.5.0",
  "total": 3,
  "memories": [...]
}
```

Privacy: memories are never generated from `blocked_from_ai` events.

### Remi Context Pack (AI-facing)

```
GET /api/context
GET /api/context?format=markdown
```

Returns the pre-built Remi context pack. Default format is JSON; pass `?format=markdown` for the markdown version.

This is the **primary integration point for Remi** — a single request loads the complete family memory context.

### Search

```
GET /api/search?q=胎动
```

Full-text search across events, memories, reports, and attachments. Returns matched results with context snippets.

```json
{
  "query": "胎动",
  "total": 2,
  "results": [
    { "type": "event", "date": "2026-05-10", "title": "第一次感受到胎动", ... },
    { "type": "memory", "date": "2026-05-10", "title": "第一次感受到胎动", ... }
  ]
}
```

Privacy: `blocked_from_ai` events are filtered from search results.

### Stats

```
GET /api/stats
```

Returns event counts by type, attachment counts.

### Attachments

```
GET /api/attachments
```

Returns attachment registry.

### Rebuild (Write operation)

```
POST /api/rebuild
```

Triggers a full rebuild of memory records and context pack from current events. This is the **only write operation** — all other APIs are read-only.

```json
{
  "ok": true,
  "memory": { "total": 3, "created": 0, "updated": 3 },
  "context": { "mdPath": "data/context/remi-context.md", "jsonPath": "data/context/remi-context.json" },
  "rebuiltAt": "2026-05-18T00:00:00.000Z"
}
```

## How Remi Should Integrate (Full Flow)

```
Remi starts a conversation
  → connector.connect()           // Check health
  → connector.loadContext()       // Load family memory into prompt
  → User asks about 胎动
  → connector.answer("...")       // Search + answer with sources
  → Remi returns answer with source references
  → If service unavailable → "家庭记忆服务暂不可用"
```

### Integration Flow Diagram

```
┌──────────────────────────────────┐
│           Remi / AI              │
│  (future: real LLM integration) │
└─────────────┬────────────────────┘
              │ uses
              ▼
┌──────────────────────────────────┐
│       RemiConnector (v0.5)       │
│  connect → loadContext → answer  │
│  source tracing + degradation    │
└─────────────┬────────────────────┘
              │ HTTP calls
              ▼
┌──────────────────────────────────┐
│   Local Memory Service (v0.4)    │
│   /api/health  /api/context      │
│   /api/memories  /api/search     │
│   /api/rebuild                   │
└─────────────┬────────────────────┘
              │ reads
              ▼
┌──────────────────────────────────┐
│     Three-Layer Memory (v0.3)    │
│  Events → Memories → Context     │
│  (blocked_from_ai filtered)      │
└──────────────────────────────────┘
```

## Data Flow

```
data/inbox/notes/*.md ──────────────────┐
data/inbox/assets/*   ──────────────────┤
                                        ▼
                               [Scanner + Parser]
                                        │
                                        ▼
              data/events/events.json        ←── Layer 1: Events (source of truth)
              data/events/attachments.json   ←── Attachment registry
              data/archive/assets/           ←── Archived media
                                        │
                                        ▼ (npm run build-memory)
              data/memory/memories.json      ←── Layer 2: AI Memory Records
                                        │
                                        ▼ (npm run context)
              data/context/remi-context.md   ←── Layer 3: Remi Context Pack
              data/context/remi-context.json
                                        │
                                        ▼ (npm run serve)
              http://localhost:3456/api/*    ←── Layer 4: Local Memory Service
                                        │
                                        ▼ (npm run connector)
              RemiConnector                 ←── Layer 5: Remi Integration
                                        │
                    ┌───────────────┬────┴────┬──────────────┐
                    ▼               ▼         ▼              ▼
             Web Timeline    Profile    Monthly Report    Remi / AI
              (/)        (/profile)  (npm run report)  (connector.answer)
```

## Data Models

### BabyEvent — What Happened (Layer 1)

The raw structured event. Source of truth for everything.

```typescript
{
  id, childId, schemaVersion,
  occurredAt, type, title, summary,
  source: { kind, path },
  attachmentIds,
  people, tags, sensitivity,
  confirmedByParent,
  createdAt, updatedAt
}
```

### MemoryRecord — What AI Knows (Layer 2)

Derived from BabyEvent. Enriched with importance, facts, context.

```typescript
{
  memoryId, sourceEventId, schemaVersion,
  date, type, importance,    // 'core' | 'high' | 'medium' | 'low'
  subjectIds, people,
  title, summary,
  facts: string[],           // Structured factual claims
  emotions?: string[],
  tags,
  attachmentIds,
  sourceRefs: [{ eventId, path }],
  createdAt, updatedAt
}
```

### Importance Levels

| Level | Event Types | Meaning |
|-------|------------|---------|
| `core` | fetal_movement, milestone, birth | Defining life moments |
| `high` | pregnancy_checkup, medical_record, vaccine | Health & development |
| `medium` | parent_note, photo_memory, family_event, voice_memory, growth_metric | Daily life & emotions |
| `low` | system_event | System-generated |

### ConnectorAnswer — What Remi Returns (Layer 5)

```typescript
{
  question: string
  answer: string              // Based on real records, never fabricated
  sources: AnswerSource[]     // Traceable: memoryId, sourceEventId, date
  confident: boolean          // false when no records found or service down
  serviceStatus: ConnectorStatus  // 'connected' | 'degraded' | 'unavailable'
}
```

## Privacy & Security

- **blocked_from_ai**: Events marked with this sensitivity are:
  - Never converted to MemoryRecords
  - Never included in Context Packs
  - Filtered from `/api/search` results
  - Not accessible via AI-facing APIs
  - Cannot appear in connector answers (verified in demo)
- **medical**: Included in memory but marked for careful handling
- **family_private**: Available to family but not for external sharing
- **normal**: Fully accessible

## Why Five Layers?

1. **Events are permanent** — raw data never changes meaning
2. **Memories are interpretive** — can be rebuilt, re-prioritized, enriched as AI improves
3. **Context is ephemeral** — regenerated on demand, shaped by what's relevant now
4. **Service is the interface** — stable contract for AI consumers, decoupled from internals
5. **Connector is the consumer** — proves the contract works end-to-end with source tracing

This separation means:
- You can rebuild memories without losing data
- AI improvements don't require data migration
- Context can be customized for different AI consumers
- Remi integrates without knowing file paths or data formats
- The service API is stable even as internals evolve
- Connector verification proves the chain works before production integration

## Directory Structure

```
remi-family-memory/
├── src/
│   ├── types.ts           # All type definitions + SCHEMA_VERSION
│   ├── parser.ts          # Markdown → BabyEvent
│   ├── store.ts           # Event store
│   ├── scanner.ts         # Notes inbox scanner
│   ├── attachments.ts     # Assets scanner + registry
│   ├── profile.ts         # Baby profile + gestational age
│   ├── memory.ts          # Event → MemoryRecord builder
│   ├── context.ts         # Remi context pack generator
│   ├── report.ts          # Monthly report generator
│   ├── search.ts          # Full-text search
│   ├── export.ts          # Full archive export
│   ├── doctor.ts          # Data health check
│   ├── server.ts          # Local Memory Service (Express API + static)
│   ├── connector.ts       # Remi Connector client (v0.5)
│   ├── connector-demo.ts  # Connector verification demo
│   └── cli.ts             # CLI entry point
├── web/
│   ├── index.html         # Timeline dashboard
│   └── profile.html       # Growth profile page
├── data/
│   ├── inbox/notes/       # Drop zone: markdown
│   ├── inbox/assets/      # Drop zone: media
│   ├── events/            # Layer 1: events + attachments
│   ├── memory/            # Layer 2: AI memory records
│   ├── context/           # Layer 3: Remi context pack
│   ├── archive/assets/    # Archived media (SHA256)
│   ├── profile/           # Baby profile
│   ├── processed/         # Processed inbox files
│   ├── reports/           # Monthly reports
│   └── exports/           # Portable exports
├── package.json
├── tsconfig.json
└── README.md
```

## Doctor Output

```
  Remi Family Memory — Health Check
  ==================================

  [PASS] Event store         — 3 events loaded
  [PASS] Baby profile        — 吴小宝
  [PASS] Attachment integrity — 1/1 SHA256 verified
  [PASS] Archive assets      — All 1 assets present
  [PASS] Memory records      — 3 memories for 3 events
  [PASS] Reports directory   — Exists
  [PASS] Context pack        — remi-context.md + .json present
  [PASS] Orphan attachments  — None
  [PASS] Orphan memories     — All memories have valid source events

  Summary: 9 PASS, 0 WARN, 0 FAIL
```

## Roadmap

### v0.7 — Real LLM Integration
- Replace template engine with actual LLM prompt integration
- Remi main project loads connector as a dependency
- LLM answers constrained by Prompt Contract
- Verify LLM follows refusal rules in practice

### v0.8 — Media Intelligence
- Photo EXIF extraction
- Voice memo transcription
- Document OCR
- Auto-event creation from media metadata

### v0.9 — Multi-child & Permissions
- Multiple child profiles
- Family member access control
- Shared vs private memories

### v1.0 — Production
- Docker/NAS deployment
- External integrations (Immich, Paperless-ngx, Baby Buddy)
- Long-term timeline visualization
- PDF/static-site export

## Design Principles

1. **Local-first**: All data is files you own. No cloud.
2. **Grounded answers**: Every AI response must cite real records. Never fabricate.
3. **Privacy by default**: Sensitivity levels, `blocked_from_ai` flag, filtered evidence packs.
4. **Schema-versioned**: Forward-compatible. Old data always readable.
5. **AI-ready today**: Connector + Protocol verified end-to-end.
6. **Long-term**: Built for 18+ years. Plain files, standard formats.
7. **Rebuildable**: Memories and context can always be regenerated from events.
8. **Read-first API**: Only one write endpoint (rebuild). Everything else is read-only.
9. **Source-traced**: Every confident answer traces back to a real record.
10. **Fail-safe**: No evidence = refuse. Service down = refuse. Never hallucinate.

## License

Private / Personal use.
