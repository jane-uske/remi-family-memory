# REST API Capture 限制说明

## 多轮确认流程的限制

### 问题

`POST /api/ai/capture` 端点本身是无状态的——它不持有确认会话状态。确认流程（意图检测 → 用户确认 → 写入）完全由 Remi 的会话层管理。

Remi 的确认流程依赖 **stable connId**（WebSocket 连接标识符）来维持 pending draft 状态。

### REST `/api/ext/chat` 的局限

Remi 的 REST `/api/ext/chat` 端点每次请求创建一个 **ephemeral connId**（格式：`ext-{timestamp}-{random}`），无法跨请求保持状态。

这意味着：

1. 第一次请求："帮我记一下今天宝宝翻身了" → 创建 pending draft → 返回确认提示
2. 第二次请求："确认" → 使用新的 connId → 找不到 pending draft → 不触发记录

### 结论

**Capture 确认流程仅支持 WebSocket 连接。** REST 调用可以触发意图检测，但无法完成确认写入。

### 解决建议

如果未来需要 REST 支持，可选方案：
- 在 REST 请求中传递 `sessionId` 参数，映射到 pending draft store
- 或提供一个 `POST /api/ai/capture-direct` 端点跳过确认流程（但这需要额外的安全验证）

当前版本不实现这些方案——capture hook 仅通过 WebSocket 工作。

---

## Capture 生命周期

一条记录从用户口述到可用于 AI 查询，经历以下状态：

```
captured_to_inbox → pending_ingestion → ingested_to_event → available_to_memory
```

| 状态 | 触发条件 | 存储位置 |
|------|----------|----------|
| `captured_to_inbox` | 用户确认 + API 写入成功 | `data/inbox/notes/` |
| `pending_ingestion` | 文件存在于 inbox 等待扫描 | `data/inbox/notes/` |
| `ingested_to_event` | `npm run scan` 处理后 | `data/events/events.json` |
| `available_to_memory` | `npm run build-memory` 生成记忆 | `data/memory/` |

Remi 在确认写入成功后告知用户当前状态为 `captured_to_inbox`。
