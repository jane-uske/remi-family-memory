# v1.6 Real Data Trial - Issue List

Trial date: 2026-05-19

## Trial Summary

| Step | Result |
|------|--------|
| Quick capture → inbox | PASS |
| Sync → events + memory | PASS |
| Draft confirm with overrides | PASS |
| Provenance tracking | PASS |
| Privacy gate | PASS |
| Stage guardrail | PASS |
| Dashboard API | PASS |
| Review page loads | PASS |
| Search returns confirmed only | PASS |
| Context pack generation | PASS |
| Doctor health check | PASS (15/17, 2 WARN expected) |

## Issues Found

### P1 - Blocking for real use

1. **No image OCR**: `tesseract` not installed. Image files (ultrasound photos, checkup screenshots) all get `no_extractor` status. For a pregnancy use case, 80%+ of inputs are photos.
   - **Fix**: Install tesseract + chi_sim language pack, add tesseract extractor to `ocr.ts`
   - **Workaround**: Use VLM enrichment (but also not available locally yet)

2. **No VLM available**: Ollama not installed. Without VLM, photo-based drafts have zero context (no title, no type, no facts extracted). Parent must manually fill everything.
   - **Fix**: Install Ollama + llava model, or configure remote VLM endpoint
   - **Impact**: Draft enrichment is the main value-add for reducing parent effort

3. **Test PDF is fake**: `pregnancy-report-16w.pdf` is actually an ASCII text file, not a real PDF. OCR correctly errors on it. Need real test fixtures.
   - **Fix**: Replace with actual PDF/image test fixtures

### P2 - Usability friction

4. **Quick capture requires separate sync**: After typing in the Review page, parent sees "run npm run sync" message. Non-technical users won't know what this means.
   - **Fix options**: (a) auto-sync on capture, (b) add "sync" button to review page, (c) cron-based auto-sync

5. **No batch confirm**: Parent with 10 enriched drafts must confirm one-by-one. Should offer "confirm all ready" for drafts that already have title+date+type.
   - **Fix**: Add batch confirm button in review page (still parent-initiated, not auto)

6. **Duplicate memories**: "今天宝宝第一次翻身了" appears twice because two separate Remi captures created two events for the same content.
   - **Fix**: Dedup logic in scanner or memory builder

7. **Context shows stale event count**: Context pack only refreshes on explicit `npm run sync`. Between syncs, the numbers are wrong.
   - **Acceptable**: This is by-design (local-first, no background process)

### P3 - Nice to have

8. **Provenance gap on older memories**: Memories created before v1.3 (provenance model) don't show source info in review page. They show blank provenance.
   - **Fix**: Backfill provenance for existing events (mark as `source: remi_capture, confirmedAt: createdAt`)

9. **Image thumbnails not shown**: Review page lists filenames but doesn't preview images. For photo memories, seeing the image would help parent decide.
   - **Fix**: Serve images from `/api/attachments/:id/file` and show thumbnail in draft card

10. **No notification push**: Dashboard shows "Remi 提醒" text, but there's no actual push notification to phone/desktop. Parent must open the page.
    - **Fix**: Not in scope for local-only design. Consider for NAS phase.

## File Type Effectiveness

| File type | OCR | VLM | Outcome |
|-----------|-----|-----|---------|
| Real PDF (text-based) | PASS (pdftotext) | N/A | Good: extracts text, can infer date from filename |
| Scanned PDF (image-based) | PARTIAL (pdftotext gets little/nothing) | Not available | Poor: needs tesseract or VLM |
| JPEG (ultrasound/photo) | FAIL (no_extractor) | Not available | Blocked: no way to extract info |
| Markdown notes | N/A | N/A | PASS: direct scan |
| Quick capture text | N/A | N/A | PASS: direct write |

## Biggest Blocker

**Image OCR + VLM availability.** Without these two capabilities, 80% of real family memory inputs (photos of ultrasounds, checkup reports as photos, milestone screenshots) produce empty drafts that require full manual entry. The system works perfectly for text-based inputs but the value proposition for busy parents depends on reducing effort for photo inputs.

## Recommendation

Do NOT proceed to NAS/multi-device yet. Instead:

1. Install `tesseract` + `chi_sim` → fix image OCR
2. Install Ollama + llava → enable VLM enrichment
3. Add "sync" button to review page → remove CLI dependency for daily use
4. Re-run trial with real photos after fixing above

Once images work end-to-end with minimal manual input, THEN consider NAS deployment.
