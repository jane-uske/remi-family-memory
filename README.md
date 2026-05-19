# Remi Family Memory

[中文版](README.zh-CN.md)

**v1.9 Daily Flow + Trial** — stable for daily family use with Review UI, OCR, and quick capture.

> A local-first family memory system — capture, archive, and grounded AI retrieval for your family's story.

## What This Is

This is **not** a baby tracker app, photo album, or AI chatbot.

This is a **local-first, private, long-term family memory system** that:

- Captures life events from pregnancy onwards into a structured timeline
- Archives media files with SHA256 integrity verification
- Derives AI-readable memory records from raw events
- Generates context packs that Remi/AI can load directly
- Serves a local HTTP API for Remi to query and capture family memories
- Enforces grounded answers — every AI response cites real records, never fabricates
- Stores everything as local files you own forever — no cloud, no database

## Self-Use Guide (v1.9)

### How to Start

```bash
npm install
npm run dev     # Scan + start server on http://localhost:3456
```

Open **http://localhost:3456/review.html** — the daily Review page.

Remi connects via environment variables:

```bash
REMI_FAMILY_MEMORY_ENABLED=1
REMI_FAMILY_MEMORY_SERVICE_URL=http://localhost:3456
REMI_FAMILY_MEMORY_AI_TOKEN=<optional-token>
```

### How to Record

#### Quick Capture (Review page)

Open http://localhost:3456/review.html — type a one-line family event in the input box and press Enter.

#### Via Remi (conversation)

Tell Remi in natural language:

- "帮我记一下，今天第一次感受到胎动了"
- "记录一下，16周孕检一切正常"
- "帮忙记，爸爸今天给宝宝念了第一本书"

Remi detects the intent and extracts the content.

### How to Confirm

Remi shows you what it extracted and asks for confirmation:

```
好的，我将记录以下内容到家庭记忆：

「今天第一次感受到胎动了」

确认记录吗？（回复"确认"记录，"算了"取消）
```

Reply "确认" to save, "算了" to cancel. Confirmation expires after 5 minutes.

### How to Sync

After recording or confirming drafts, sync to update the AI memory:

```bash
npm run sync
```

Or click the **"同步刷新记忆"** button on the Review page.

This runs 4 steps: scan inbox → build memory → generate context → health check.

### How to Query

Ask Remi about your family memories:

- "宝宝第一次胎动是什么时候？"
- "最近一次孕检结果怎样？"
- "爸爸给宝宝写过什么？"

Remi answers based on real records with source tracing. No records = "当前家庭记忆库里没有找到相关记录" (never fabricates).

### How to Export

```bash
npm run export
```

Generates a complete portable archive under `data/exports/` with:
- All events, attachments, memories, reports, context, processed notes
- `README_export.md` with restore instructions

### How to Handle Private/Blocked Content

If content contains privacy markers ("不要给AI看", "私密", etc.), Remi refuses to record it:

> "这条内容包含私密标记，无法通过 Remi 记录。如需保存，请通过本地管理方式手动添加为 blocked_from_ai。"

To manually add private content, create a note in `data/inbox/notes/` with:

```yaml
---
sensitivity: blocked_from_ai
---
```

This content enters the event timeline but **never** reaches AI-facing layers (memories, context, search, or Remi).

### How to Import Photos / PDFs

Place files in `data/inbox/assets/` then run:

```bash
npm run scan-assets       # Register attachments
npm run intake-assets     # Create pending drafts + run OCR
```

Open the Review page to confirm or skip each draft.

### How to Confirm Drafts

On http://localhost:3456/review.html:

1. **Dashboard** shows pending count, OCR status
2. **Pending tab** lists drafts — add title/summary, then click "确认" or "跳过"
3. Click **"同步刷新记忆"** to finalize

### What's Currently Not Supported

- Voice / audio input
- NAS / Docker deployment
- Multi-child / multi-family
- Automatic media processing (auto-confirm)
- Complex permission system
- Local LLM integration (Ollama, llama.cpp)

## Commands

