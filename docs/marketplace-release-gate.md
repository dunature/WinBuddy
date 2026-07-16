# Marketplace MVP Release Gate

更新时间：2026-07-16。公开安装的唯一放行条件是下列 12 项全部通过；在此之前 `browse`、`install`、`community` 保持生产关闭。

| # | 验收门 | 当前证据 | 状态 |
|---|---|---|---|
| 1 | 公共 API 只返回 published/current | `public-routes.test.ts`、PostgreSQL 管理链路测试 | 本地通过 |
| 2 | 市场卡片显示独立 `@作者名` | `SkillCard.test.tsx` | 本地通过 |
| 3 | 指南、文件、案例可安全浏览 | Markdown XSS、URL、文件与案例路由测试 | 本地通过 |
| 4 | Electron 不使用 WebView | Electron 市场使用原生 React；源码复核无 Marketplace WebView | 本地通过 |
| 5 | 下载包通过 hash 和 ZIP 安全检查 | Domain package validator、installer 测试 | 本地通过 |
| 6 | 同名本地 Skill 不会被静默覆盖 | installer 冲突与备份后整体替换测试 | 本地通过 |
| 7 | 安装失败不留下半成品 | hash、取消、zip bomb 与 staging 清理测试 | 本地通过 |
| 8 | 新版本审核不影响旧公开版本 | PostgreSQL 对象复制/事务失败回归测试 | 本地通过 |
| 9 | 发布、下架、归档均有审计记录 | PostgreSQL 管理链路与 RBAC 测试 | 本地通过 |
| 10 | P0 Skill 内容和案例完成审核 | 15 个真实 ZIP 逐包经过 PostgreSQL 上传、校验、审核与发布链路 | 本地通过 |
| 11 | macOS 与 Windows 安装主流程通过 | Marketplace Gate 的 macOS arm64/x64、Windows x64 矩阵 | CI 未启动 |
| 12 | 类型、测试、构建、安全、可访问性通过 | 本文命令与 Marketplace Gate | 本地通过；CI 未完成 |

## 本地门禁结果

- `bun run typecheck`：通过。
- `bun test`：413 项通过，0 失败。
- `bun run marketplace:content:validate`：通过，15 个真实包通过线上同源 Validator。
- `bun run --cwd apps/marketplace-api build`：通过。
- `bun run --cwd apps/marketplace-web build`：通过。
- Electron main/preload/renderer build：通过。
- `MARKETPLACE_TEST_ADMIN_DATABASE_URL=postgres://localhost/postgres bun run --cwd apps/marketplace-api test:integration`：3 项通过，包含 15 个首发包完整发布链路。
- `bun audit --audit-level=high`：通过，0 项 high/critical；传递依赖使用根级安全版本约束，并已通过文档解析、全仓测试与 Electron 构建回归。

## CI 状态

[Marketplace Gate run 29469649084](https://github.com/dunature/WinBuddy/actions/runs/29469649084) 的五个任务均未分配 runner。GitHub 注解为账号近期付款失败或 Actions spending limit 需要提高，因此该运行不代表任何平台测试失败或通过。修复 GitHub Billing/Actions 额度后必须重新运行，并把本表第 11、12 项更新为实际结果。

## 放行顺序

12 项全部通过后，先开启管理员与内部浏览，再开启内部安装，最后灰度开放公共浏览与社区内容。不得跳过 #72 起的堆叠 PR 合并顺序。
