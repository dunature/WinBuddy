# Marketplace 阿里云部署与回滚

生产拓扑：Web 构建产物发布到 OSS 静态站点并可接 CDN；API/Worker 镜像推送 ACR 后运行在 ECS；数据使用 RDS PostgreSQL；quarantine 与正式包使用不同 OSS key 前缀。ALB/Nginx 只暴露 API HTTPS 入口。

必需 Secret：`MARKETPLACE_DATABASE_URL`、OSS bucket/region/endpoint/access key、GitHub OAuth client/secret、至少 32 字节 session secret。四个 `MARKETPLACE_FEATURE_*` 生产默认均为 `false`。

部署顺序：备份 RDS → `db:migrate` → 启动 Worker → 健康检查 API → 发布 Web → 仅开启 admin → 内部 browse → 内部 install → community。每一步验证日志无 Prompt、本地路径或文件正文。

回滚：立即关闭 browse/install/community；回滚 ECS 镜像与 OSS Web 版本；保留向前兼容 migration，不执行破坏性降级；确认旧 `latest_published_version_id` 仍可下载。对象复制成功但数据库失败的孤儿由发布流程删除。