```bash
npm run dev               # Scan + serve (daily start)
npm run sync              # Daily workflow: scan + build-memory + context + doctor
npm run scan              # Scan inbox (notes + assets)
npm run scan-assets       # Scan assets inbox only
npm run intake-assets     # Create draft notes from unlinked attachments
npm run extract-ocr       # Re-run OCR for drafts missing sidecars
npm run enrich-drafts     # Enrich drafts with local VLM (needs VLM_MODEL)
npm run serve             # Start local memory service (port 3456)
npm run report [YYYY-MM]  # Generate monthly report
npm run build-memory      # Build AI memory records from events
npm run context           # Generate Remi context pack
npm run search -- <kw>    # Search events, memories, reports, attachments
npm run export            # Export full portable archive
npm run doctor            # Run data health check (17 checks)
npm run connector         # Run Remi Connector verification
npm run capture-demo      # Run capture-to-inbox smoke test
npm test                  # Run automated test suite (229 tests)
npm run build             # TypeScript compile
```

## Architecture

```
v0.2: Events (archive)
v0.3: Events → Memories → Context (AI-readable)
v0.4: Events → Memories → Context → Service (AI-queryable)
v0.5: Events → ... → Connector (AI-consumable)
v0.6: Events → ... → Protocol (grounded, auditable)
v0.7: Events → ... → Adapter (pluggable LLM)
v0.9: Events → ... + Capture API (Remi writes to inbox)
v1.0: Events → ... + Sync + Doctor + Export (self-use hardened)
v1.1: Events → ... + Image Drafts + OCR (asset intake pipeline)
v1.3: Events → ... + Provenance (source/evidence/confidence)
v1.4: Events → ... + Review UI (web-based confirmation)
v1.5: Events → ... + Daily Flow (dashboard, quick capture, filters)
v1.7: Events → ... + OCR Hardening (tesseract, PDF scan fallback)
v1.8: Events → ... + Web Sync + Trial Tracker
```

### Data Flow

```
                           ┌───────────────────────────┐
                           │   Remi (conversation)     │
                           │ "帮我记，今天第一次胎动了" │
                           └────────────┬──────────────┘
                                        │ POST /api/ai/capture
                                        ▼
data/inbox/notes/*.md ──────────────────┐
data/inbox/assets/*   ──────────────────┤
                                        ▼
                               [npm run sync]
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
         events/events.json    memory/memories.json  context/remi-context.*
         (Layer 1: truth)      (Layer 2: AI cards)   (Layer 3: AI context)
                                        │
                                        ▼
                               [npm run serve]
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
           /api/ai/context     /api/ai/search      /api/ai/answer
                    │                   │                   │
                    └───────────────────┼───────────────────┘
                                        ▼
                               ┌────────────────┐
                               │  Remi answers  │
                               │  with sources  │
                               └────────────────┘
```

### Capture Flow (v0.9+)

```
User: "帮我记，今天第一次胎动了"
  → Remi detects record intent
  → Privacy check (block if "私密" etc.)
  → Stage guardrail (warn if post-birth milestone during pregnancy)
  → Show extracted content, ask confirmation
  → User: "确认"
  → POST /api/ai/capture → data/inbox/notes/2026-05-18-remi-xxx.md
  → User runs: npm run sync
  → Note → Event → Memory → Context (available to Remi queries)
```

### Lifecycle States

```
captured_to_inbox → pending_ingestion → ingested_to_event → available_to_memory
```

## Data Layers

| Layer | Purpose | Format |
|-------|---------|--------|
| **Events** | Raw structured records (source of truth) | `BabyEvent` JSON |
| **Memories** | AI-derived cards with importance, facts, summaries | `MemoryRecord` JSON |
| **Context** | Pre-built pack for Remi/AI to load | Markdown + JSON |
| **Service** | HTTP API for reading, searching, capturing | REST JSON |
| **Connector** | Remi integration with source tracing + degradation | TypeScript module |
| **Protocol** | Grounded Answer rules: evidence required, refusal on no data | `GroundedAnswer` |

## Privacy & Security

