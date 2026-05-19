# Remi 家庭记忆

**v1.9 每日流程 + 试用** — 已稳定用于日常家庭记录，含 Review UI、OCR 和快速记录。

> 一个本地优先的家庭记忆系统 — 记录、归档、AI 检索，守护你家庭的故事。

## 这是什么

这**不是**宝宝追踪 app、相册、或 AI 聊天机器人。

这是一个**本地优先、隐私安全、面向长期保存**的家庭记忆系统：

- 从孕期开始，把生活事件记录为结构化时间线
- 用 SHA256 校验归档媒体文件，确保完整性
- 从原始事件自动生成 AI 可理解的记忆卡片
- 生成上下文包供 Remi/AI 直接加载
- 提供本地 HTTP 服务，Remi 可以查询和写入家庭记忆
- 严格要求有据回答 — AI 每一句回复都引用真实记录，绝不编造
- 所有数据以本地文件存储，永远属于你 — 无云端、无数据库

## 日常使用指南（v1.9）

### 启动服务

```bash
npm install
npm run dev     # 扫描 + 启动服务 http://localhost:3456
```

打开 **http://localhost:3456/review.html** — 每日 Review 页面。

Remi 通过环境变量连接：

```bash
REMI_FAMILY_MEMORY_ENABLED=1
REMI_FAMILY_MEMORY_SERVICE_URL=http://localhost:3456
REMI_FAMILY_MEMORY_AI_TOKEN=<可选token>
```

### 记录

#### 快速记录（Review 页面）

打开 http://localhost:3456/review.html — 在输入框中输入一句话记录，按回车即可。

#### 通过 Remi 对话

用自然语言告诉 Remi：

- "帮我记一下，今天第一次感受到胎动了"
- "记录一下，16周孕检一切正常"
- "帮忙记，爸爸今天给宝宝念了第一本书"

Remi 会识别记录意图并提取内容。

### 确认

Remi 会展示提取的内容并请求确认：

```
好的，我将记录以下内容到家庭记忆：

「今天第一次感受到胎动了」

确认记录吗？（回复"确认"记录，"算了"取消）
```

回复 **"确认"** 保存，**"算了"** 取消。确认 5 分钟内有效。

### 同步

记录或确认草稿后，同步以更新 AI 记忆：

```bash
npm run sync
```

或在 Review 页面点击 **"同步刷新记忆"** 按钮。

这一条命令会执行 4 步：扫描收件箱 → 构建记忆 → 生成上下文 → 健康检查。

### 查询

向 Remi 提问家庭记忆相关内容：

- "宝宝第一次胎动是什么时候？"
- "最近一次孕检结果怎样？"
- "爸爸给宝宝写过什么？"

Remi 基于真实记录回答，每条回复都标注来源。如果没有记录，会回复"当前家庭记忆库里没有找到相关记录"，绝不编造。

### 导出

```bash
npm run export
```

在 `data/exports/` 下生成完整的可移植归档，包含所有事件、附件、记忆、报告、上下文，附带恢复说明。

### 隐私内容处理

如果内容包含隐私标记（"不要给AI看"、"私密"等），Remi 会拒绝记录：

> "这条内容包含私密标记，无法通过 Remi 记录。如需保存，请通过本地管理方式手动添加为 blocked_from_ai。"

手动添加私密内容：在 `data/inbox/notes/` 创建笔记，头部加上：

```yaml
---
sensitivity: blocked_from_ai
---
```

这类内容会进入事件时间线，但**永远不会**到达 AI 可见的层（记忆、上下文、搜索、Remi 查询）。

### 导入照片 / PDF

将文件放入 `data/inbox/assets/` 然后运行：

```bash
npm run scan-assets       # 注册附件
npm run intake-assets     # 创建待确认草稿 + 运行 OCR
```

打开 Review 页面确认或跳过每个草稿。

### 确认草稿

在 http://localhost:3456/review.html:

1. **Dashboard** 显示待确认数量、OCR 状态
2. **Pending 标签** 列出草稿 — 补充标题/摘要，然后点击"确认"或"跳过"
3. 点击 **"同步刷新记忆"** 完成处理

### 当前不支持

- 语音 / 音频输入
- NAS / Docker 部署
- 多宝宝 / 多家庭
- 自动媒体处理（auto-confirm）
- 复杂权限系统
- 本地 LLM 集成（Ollama、llama.cpp）

## 命令速查

