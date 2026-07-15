# ADR 0003：Electron 安装事务与来源元数据

- 状态：接受
- 日期：2026-07-15
- 关联：MKP-008、MKP-030–041

## 决策

1. renderer 只能提交工作区 slug/id，main 从已知工作区解析目标路径；不接受绝对目标路径。
2. 安装包下载到 `~/.proma/tmp/marketplace-installs/{installId}`，依次执行下载、SHA256、ZIP 预检、staging 解压、Manifest 复检、冲突检测和原子提交。
3. 同版本同 hash 返回“已安装”；无市场来源的同名目录、本地修改和降级均进入冲突，默认不覆盖。
4. MVP 不做逐文件合并；用户只能取消或明确选择“备份后整体替换”。
5. 成功安装后写入 `.proma-source.json`：

```json
{
  "schemaVersion": 1,
  "sourceType": "marketplace",
  "marketplaceSkillId": "uuid",
  "slug": "deep-research",
  "version": "1.0.0",
  "sha256": "hex",
  "installedAt": "2026-07-15T00:00:00.000Z"
}
```

6. 安装事件只在原子提交成功后上报；失败不回滚本地安装，也不上传 Prompt、本地路径或文件正文。

## 后果

- 现有 workspace import 来源继续兼容，但市场来源使用独立 schema。
- 安装状态使用 `installId` 关联全局事件，页面卸载不得终止状态追踪。

