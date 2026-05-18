# Remi 家庭记忆

**v1.0 自用稳定版** — 已可用于日常家庭记录。

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

## 日常使用指南

### 启动服务

```bash
npm install
npm run serve   # 启动服务 http://localhost:3456
```

Remi 通过环境变量连接：

```bash
REMI_FAMILY_MEMORY_ENABLED=1
REMI_FAMILY_MEMORY_SERVICE_URL=http://localhost:3456
REMI_FAMILY_MEMORY_AI_TOKEN=<可选token>
```

### 记录（通过 Remi 对话）

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

记录之后，运行同步把笔记处理为正式时间线和 AI 记忆：

```bash
npm run sync
```

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

## 命令速查

| 命令 | 作用 |
|------|------|
| `npm run sync` | 日常一键流程：扫描 + 构建记忆 + 生成上下文 + 健康检查 |
| `npm run serve` | 启动本地记忆服务（端口 3456） |
| `npm run dev` | 扫描 + 启动服务 |
| `npm run scan` | 扫描收件箱（笔记 + 附件） |
| `npm run export` | 导出完整归档 |
| `npm run doctor` | 运行数据健康检查（13 项） |
| `npm run report [YYYY-MM]` | 生成月报 |
| `npm run search -- <关键词>` | 全文搜索 |
| `npm run build-memory` | 从事件构建 AI 记忆卡片 |
| `npm run context` | 生成 Remi 上下文包 |
| `npm test` | 运行测试 |
| `npm run build` | TypeScript 编译 |

## 系统架构

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
           /api/ai/context     /api/ai/search      /api/ai/answer
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

## 健康检查（Doctor）

运行 `npm run doctor` 执行 13 项自动检查：

```
  Remi Family Memory — Health Check (v1.0)
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

  汇总: 13 通过, 0 警告, 0 失败
```

## 目录结构

```
remi-family-memory/
├── src/                   # 源码
│   ├── types.ts           # 类型定义 + 版本号
│   ├── parser.ts          # Markdown → BabyEvent 解析
│   ├── store.ts           # 事件存储（读写）
│   ├── scanner.ts         # 收件箱扫描器
│   ├── memory.ts          # 事件 → 记忆卡片
│   ├── context.ts         # Remi 上下文包生成
│   ├── search.ts          # 全文搜索
│   ├── export.ts          # 完整归档导出
│   ├── doctor.ts          # 健康检查（13项）
│   ├── capture.ts         # 记录 API（意图/隐私/写入）
│   ├── sync.ts            # 同步流水线
│   ├── server.ts          # 本地记忆服务（Express）
│   ├── connector.ts       # Remi 连接器
│   └── cli.ts             # CLI 入口
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
│   └── exports/           # 可移植导出
├── docs/                  # 技术文档
├── package.json
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

## 当前不支持

- 语音 / 音频输入
- 照片 / 图片识别 / OCR
- 本地 LLM 集成（Ollama、llama.cpp）
- NAS / Docker 部署
- 多宝宝 / 多家庭
- 自动媒体处理
- 复杂权限系统
- 自动同步（目前需手动 `npm run sync`）

## 未来计划

- 本地 LLM 集成（真正的本地 AI）
- 照片 EXIF 提取
- 语音备忘录转写
- NAS / 容器化部署

## 许可

个人使用 / 私有项目。

---

[English](README.md)
