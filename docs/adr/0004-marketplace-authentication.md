# ADR 0004：Marketplace 认证边界

- 状态：接受
- 日期：2026-07-15
- 关联：MKP-001、MKP-042

## 决策

1. 公共浏览和 M2 安装不要求公共账户登录。
2. 管理端在 M3 使用 GitHub OAuth，API 以安全 Cookie 保存服务端 session，并以管理员 allowlist 强制授权。
3. Electron 不持久化 GitHub 管理凭证，也不继承公共 Web 的管理会话。
4. 安装统计使用随机幂等 event id，不作为用户身份。

## 后果

- M0–M2 不引入公共用户表。
- 收藏、评分、团队私有市场和作者自助注册不在安装 MVP 范围内。

