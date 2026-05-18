# Mac 本地 Asset Intake 操作手册

## 1. 放入文件

将检查单 PDF、超声图片等**直接放入**：

```
data/inbox/assets/
```

> 注意：`scan-assets` 只扫描该目录下的文件，**不递归子目录**。子目录下的文件会被忽略。

命名建议：带日期前缀的同次检查文件放在一起，因为系统会按日期或导入时间归组：

```
2026-05-10-blood-report.pdf
2026-05-10-ultrasound.jpg
2026-05-10-weight.pdf
```

文件名带日期前缀（`YYYY-MM-DD-` 或 `YYYYMMDD`），系统会自动提取日期。没有日期前缀也可以，会按导入日期归组。

---

## 2. 运行顺序

```bash
npm run scan-assets      # 扫描 inbox/assets → 归档到 archive，生成 attachment 记录
npm run intake-assets    # 为未关联的 attachment 生成 pending draft + OCR 提取
npm run doctor           # 检查数据健康，确认无 FAIL
npm run serve            # 启动服务 (http://localhost:3456)
```

---

## 3. 通过 Remi 确认草稿

启动 Remi 后，发送：

> 有什么待确认的？

Remi 会列出 pending drafts。

### 操作方式

| 动作 | 发送内容 |
|------|----------|
| 选择（多条时） | `1`、`2`（编号） |
| 确认 | `确认` / `好` / `ok` |
| 补充摘要后确认 | `补充摘要：一切正常，胎儿发育良好` |
| 跳过（拒绝） | `跳过` / `算了` / `取消` |

---

## 4. 确认后同步到时间线

```bash
npm run sync
```

sync 会将确认后生成的 inbox note 扫入 events → 重建 memory → 刷新 context → 运行 doctor。

---

## 5. 查询

确认并 sync 后，可以问 Remi：

> 最近一次孕检是什么？

或通过 CLI 搜索：

```bash
npm run search 孕检
```

---

## 6. PDF 文本层提取

系统使用 `pdftotext`（来自 poppler）提取 PDF 内嵌文本层。

### Mac 安装 pdftotext

```bash
brew install poppler
```

安装后验证：

```bash
which pdftotext
# /opt/homebrew/bin/pdftotext  (Apple Silicon)
# /usr/local/bin/pdftotext     (Intel Mac)
```

如果已安装，`intake-assets` 会自动提取 PDF 文本，结果保存在 `data/drafts/ocr/{attachmentId}.ocr.txt`。

---

## 7. 图片说明

当前版本（v1.1.1）图片 OCR 返回 `no_extractor` 状态：

- 图片仍然会正常生成 pending draft
- OCR sidecar 会标记 `status: "no_extractor"`
- **需要用户通过"补充摘要"手动描述图片内容**

未来版本计划接入 local VLM 或其他图片识别方案。

---

## 8. Troubleshooting

### 没有生成 draft

- 确认先运行了 `npm run scan-assets`（attachment 记录必须先存在）
- 确认文件**直接**放在 `data/inbox/assets/` 下，**不要在子目录里**（`scan-assets` 不递归子目录）
- 已经生成过 draft 的 attachment 不会重复生成，检查 `data/drafts/pending/`

### Remi 看不到 pending draft

- 确认服务已启动：`npm run serve`
- 确认 Remi 环境变量已配置：
  ```
  REMI_FAMILY_MEMORY_ENABLED=1
  REMI_FAMILY_MEMORY_SERVICE_URL=http://localhost:3456
  REMI_FAMILY_MEMORY_AI_TOKEN=<your-token>
  ```
- 直接验证 API：`curl -H "Authorization: Bearer <token>" http://localhost:3456/api/ai/drafts/pending`

### pdftotext not available

```bash
brew install poppler
```

如果未安装 pdftotext，PDF 的 OCR 状态会是 `error`，draft 仍会生成但没有文本内容。可以安装后重新提取：

```bash
npm run extract-ocr
```

### 服务端口不通

- 默认端口 3456，确认没有被占用：`lsof -i :3456`
- 可通过环境变量修改：`PORT=3457 npm run serve`
