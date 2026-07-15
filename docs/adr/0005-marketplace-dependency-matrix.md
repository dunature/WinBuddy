# ADR 0005：Marketplace 依赖版本矩阵

- 状态：接受
- 调研日期：2026-07-15
- 数据源：npm registry package metadata
- 关联：MKP-002

所有依赖采用精确版本。新增前仍由 `bun install` 验证当前 Bun workspace、React 18、Vite 6 和 Electron 39 构建。

| 用途 | 包与版本 | 许可证 | 兼容性与选择理由 | 不采用时的替代 |
|---|---|---|---|---|
| API | `hono@4.12.30` | MIT | Node >=16.9；支持 Bun Web API | Bun 原生 server + 手写 router |
| ORM | `drizzle-orm@0.45.2`、`drizzle-kit@0.31.10` | Apache-2.0 / MIT | 类型化 schema 与 migration | SQL migration + `postgres` |
| PostgreSQL | `postgres@3.4.9` | Unlicense | Node >=12；轻量、支持 Bun | `pg` |
| YAML | `yaml@2.9.0` | ISC | Node >=14.6；支持 block scalar 与节点范围 | `js-yaml` |
| SemVer | `semver@7.8.5` | ISC | Node >=10；完整 prerelease/build 规则 | 内部小型 parser，不推荐 |
| ZIP | `yauzl@3.4.0`、`@types/yauzl@3.4.0` | MIT | lazy central-directory 读取，便于先检查后解压 | `unzipper` |
| 对象存储 | `@aws-sdk/client-s3@3.1087.0`、`@aws-sdk/s3-request-presigner@3.1087.0` | Apache-2.0 | Node >=20；兼容 S3/OSS endpoint | 阿里云 OSS SDK |
| Web 路由 | `react-router-dom@7.18.1` | MIT | Node >=20；支持 React 18 | 轻量自研路由，不推荐 |
| Runtime schema | `zod@4.4.3` | MIT | API/IPC 输入统一校验 | 手写 type guard |
| 组件测试 | `@testing-library/react@16.3.2` | MIT | Node >=18；面向行为测试 | Bun DOM 测试工具 |
| E2E | `@playwright/test@1.61.1` | Apache-2.0 | Node >=18；覆盖 Web/Electron | 独立浏览器脚本 |

GitHub OAuth 在 M3 使用标准 authorize/token HTTP 流，不为 M0–M2 引入 OAuth wrapper。生产依赖只进入实际使用它的 workspace，避免扩大 Electron 包体。
