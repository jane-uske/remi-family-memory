# Local VLM Extractor — Design Document

> Status: experimental / 不进入主线  
> 目标: 为"图片检查单 → 本地 VLM → DraftNote JSON"设计方案

---

## 1. 通过 LM Studio OpenAI-compatible API 调用本地 VLM

LM Studio 暴露标准 OpenAI Chat Completions API：

```
POST http://localhost:1234/v1/chat/completions
```

配置方式：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `VLM_BASE_URL` | `http://localhost:1234/v1` | LM Studio API base URL |
| `VLM_MODEL` | (必填) | 当前加载的模型标识，如 `moondream2` |
| `VLM_TIMEOUT_MS` | `120000` | 超时毫秒（本地 7B 推理可能较慢） |

调用示例：

```ts
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: vlmModel,
    messages: [{ role: 'user', content: [...] }],
    temperature: 0.1,
    max_tokens: 2048,
  }),
})
```

不需要 API key（LM Studio 本地无鉴权）。

---

## 2. 图片传输方式

### 选择：base64 data URL（内嵌在 message content 中）

OpenAI-style multimodal 格式：

```json
{
  "role": "user",
  "content": [
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,iVBORw0KGgo..."
      }
    },
    {
      "type": "text",
      "text": "<prompt here>"
    }
  ]
}
```

### 为什么用 base64 data URL

- LM Studio ≥ 0.3 支持 `image_url` 中的 base64 data URL；
- 不依赖文件系统路径、不依赖文件服务器；
- 与 OpenAI API 格式完全兼容，后续可切换到其他 local inference server（如 ollama、llama.cpp server）。

### 不支持图片时的处理

如果当前加载的模型不支持 vision：

- LM Studio 会返回 4xx 或模型输出乱码/空内容；
- 实验脚本检查 response status + content，若非合法 JSON 则报错：

```
ERROR: Model does not appear to support vision input.
Please load a VLM model (e.g. moondream2, llava-1.6) in LM Studio.
```

---

## 3. DraftNote JSON Schema（VLM 输出）

VLM 被要求输出的 JSON 结构：

```ts
type VlmDraftOutput = {
  inferredDate: string | null       // ISO date, 如 "2026-05-15", 无法推断则 null
  inferredType: string | null       // BabyEventType, 如 "pregnancy_checkup"
  inferredTitle: string | null      // 简短标题, 如 "NT 检查报告"
  inferredSummary: string | null    // 1-2 句客观描述
  facts: string[]                   // 可从图片中直接读到的事实列表
  inferredTags: string[]            // 标签, 如 ["孕检", "NT"]
  uncertainFields: string[]         // 不确定的字段名列表
  warnings: string[]                // 需要家长注意的信息
  needsParentReview: true           // 始终为 true
}
```

**与主线 DraftNote 类型的关系**：VLM 输出是 DraftNote 的子集/来源数据，不是完整 DraftNote。完整 DraftNote 由 intake pipeline 生成（包含 draftId、batchId、attachmentIds 等）。VLM 输出只负责提取语义信息。

---

## 4. Prompt Contract

系统提示词必须包含以下约束：

```
你是一个家庭记录提取助手。你的任务是从图片中提取结构化信息，生成 JSON 草稿。

严格规则：
1. 你只能生成待确认草稿（needsParentReview 必须为 true）。
2. 你不能做任何医学诊断。
3. 你绝对不能说"宝宝很健康"、"一切正常"、"没问题"、"无需担心"等结论性表达。
4. 如果某项内容看不清或无法确定，必须将对应字段名加入 uncertainFields。
5. facts 只能包含从图片中直接可见的文字/数值，不能包含推断。
6. 你只能输出纯 JSON，不能输出 Markdown、解释文字或任何 JSON 以外的内容。
7. 如果图片无法识别或不是医疗/育儿相关内容，返回所有字段为 null/空，warnings 写明原因。
```

### 禁止的表达（硬拦截）

以下模式在输出中出现时必须触发 validation warning：

- `健康` / `正常` / `没问题` / `无异常` / `不用担心`
- `诊断为` / `确诊` / `可以确定`
- 任何带有 `建议` + 医疗动作的组合（如"建议复查"可以，但属于 warning 而非 fact）

---

## 5. JSON Validation

### 5.1 解析失败

```
VLM 返回非法 JSON → 标记为 parse_error → 不生成 draft → 报告原始文本前 200 字
```

