# ADR 0001：Skill Marketplace 工程边界

- 状态：接受
- 日期：2026-07-15
- 关联：MKP-001、MKP-003、MKP-007、MKP-009

## 背景

Proma 已有 Electron 本地 Skill 管理能力，但没有远程市场、公共浏览服务和安全安装事务。市场需要同时服务公共 Web、Electron 和后续管理后台，且不能破坏本地优先的既有架构。

## 决策

1. 公共 Web 与管理端位于同一 `apps/marketplace-web`，管理端保留 `/admin/*` 路由；M0–M2 不实现管理业务。
2. API 位于独立 `apps/marketplace-api`，服务端可使用 PostgreSQL 与对象存储。
3. Manifest、SemVer、包路径和 ZIP 安全规则位于无 UI、Electron、数据库依赖的 `@proma/marketplace-domain`。
4. API、Web、Electron 共用的 DTO 位于 `@proma/shared`；数据库 row 和领域实现不得从 shared 导出。
5. Electron 使用原生 React 页面，不使用 `webview`、BrowserView 或远程 HTML。
6. Electron 本地状态继续使用文件和 Jotai，不引入本地数据库或 localStorage。
7. 市场安装使用独立 installer，不复用现有“删除后复制”的默认 Skill 更新流程。

## 替代方案

- 独立市场仓库：会复制类型、视觉与发布工具，拒绝。
- Electron 嵌入公共 Web：扩大远程内容权限边界并弱化离线体验，拒绝。
- 将领域逻辑放入 shared：会让 shared 同时承担 contract 与实现，拒绝。

## 后果

- 需要新增两个 app 和一个 domain package。
- IPC 变更必须同步 shared、main、preload、renderer 四层。
- Web 与 Electron 可复用纯展示组件，但平台操作通过 adapter 隔离。

