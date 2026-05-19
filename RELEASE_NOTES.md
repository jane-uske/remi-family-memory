# Release Notes

## v1.9.0 — Daily Flow + Trial (2026-05-19)

Stable for daily family use with Review UI, OCR pipeline, quick capture, and trial tracking.

### Highlights

- **Review page** — web-based dashboard at `/review.html` for daily workflow
- **Quick capture** — one-line text input on Review page, no Remi needed
- **OCR pipeline** — pdftotext + tesseract (chi_sim+eng) + PDF scan fallback
- **Provenance** — every memory traces source, evidence, confidence
- **Trial tracker** — daily metrics, streak, summary report
- **Web sync** — click "同步刷新记忆" on Review page (no CLI needed)
- **229 automated tests**, 17 doctor checks, all passing

### New Commands

```bash
npm run dev               # Scan + serve (daily start)
npm run scan-assets       # Scan assets inbox only
npm run intake-assets     # Create draft notes from unlinked attachments
npm run extract-ocr       # Re-run OCR for drafts missing sidecars
npm run enrich-drafts     # Enrich drafts with local VLM
```

### New CLI Commands

```bash
npx tsx src/cli.ts trial-record   # Record today's trial metrics
npx tsx src/cli.ts trial-report   # Print trial summary report
```

### New API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Dashboard stats |
| `/api/capture` | POST | Quick capture from Review page |
| `/api/sync` | POST | Run full sync pipeline |
| `/api/drafts/pending` | GET | Pending drafts |
| `/api/drafts/:id/confirm` | POST | Confirm draft |
| `/api/drafts/:id/reject` | POST | Reject draft |
| `/api/trial` | GET | Trial metrics |
| `/api/trial/record` | POST | Record daily metrics |
| `/api/ai/ask` | POST | Grounded answer (adapter) |
| `/api/ai/drafts/chat` | POST | Draft management chat |
| `/api/ai/drafts/:id/enrich` | POST | VLM enrichment |

### Technical

- Schema version: 1.1.1.1
- 229 automated tests, 0 failures
- 17 doctor checks (up from 13)
- OCR: pdftotext → tesseract chi_sim+eng → pdf-scan-tesseract fallback chain
- Provenance fields: source, evidence, confidence, ocrAssisted, vlmAssisted
- DraftNote lifecycle: pending → confirmed/rejected (parent gate enforced)
- Trial metrics: assets imported, drafts created/confirmed/rejected, OCR failures, streak

---

## v1.8.0 — Web Sync + Trial Tracker (2026-05-19)

### Added

- Web-based sync button on Review page (POST /api/sync)
- Trial metrics system: DailyMetrics, TrialLog, streak tracking
- `trial-record` and `trial-report` CLI commands
- `/api/trial` and `/api/trial/record` endpoints
- Trial dashboard panel in Review page

---

## v1.7.0 — OCR Hardening (2026-05-19)

### Added

- `tesseractExtractor`: image OCR with `tesseract [path] stdout -l chi_sim+eng --psm 6`
- `pdfScanExtractor`: convert PDF pages to PNG via pdftoppm, OCR each with tesseract
- PDF fallback: if pdftotext yields <20 chars, falls back to pdf-scan-tesseract
- Extractor chain: pdfTextExtractor → tesseractExtractor → noOpExtractor

### Changed

- OCR error handling improved: captures stderr, reports meaningful error messages
- Doctor now checks OCR sidecar consistency

---

## v1.5.0 — Daily Flow (2026-05-19)

### Added

- Dashboard panel on Review page: pending count, needs-title, OCR errors, enriched
- Quick capture input on Review page (POST /api/capture, source: parent_web)
- Filter chips: all/ready/needs-title/ocr-error for pending; all/today/vlm/ocr for confirmed
- `/api/dashboard` endpoint for dashboard stats
- 10 new daily-flow tests

### Design Decisions

- No new frameworks (plain HTML/JS)
- Parent confirmation gate preserved (no AI auto-confirm)
- Review page operates as trusted local environment

---

## v1.4.0 — Review UI (2026-05-18)

### Added

- `web/review.html`: full draft review page with confirm/reject UI
- Pending drafts tab with title/date/summary edit before confirm
- Confirmed memories tab showing processed records
- Event type selector and tag input on confirm

---

## v1.3.0 — Provenance Model (2026-05-18)

### Added

- Source/evidence/confidence fields on MemoryRecord
- `ocrAssisted` and `vlmAssisted` boolean flags
- Memory builder populates provenance from event metadata
- Doctor check: all memories have source fields

---

## v1.1.0 — Image Draft MVP (2026-05-18)

### Added

- Recursive asset scanning (nested directories)
- DraftNote type with full lifecycle (pending/confirmed/rejected)
- Draft registry (JSON-based, parallel to event store)
- OCR pipeline: pdftotext for PDFs, sidecar `.ocr.txt` files
- VLM draft enrichment (extractedFacts, inferredTitle, inferredDate)
- `intake-assets` command: creates pending drafts from unlinked attachments
- `extract-ocr` command: re-runs OCR for drafts missing sidecars
- `enrich-drafts` command: batch VLM enrichment
- Draft confirm/reject with parent overrides
- Confirmed drafts write to inbox/notes and trigger normal pipeline

### Design Decisions

- VLM is optional (graceful degradation when not configured)
- OCR sidecar pattern: results stored alongside assets, not in DB
- Parent always confirms: AI suggests, human decides

---

## v1.0.0 — Self-use MVP (2026-05-18)

First stable release. The system is ready for daily self-use as a family memory guardian.

### Supported

- **Remi 查询家庭记忆** — grounded answers with source tracing, refusal on no evidence
- **Remi 记录家庭记忆** — natural language capture via conversation ("帮我记一下...")
- **sync** — one command daily workflow: scan → build-memory → context → doctor
- **doctor** — 13-point health check covering integrity, privacy, freshness
- **export** — complete portable archive with restore instructions
- **privacy boundary** — `blocked_from_ai` enforced at every layer, never leaks to AI
- **stage guardrail** — warns when recording post-birth milestones during pregnancy

### Not Supported

- 自动 sync（需手动运行 `npm run sync`）
- NAS / Docker 部署
- 图片 / PDF / OCR
- 语音输入
- 本地 LLM（当前使用确定性适配器）
- 多宝宝
- 复杂权限系统

### Technical

- Schema version: 1.0.0
- 82 automated tests, 0 failures
- TypeScript strict, zero errors
- 13 doctor checks, all PASS
- Capture API with privacy detection + stage guardrail
- Grounded Answer Protocol enforced end-to-end
- Full export/restore cycle verified

### Version History

| Version | Milestone |
|---------|-----------|
| v0.2 | Event archive |
| v0.3 | Three-layer memory (Events → Memories → Context) |
| v0.4 | Local Memory Service |
| v0.5 | Remi Connector (source tracing + degradation) |
| v0.6 | Grounded Answer Protocol |
| v0.7 | LLM Adapter (deterministic + cloud validation) |
| v0.9 | Capture API (Remi writes to inbox) |
| v0.9.2 | Capture Safety (stage guardrail, lifecycle) |
| v0.9.3 | Real Conversation Acceptance (8 scenarios) |
| **v1.0** | **Self-use Hardening (sync, doctor v1.0, export, README)** |
