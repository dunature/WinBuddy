# Marketplace 首发内容

本目录是 Marketplace 内容源，不属于 Electron `default-skills`。运行 `bun run marketplace:content:validate` 会为每个条目生成标准 `SKILL.md`、`CHANGELOG.md`、`LICENSE` 与 `examples/examples.json`，并使用 `@proma/marketplace-domain` 的同一解析器校验。

发布时必须走“上传 → quarantine → 自动校验 → 人工审核 → 发布”链路。默认作者为 `@proma-editor / Proma 编辑部`，审核前可在管理端填写真实作者，变更进入审计日志。

审核清单：描述先说明用户收益；权限最小化；案例脱敏且不含隐藏思维链；不得声明不存在的工具；版本与 CHANGELOG 一致；许可证必须随包提供。
