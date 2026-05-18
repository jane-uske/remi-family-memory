# experimental/

实验性代码，不进入主线 pipeline，不影响 production。

## 目录结构

```
experimental/
├── README.md                   # 本文件
├── local-vlm-smoke.ts          # 单张图片 smoke test
├── local-vlm-batch.ts          # 批量测试脚本
├── VLM-EVAL-TEMPLATE.md        # 人工评分表模板
├── samples/                    # 测试图片目录（图片被 gitignore）
│   ├── README.md
│   └── .gitignore
└── output/                     # 批量测试输出（全部被 gitignore）
    └── .gitignore
```

## 前置条件

1. 安装并运行 [LM Studio](https://lmstudio.ai/)
2. 加载一个支持 vision 的模型（推荐 moondream2 或 LLaVA-1.6-Vicuna-7B Q4）
3. 在 LM Studio 中启动 Local Server（默认端口 1234）

## local-vlm-smoke.ts（单张）

```bash
VLM_MODEL=moondream2 npx tsx experimental/local-vlm-smoke.ts ./sample.png
```

## local-vlm-batch.ts（批量）

```bash
# 处理整个目录
VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./experimental/samples/

# 处理单张图片
VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./photo.jpg

# 输出结果到文件（仍不写 data/）
VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts ./experimental/samples/ --output experimental/output/
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `VLM_MODEL` | 是 | — | LM Studio 中加载的模型名 |
| `VLM_BASE_URL` | 否 | `http://localhost:1234/v1` | LM Studio API 地址 |
| `VLM_TIMEOUT_MS` | 否 | `120000` | 请求超时（ms） |
| `VLM_TEMPERATURE` | 否 | `0.1` | 生成温度（越低越稳定） |
| `VLM_MAX_TOKENS` | 否 | `2048` | 最大输出 token 数 |

## 安全约束

- **不写入 data/ 目录** — 硬编码检查，尝试写入 data/ 会被拒绝
- **不修改项目状态** — 不 import src/ 模块，不调用 production API
- **不提交真实图片** — samples/ 下的图片被 .gitignore 排除
- **不提交输出** — output/ 下所有文件被 .gitignore 排除
- **不接云 API** — 只连接本地 LM Studio

## 评估流程

1. 放图片到 `experimental/samples/`
2. 运行 batch 脚本
3. 复制 `VLM-EVAL-TEMPLATE.md`，填写人工评分
4. 根据评分标准判断模型是否达标