- **blocked_from_ai**: Events with this sensitivity are:
  - Never converted to MemoryRecords
  - Never included in Context Packs
  - Filtered from search results
  - Not accessible via AI-facing APIs
  - Cannot be captured through Remi (privacy detection at intent time)
- **medical**: Included in memory but marked for careful handling
- **family_private**: Available to family but not for external sharing
- **normal**: Fully accessible

## Local Memory Service API

Service runs on `http://localhost:3456`.

### AI-Facing Endpoints (token-protected)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/health` | GET | AI health check |
| `/api/ai/context` | GET | Remi context pack (JSON or markdown) |
| `/api/ai/memories` | GET | Memory records (filterable by importance) |
| `/api/ai/search?q=` | GET | Search memories and events |
| `/api/ai/ask` | POST | Grounded answer with sources |
| `/api/ai/capture` | POST | Capture note to inbox (requires confirmation) |
| `/api/ai/stage` | GET | Current baby stage (孕期/已出生) |
| `/api/ai/rebuild` | POST | Rebuild memory + context |
| `/api/ai/drafts/pending` | GET | Pending drafts list |
| `/api/ai/drafts/:id/confirm` | POST | Confirm a draft |
| `/api/ai/drafts/:id/reject` | POST | Reject a draft |
| `/api/ai/drafts/:id/enrich` | POST | Enrich draft with VLM |
| `/api/ai/drafts/chat` | POST | Draft management chat interface |

### Owner-Facing Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Dashboard stats (pending, confirmed) |
| `/api/capture` | POST | Quick capture from Review page |
| `/api/sync` | POST | Run full sync pipeline |
| `/api/profile` | GET | Baby profile |
| `/api/events` | GET | All events (timeline) |
| `/api/memories` | GET | All memory records |
| `/api/stats` | GET | Event/attachment counts |
| `/api/attachments` | GET | Attachment registry |
| `/api/drafts/pending` | GET | Pending drafts list |
| `/api/drafts/:id/confirm` | POST | Confirm a draft |
| `/api/drafts/:id/reject` | POST | Reject a draft |
| `/api/trial` | GET | Trial metrics (today + summary) |
| `/api/trial/record` | POST | Record today's trial metrics |

### Capture API

```
POST /api/ai/capture
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "今天宝宝第一次翻身了",
  "date": "2026-05-18",
  "confirmedByParent": true,
  "source": "remi"
}

Success: { "ok": true, "noteId": "...", "lifecycle": "captured_to_inbox" }
Privacy: { "ok": false, "error": "privacy_blocked" }
Stage:   { "ok": false, "error": "stage_guardrail", "message": "..." }
```

## Doctor Health Check (v1.9)

17 automated checks:

```
  Remi Family Memory — Health Check (v1.9)
  ==========================================

  [PASS] Event store         — N events loaded
  [PASS] Baby profile        — nickname (parents: N)
  [PASS] Attachment integrity — N/N SHA256 verified
  [PASS] Archive assets      — All N assets present
  [PASS] Memory records      — N memories for N events
  [PASS] Reports directory   — Exists
  [PASS] Context pack        — Up to date
  [PASS] Orphan attachments  — None
  [PASS] Orphan memories     — All memories have valid source events
  [PASS] Inbox pending       — No pending notes
  [PASS] Processed notes     — N note(s) in processed archive
  [PASS] Privacy boundary    — blocked_from_ai never enters AI-safe layer
  [PASS] Export directory    — Writable
  [PASS] Draft registry      — Consistent
  [PASS] OCR sidecars        — All present
  [PASS] Provenance          — All memories have source fields
  [PASS] Confirmed gate      — No unconfirmed content in memories

  Summary: 17 PASS, 0 WARN, 0 FAIL
```

## Directory Structure

