# Release Notes

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
