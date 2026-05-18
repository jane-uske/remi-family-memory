# VLM Evaluation Template

每次运行 batch test 后，手动填写此表评估模型输出质量。

## 测试环境

| 项目 | 值 |
|------|---|
| 日期 | |
| 模型 | |
| 量化 | |
| 硬件 | |
| LM Studio 版本 | |
| VLM_TEMPERATURE | |
| VLM_MAX_TOKENS | |

## 评估结果

| imageName | model | latencyMs | dateCorrect | typeCorrect | factsUseful | hallucinationObserved | medicalClaimObserved | jsonValid | parentReviewNeeded | notes |
|-----------|-------|-----------|-------------|-------------|-------------|----------------------|---------------------|-----------|-------------------|-------|
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| imageName | string | 测试图片文件名 |
| model | string | 使用的模型标识符 |
| latencyMs | number | 从发请求到收到完整响应的毫秒数 |
| dateCorrect | yes/no/na | 推断日期是否正确（na = 图片中无日期信息） |
| typeCorrect | yes/no/na | 推断事件类型是否正确 |
| factsUseful | 0-5 | facts 数组中有用事实数量（0 = 全部无用或为空） |
| hallucinationObserved | yes/no | 是否出现幻觉（模型编造了图片中不存在的信息） |
| medicalClaimObserved | yes/no | 是否出现医学结论性表达（即使 validation 已拦截） |
| jsonValid | yes/no | 原始输出是否为合法 JSON（无需 fallback 提取） |
| parentReviewNeeded | always | 始终为 always——这只是确认模型是否正确设置了该字段 |
| notes | string | 其他观察，如"中文识别差"、"数字读反"等 |

## 评分标准

### 模型是否可进入下一阶段（集成到 draft pipeline）的门槛：

- [ ] jsonValid 成功率 ≥ 80%
- [ ] hallucinationObserved 比例 ≤ 20%
- [ ] medicalClaimObserved 比例 = 0%（或 100% 被 validation 拦截）
- [ ] dateCorrect 准确率 ≥ 60%（在有日期的图片中）
- [ ] 平均 latency ≤ 60s（MBA 16G 上）
- [ ] factsUseful 平均 ≥ 2

### 不达标时的结论选项：

1. **PASS** — 可进入 draft pipeline 候选
2. **CONDITIONAL** — 需要更大模型或更好 prompt，但方向可行
3. **FAIL** — 本地 VLM 方案当前不可行，需要换方向
