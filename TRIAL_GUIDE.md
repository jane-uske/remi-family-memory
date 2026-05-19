# Remi Family Memory - Local Trial Guide

## Prerequisites

- Node.js 20+
- `pdftotext` (poppler-utils) for PDF text extraction
- Optional: `tesseract` for image OCR (not currently installed)
- Optional: local VLM (e.g. Ollama + llava) for image understanding

## Directory Structure

```
data/
  profile/baby.json          # Baby profile (edit once)
  inbox/notes/               # Drop markdown notes here
  inbox/assets/              # Drop photos/PDFs here
  archive/assets/            # Stored assets (auto-managed)
  drafts/pending/            # Asset drafts awaiting review
  drafts/confirmed/          # Approved drafts
  drafts/ocr/               # OCR sidecars
  processed/notes/           # Scanned notes archive
  events/events.json         # All events
  memory/memories.json       # AI-readable memories
  context/remi-context.md    # Remi context pack
```

## Daily Workflow

### 1. Add files

Place photos/PDFs in `data/inbox/assets/`:

```bash
cp ~/photos/ultrasound-20w.jpg data/inbox/assets/
cp ~/docs/blood-report.pdf data/inbox/assets/
```

### 2. Run intake + OCR

```bash
npm run scan-assets       # Register attachments
npm run intake-assets     # Create pending drafts + run OCR
```

### 3. (Optional) Enrich with VLM

Requires `VLM_MODEL` and `VLM_ENDPOINT` env vars:

```bash
export VLM_MODEL=llava:13b
export VLM_ENDPOINT=http://localhost:11434
npm run enrich-drafts
```

### 4. Start server

```bash
npm run serve
# or: npm run dev  (scan + serve)
```

Open http://localhost:3456/review.html

### 5. Review pending drafts

On the Review page:
- **Dashboard** shows what needs attention
- **Quick capture** input: type a one-line family event, press Enter
- **Pending tab**: confirm or skip each draft
  - Add a title if missing
  - Add a summary (optional)
  - Click "confirm" or "skip"

### 6. Sync to finalize

```bash
npm run sync
```

This runs: scan inbox -> build memories -> generate context -> health check.

### 7. Verify with Remi

```bash
npm run search 孕检
# or via API:
curl http://localhost:3456/api/ai/search?q=孕检
curl http://localhost:3456/api/ai/memories
```

## Quick Capture (no file needed)

From the Review page or via API:

```bash
curl -X POST http://localhost:3456/api/capture \
  -H "Content-Type: application/json" \
  -d '{"text": "今天感受到胎动了，很轻微的蝴蝶翅膀感觉"}'
```

Then `npm run sync` to process.

## Key Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Scan + start server |
| `npm run sync` | Full pipeline (scan + memory + context + doctor) |
| `npm run scan-assets` | Register new assets |
| `npm run intake-assets` | Create drafts from unlinked assets |
| `npm run extract-ocr` | Re-run OCR for drafts missing sidecars |
| `npm run enrich-drafts` | VLM enrichment (needs VLM config) |
| `npm run doctor` | Health check |
| `npm run search <keyword>` | Search memories/events |
| `npm run export` | Full archive export |

## Safety Guarantees

- **No auto-confirm**: Drafts MUST be confirmed by parent before entering memory
- **Privacy gate**: Content with privacy markers is blocked from capture
- **Stage guardrail**: Post-birth milestones blocked during pregnancy
- **AI boundary**: blocked_from_ai content never reaches AI API
- **Local only**: No network calls unless VLM is configured