尝试策略：
1. 先 `JSON.parse()` 整个 response content；
2. 若失败，尝试提取第一个 `{...}` 块再 parse；
3. 仍失败则放弃。

### 5.2 字段校验

| 检查项 | 处理 |
|--------|------|
| `needsParentReview !== true` | 强制设为 `true`，加 warning |
| `inferredType` 不在 BabyEventType 枚举内 | 设为 `null`，加入 `uncertainFields` |
| `inferredDate` 不是合法 ISO date | 设为 `null`，加入 `uncertainFields` |
| `facts` 非数组 | 设为 `[]` |
| `uncertainFields` 非数组 | 设为 `[]` |

### 5.3 医学结论拦截

对 `inferredSummary` + `facts` + `warnings` 中的文本做关键词扫描：

```ts
const BANNED_PATTERNS = [
  /很?健康/, /一切正常/, /没问题/, /无异常/,
  /不用担心/, /可以放心/, /诊断为/, /确诊/,
]
```

命中时：
- 不阻塞整个 draft（信息仍有参考价值）；
- 在 `warnings` 中追加 `"[VALIDATION] 检测到医学结论化表达，已标记"`；
- 将包含该表达的字段加入 `uncertainFields`。

### 5.4 uncertainFields 一致性检查

如果 `uncertainFields` 为空，但以下条件满足之一，追加 warning：
- `inferredDate` 为 null；
- `inferredType` 为 null；
- `facts` 为空数组；
- `inferredSummary` 包含 "可能"、"疑似"、"不确定" 等词。

---

## 6. MBA 16G 推荐模型

| 模型 | 参数量 | VRAM 需求 | 推荐度 | 说明 |
|------|--------|-----------|--------|------|
| **moondream2** | 1.9B | ~4GB | 推荐 | 轻量快速，中文能力有限但够用于结构提取 |
| **LLaVA-1.6-Vicuna-7B (Q4)** | 7B | ~6GB | 推荐 | 视觉理解较强，Q4 量化可在 16G 运行 |
| **MiniCPM-V 2.6** | 8B | ~8GB | 推荐 | 中文视觉理解好，适合中文医疗文档 |
| **InternVL2-8B (Q4)** | 8B | ~8GB | 备选 | 中文强，但 LM Studio 兼容性需验证 |
| Qwen-VL-Chat-30B | 30B | >16GB | **不推荐** | 超出 16G MBA 能力 |
| CogVLM-35B | 35B | >20GB | **不推荐** | 无法本地运行 |

### 重要说明

这只是 draft extractor，不是最终事实来源。模型输出：
- 可能有幻觉（hallucination）；
- 可能读错数字/日期；
- 可能漏掉关键信息；
- 所有输出必须经过 parent review。

即使用了最好的模型，也**不能**跳过人工确认步骤。

---

## 7. 为什么 Local VLM 只能生成 Draft

### 架构约束

```
图片 → [Local VLM] → VlmDraftOutput (JSON)
                          ↓
                   [Validation Layer]
                          ↓
                   打印/暂存为实验输出
                          ↓
                   ❌ 不进入以下任何位置：
                      - data/inbox/
                      - data/notes/
                      - data/events/
                      - data/memory/
                      - data/context/
```

### 原因

1. **准确性不足** — 本地 3B-7B VLM 的事实准确率不够做自动写入。
2. **隐私边界** — 一旦进入 memory/context，会被 Remi 读取并可能在对话中引用，未经确认的错误信息会造成误导。
3. **医疗安全** — 孕检/医疗图片的数字如果识别错误且自动进入系统，可能引发不必要的焦虑。
4. **Grounded Answer Protocol** — Remi 的回答必须基于 `confirmedByParent: true` 的事件，VLM 输出不满足此条件。
5. **产品原则** — local-first ≠ local-autonomous，人始终在环。

### 正确流程（未来集成时）

```
VLM 输出 → 保存为 DraftNote (status: 'pending') → 家长在 UI 中确认/修改/拒绝 → 
确认后才写入 events → 才进入 memory/context → Remi 才能引用
```

---

## 附录：环境变量汇总

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `VLM_BASE_URL` | 否 | `http://localhost:1234/v1` | LM Studio API 地址 |
| `VLM_MODEL` | 是 | — | 模型标识符 |
| `VLM_TIMEOUT_MS` | 否 | `120000` | 请求超时 |