```bash
npm run dev               # 扫描 + 启动服务（日常启动）
npm run sync              # 每日流程：扫描 + 构建记忆 + 上下文 + 健康检查
npm run scan              # 扫描收件箱（笔记 + 附件）
npm run scan-assets       # 仅扫描附件收件箱
npm run intake-assets     # 从未关联附件创建草稿笔记
npm run extract-ocr       # 为缺少 sidecar 的草稿重新运行 OCR
npm run enrich-drafts     # 用本地 VLM 丰富草稿（需 VLM_MODEL）
npm run serve             # 启动本地记忆服务（端口 3456）
npm run report [YYYY-MM]  # 生成月报
npm run build-memory      # 从事件构建 AI 记忆卡片
npm run context           # 生成 Remi 上下文包
npm run search -- <关键词> # 搜索事件、记忆、报告、附件
npm run export            # 导出完整归档
npm run doctor            # 运行数据健康检查（17 项）
npm run connector         # 运行 Remi 连接器验证
npm run capture-demo      # 运行 capture 冒烟测试
npm test                  # 运行自动化测试（229 个测试）
npm run build             # TypeScript 编译
```

## 系统架构

```
v0.2: 事件（归档）
v0.3: 事件 → 记忆 → 上下文（AI 可读）
v0.4: 事件 → ... → 服务（AI 可查询）
v0.5: 事件 → ... → 连接器（AI 可消费）
v0.6: 事件 → ... → 协议（有据、可审计）
v0.7: 事件 → ... → 适配器（可插拔 LLM）
v0.9: 事件 → ... + 记录 API（Remi 写入收件箱）
v1.0: 事件 → ... + 同步 + 健康检查 + 导出（自用加固）
v1.1: 事件 → ... + 图片草稿 + OCR（资产导入管道）
v1.3: 事件 → ... + 溯源（来源/证据/置信度）
v1.4: 事件 → ... + Review UI（网页确认）
v1.5: 事件 → ... + 每日流程（仪表盘、快速记录、筛选）
v1.7: 事件 → ... + OCR 加固（tesseract、PDF 扫描回退）
v1.8: 事件 → ... + 网页同步 + 试用追踪器
```

### 数据流

```
                           ┌───────────────────────────┐
                           │   Remi（对话）              │
                           │ "帮我记，今天第一次胎动了"   │
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
         事件存储              AI 记忆卡片           Remi 上下文包
    events/events.json    memory/memories.json  context/remi-context.*
       （第一层：事实）       （第二层：卡片）       （第三层：上下文）
                                        │
                                        ▼
                               [npm run serve]
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
           /api/ai/context     /api/ai/search      /api/ai/ask
                    │                   │                   │
                    └───────────────────┼───────────────────┘
                                        ▼
                               ┌────────────────┐
                               │  Remi 有据回答  │
                               │  附带来源引用   │
                               └────────────────┘
```

### 记录流程

```
用户: "帮我记，今天第一次胎动了"
  → Remi 识别记录意图
  → 隐私检查（如有私密标记则拒绝）
  → 阶段守卫（孕期录入出生后里程碑时警告）
  → 展示提取内容，请求确认
  → 用户: "确认"
  → POST /api/ai/capture → data/inbox/notes/2026-05-18-remi-xxx.md
  → 用户运行: npm run sync
  → 笔记 → 事件 → 记忆 → 上下文（可被 Remi 查询）
```

### 生命周期状态

```
captured_to_inbox → pending_ingestion → ingested_to_event → available_to_memory
```

## 数据层次

| 层 | 用途 | 格式 |
|----|------|------|
| **事件** | 原始结构化记录（事实来源） | `BabyEvent` JSON |
| **记忆** | AI 推导的卡片：重要性、摘要、事实 | `MemoryRecord` JSON |
| **上下文** | 预构建的 Remi/AI 可加载包 | Markdown + JSON |
| **服务** | 读取、搜索、写入的 HTTP API | REST JSON |
| **连接器** | Remi 集成：来源追溯 + 降级处理 | TypeScript 模块 |
| **协议** | 有据回答规则：必须有证据，无数据则拒绝 | `GroundedAnswer` |

## 隐私与安全

| 敏感等级 | 说明 |
|----------|------|
| `blocked_from_ai` | 绝对隐私：不转为记忆、不进入上下文、不出现在搜索、不可通过 Remi 录入或查询 |
| `medical` | 医疗相关：进入记忆但标记谨慎处理 |
| `family_private` | 家庭内部：家人可见，不对外 |
| `normal` | 完全开放 |

## 健康检查（Doctor v1.9）

运行 `npm run doctor` 执行 17 项自动检查：

```
  Remi Family Memory — Health Check (v1.9)
  ==========================================

  [PASS] 事件存储         — N 条事件已加载
  [PASS] 宝宝档案         — 昵称（父母: N人）
  [PASS] 附件完整性       — N/N SHA256 校验通过
  [PASS] 归档资源         — N 个资源全部存在
  [PASS] 记忆卡片         — N 条记忆对应 N 条事件
  [PASS] 报告目录         — 存在
  [PASS] 上下文包         — 已是最新
  [PASS] 孤立附件         — 无
  [PASS] 孤立记忆         — 所有记忆都有对应事件
  [PASS] 收件箱待处理     — 无待处理笔记
  [PASS] 已处理笔记       — N 条笔记已归档
  [PASS] 隐私边界         — blocked_from_ai 从未进入 AI 安全层
  [PASS] 导出目录         — 可写
  [PASS] 草稿注册表       — 一致
  [PASS] OCR sidecars     — 全部存在
  [PASS] 溯源             — 所有记忆都有来源字段
  [PASS] 确认门禁         — 无未确认内容进入记忆

  汇总: 17 通过, 0 警告, 0 失败
```

