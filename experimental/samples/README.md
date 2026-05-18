# experimental/samples/

放置本地测试图片的目录。

## 使用方式

将你要测试的图片复制到此目录，例如：

```bash
cp ~/Desktop/ultrasound-report.jpg experimental/samples/
cp ~/Desktop/prenatal-checkup.png experimental/samples/
```

然后运行 batch 脚本：

```bash
VLM_MODEL=moondream2 npx tsx experimental/local-vlm-batch.ts experimental/samples/
```

## 注意

- **不要 git commit 真实图片**——目录已配置 `.gitignore` 排除所有图片文件。
- 建议测试图片类型：孕检报告、B超截图、疫苗接种单、成长记录照片。
- 不要放含个人身份证号/手机号的原始图片（本地测试也注意隐私习惯）。

## 样本命名建议

```
ultrasound-nt-12w.jpg       # NT 检查 B超
prenatal-blood-test.png     # 产检血液报告
vaccine-card.jpg            # 疫苗接种卡
growth-chart-photo.png      # 成长曲线照片
unrelated-landscape.jpg     # 无关图片（测试拒绝能力）
```
