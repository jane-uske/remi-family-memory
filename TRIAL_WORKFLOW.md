# v1.8 Trial Daily Workflow

## 每日流程 (2-5 分钟)

### 1. 导入资料
```bash
# 将今天的产检报告、B超照片等放入:
cp ~/Downloads/今天的检查单.jpg data/inbox/assets/
```

### 2. 同步处理
两种方式，任选：
```bash
# CLI
npx tsx src/cli.ts sync

# 或在浏览器 Review 页面点击"同步刷新记忆"按钮
```

### 3. 确认草稿
打开 Review 页面: http://localhost:3456/review.html
- 查看待确认草稿
- 补充标题/摘要（如需要）
- 点击"确认"或"跳过"

### 4. 记录试用数据
```bash
npx tsx src/cli.ts trial-record
```
或在 Review 页面点击"记录今日"按钮。

### 5. 查看试用进度
```bash
npx tsx src/cli.ts trial-report
```

## 启动服务
```bash
npx tsx src/cli.ts serve
# 打开 http://localhost:3456/review.html
```

## 追踪指标
- 资料导入数 / 草稿生成数 / 确认数
- OCR 失败数和错误类型
- 是否有 unconfirmed 泄露
- 每天是否跑通完整流程

## 注意事项
- 不需要每天导入很多，1-2 条即可
- 如果 OCR 出错，记录文件名，后续改进
- 所有内容必须经过确认才进入正式记忆
- VLM 暂不可用，不影响主流程