## 目录结构

```
remi-family-memory/
├── src/
│   ├── types.ts           # 类型定义 + 版本号
│   ├── paths.ts           # 数据目录解析
│   ├── parser.ts          # Markdown → BabyEvent 解析
│   ├── store.ts           # 事件存储（读写）
│   ├── scanner.ts         # 收件箱扫描器
│   ├── attachments.ts     # 附件扫描 + 注册
│   ├── drafts.ts          # 草稿注册（pending/confirmed/rejected）
│   ├── ocr.ts             # OCR 提取器（pdftotext、tesseract、pdf-scan）
│   ├── draft_enrichment.ts # VLM 草稿丰富
│   ├── profile.ts         # 宝宝档案 + 孕周计算
│   ├── memory.ts          # 事件 → 记忆卡片
│   ├── context.ts         # Remi 上下文包生成
│   ├── report.ts          # 月报生成
│   ├── search.ts          # 全文搜索
│   ├── export.ts          # 完整归档导出
│   ├── doctor.ts          # 健康检查（17项）
│   ├── capture.ts         # 记录 API（意图/隐私/写入）
│   ├── sync.ts            # 同步流水线
│   ├── trial.ts           # 试用指标追踪
│   ├── server.ts          # 本地记忆服务（Express）
│   ├── connector.ts       # Remi 连接器
│   ├── remi-adapter.ts    # Remi 记忆适配器（ask 端点）
│   ├── adapters/          # LLM 适配器层
│   ├── tests/             # 自动化测试（229 个）
│   └── cli.ts             # CLI 入口
├── web/
│   └── review.html        # Review 页面（仪表盘、草稿、快速记录）
├── data/
│   ├── inbox/notes/       # 投递区：Markdown 笔记
│   ├── inbox/assets/      # 投递区：媒体文件
│   ├── events/            # 第一层：事件 + 附件注册
│   ├── memory/            # 第二层：AI 记忆卡片
│   ├── context/           # 第三层：Remi 上下文包
│   ├── archive/assets/    # 归档媒体（SHA256 校验）
│   ├── profile/           # 宝宝档案
│   ├── processed/notes/   # 已处理的收件箱笔记
│   ├── reports/           # 月报
│   ├── trial/             # 试用指标日志
│   └── exports/           # 可移植导出
├── docs/                  # 技术文档
├── package.json
├── tsconfig.json
└── README.md
```

## 设计原则

1. **本地优先** — 所有数据都是你拥有的文件。无云端、无数据库。
2. **有据回答** — AI 每次回复都引用真实记录，绝不编造。
3. **隐私默认** — 敏感等级分层，`blocked_from_ai` 在每一层严格执行。
4. **版本化** — 向前兼容，旧数据永远可读。
5. **长期存储** — 为 18 年以上设计。纯文件、标准格式。
6. **可重建** — 记忆和上下文随时可从事件重新生成。
7. **安全失败** — 没有证据就拒绝回答，服务不可用就拒绝回答。
8. **来源可溯** — 每一个确定性回答都可追溯到真实记录。

## 版本路线

### 已完成

- v0.2: 事件归档（结构化 BabyEvent）
- v0.3: 三层记忆（事件 → 记忆 → 上下文）
- v0.4: 本地记忆服务（REST API）
- v0.5: Remi 连接器（来源追溯 + 降级处理）
- v0.6: 有据回答协议（必须有证据，无数据则拒绝）
- v0.7: LLM 适配器（确定性 + 云端验证）
- v0.9: 记录 API（Remi 写入收件箱 + 确认）
- v0.9.2: 记录安全（阶段守卫、生命周期元数据）
- v0.9.3: 真实对话验收（8 个场景验证通过）
- v1.0: 自用加固（同步、健康检查 v1.0、导出、README）
- v1.1: 图片草稿 MVP（递归扫描、VLM 丰富、父母确认事实管道）
- v1.3: 溯源模型（来源/证据/置信度）
- v1.4: Review UI（网页草稿确认）
- v1.5: 每日流程（仪表盘、快速记录、筛选、网页同步）
- v1.7: OCR 加固（tesseract 中英文、PDF 扫描回退）
- v1.8: 网页同步 + 试用追踪器（指标、连续天数、每日报告）
- v1.9: 文档 + 稳定性（229 个测试，17 项健康检查）

### 未来计划

- 本地 LLM 集成（Ollama、llama.cpp — 真正的本地 AI）
- 照片 EXIF 提取
- 语音备忘录转写
- NAS / Docker 部署

## 许可

个人使用 / 私有项目。

---

[English](README.md)