```
remi-family-memory/
├── src/
│   ├── types.ts           # Type definitions + SCHEMA_VERSION
│   ├── paths.ts           # Data directory resolver
│   ├── parser.ts          # Markdown → BabyEvent
│   ├── store.ts           # Event store (read/write)
│   ├── scanner.ts         # Notes inbox scanner
│   ├── attachments.ts     # Assets scanner + registry
│   ├── drafts.ts          # Draft registry (pending/confirmed/rejected)
│   ├── ocr.ts             # OCR extractors (pdftotext, tesseract, pdf-scan)
│   ├── draft_enrichment.ts # VLM draft enrichment
│   ├── profile.ts         # Baby profile + gestational age
│   ├── memory.ts          # Event → MemoryRecord builder
│   ├── context.ts         # Remi context pack generator
│   ├── report.ts          # Monthly report generator
│   ├── search.ts          # Full-text search
│   ├── export.ts          # Full archive export
│   ├── doctor.ts          # Data health check (17 checks)
│   ├── capture.ts         # Capture API (intent/privacy/write)
│   ├── sync.ts            # Sync pipeline (scan→memory→context→doctor)
│   ├── trial.ts           # Trial metrics tracker
│   ├── server.ts          # Local Memory Service (Express)
│   ├── connector.ts       # Remi Connector client
│   ├── remi-adapter.ts    # Remi Memory Adapter (ask endpoint)
│   ├── adapters/          # LLM Adapter layer
│   ├── tests/             # Automated tests (229 tests)
│   └── cli.ts             # CLI entry point
├── web/
│   └── review.html        # Review page (dashboard, drafts, capture)
├── data/
│   ├── inbox/notes/       # Drop zone: markdown notes
│   ├── inbox/assets/      # Drop zone: media files
│   ├── events/            # Layer 1: events + attachments
│   ├── memory/            # Layer 2: AI memory records
│   ├── context/           # Layer 3: Remi context pack
│   ├── archive/assets/    # Archived media (SHA256 verified)
│   ├── profile/           # Baby profile
│   ├── processed/notes/   # Processed inbox files
│   ├── reports/           # Monthly reports
│   ├── trial/             # Trial metrics log
│   └── exports/           # Portable exports
├── docs/                  # Technical docs
├── package.json
├── tsconfig.json
└── README.md
```

## Design Principles

1. **Local-first**: All data is files you own. No cloud, no database.
2. **Grounded answers**: Every AI response cites real records. Never fabricate.
3. **Privacy by default**: Sensitivity levels, `blocked_from_ai` boundary enforced at every layer.
4. **Schema-versioned**: Forward-compatible. Old data always readable.
5. **Long-term**: Built for 18+ years. Plain files, standard formats.
6. **Rebuildable**: Memories and context can always be regenerated from events.
7. **Fail-safe**: No evidence = refuse. Service down = refuse.
8. **Source-traced**: Every confident answer traces back to a real record.

## Roadmap

### Done

- v0.2: Event archive (structured BabyEvent)
- v0.3: Three-layer memory (Events → Memories → Context)
- v0.4: Local Memory Service (REST API)
- v0.5: Remi Connector (source tracing + degradation)
- v0.6: Grounded Answer Protocol (evidence required, refusal on no data)
- v0.7: LLM Adapter (deterministic + cloud validation)
- v0.9: Capture API (Remi writes to inbox with confirmation)
- v0.9.2: Capture Safety (stage guardrail, lifecycle metadata)
- v0.9.3: Real Conversation Acceptance (8 scenarios verified)
- v1.0: Self-use Hardening (sync, doctor v1.0, export, README)
- v1.1: Image Draft MVP (recursive asset scan, VLM enrichment, parent-confirmed facts)
- v1.3: Provenance Model (source/evidence/confidence on every memory)
- v1.4: Review UI (web-based draft confirmation page)
- v1.5: Daily Flow (dashboard, quick capture, filters, web sync)
- v1.7: OCR Hardening (tesseract chi_sim+eng, PDF scan fallback)
- v1.8: Web Sync + Trial Tracker (metrics, streak, daily report)
- v1.9: Documentation + stability (229 tests, 17 doctor checks)

### Future

- Local LLM integration (Ollama, llama.cpp — true local-first AI)
- Photo EXIF extraction
- Voice memo transcription
- NAS / Docker deployment

## License

Private / Personal use.
