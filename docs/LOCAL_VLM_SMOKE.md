# Local VLM Smoke Test

This project already has a local VLM enrichment path:

- `src/local_vlm_extractor.ts`
- `src/draft_enrichment.ts`
- `npm run enrich-draft`
- `npm run enrich-drafts`

This document adds a smaller smoke test so you can first verify whether LM Studio / a local OpenAI-compatible VLM server is reachable and whether the selected model can read one real image.

## 1. Start LM Studio local server

1. Download and load a vision model, for example:
   - Qwen2.5 VL 7B
   - Qwen3 VL 4B
   - Qwen3 VL 8B
   - olmOCR 2 7B
2. Start the local server.
3. Keep the default base URL unless changed:

```bash
http://localhost:1234/v1
```

## 2. List loaded model ids

```bash
npm run vlm:smoke -- --list-models
```

If your server is not on the default URL:

```bash
VLM_BASE_URL=http://localhost:1234/v1 npm run vlm:smoke -- --list-models
```

## 3. Smoke test one image

Use a real asset image, not a PDF:

```bash
VLM_MODEL="<model-id-from-list-models>" \
npm run vlm:smoke -- --image ./data/inbox/assets/example.png
```

Or with explicit base URL:

```bash
VLM_BASE_URL=http://localhost:1234/v1 \
VLM_MODEL="<model-id-from-list-models>" \
npm run vlm:smoke -- --image ./data/inbox/assets/example.png
```

The smoke command prints the parsed VLM draft output plus validation warnings. It does not write memory, does not confirm drafts, and does not bypass parent review.

## 4. Existing enrichment path

After the smoke test works, the existing product path is:

```bash
VLM_BASE_URL=http://localhost:1234/v1 \
VLM_MODEL="<model-id-from-list-models>" \
npm run enrich-drafts
```

Or one draft:

```bash
VLM_BASE_URL=http://localhost:1234/v1 \
VLM_MODEL="<model-id-from-list-models>" \
npm run enrich-draft -- <draftId>
```

The enrichment path only updates pending drafts. Users still need to review and confirm before anything enters confirmed memory.

## 5. Pass/fail bar

The model is worth further testing only if it can reduce manual work. It should:

- identify document type;
- extract date/report time/institution;
- extract Chinese metric names and values;
- preserve ultrasound findings without inventing conclusions;
- avoid medical diagnosis unless the report explicitly says it;
- produce JSON that can be parsed.

If you still need to re-read the original image and rewrite nearly everything, the model fails the product bar even if it technically runs.
