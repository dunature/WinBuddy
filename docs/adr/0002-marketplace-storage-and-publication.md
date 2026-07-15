# ADR 0002：Marketplace 存储与公开版本

- 状态：接受
- 日期：2026-07-15
- 关联：MKP-010、MKP-011、MKP-013–015

## 决策

1. PostgreSQL 保存作者、分类、Skill、版本、文件索引、案例和安装事件；对象存储保存 ZIP 与资源文件。
2. 上传包先写入 `quarantine/submissions/{submissionId}/package.zip`；公开包使用 `skills/{skillId}/{version}/package.zip`。
3. 每个 Skill 使用可空的 `latestPublishedVersionId` 指向当前公开版本；候选版本不得修改该指针。
4. 公共 API 只返回 `published` 且未下架/归档的版本。
5. 包下载通过短期签名 URL；数据库或对象存储任一步失败都不能产生“已发布”假状态。
6. 测试使用内存对象存储 adapter，不连接真实云存储。

## 后果

- 发布需要数据库事务与对象存储补偿逻辑；该流程在 M3 实现。
- M0–M2 可通过 seed 的 published 数据完成公共浏览和安装测试。

