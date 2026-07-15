# 上传 WinBuddy 到 GitHub（清空历史）— 待你确认

## 🎯 目标

把 WinBuddy 项目的源码推送到 `https://github.com/dunature/WinBuddy.git`，**推上去的是干净的初始化历史**，不保留之前的所有提交记录。

## ⚠️ 当前阻塞项（需要你回答）

我无法直接开始执行，有 4 个关键未知项：

### Q1. WinBuddy 项目源码在哪里？

我在 `/Users/a2030/02-Area/` 全盘搜过，**没有找到 `WinBuddy` 目录**。你希望用哪种方式？

| 选项 | 说明 |
|------|------|
| **A** | 你直接告诉我本地路径，例如 `~/code/WinBuddy`、`~/Desktop/WinBuddy` |
| **B** | 你先手动把 WinBuddy 压缩成 zip 放到某个路径，我解压后处理（解压路径建议用 `/Users/a2030/02-Area/Proma/sessions/260715-proud-slate/data/winbuddy/`） |
| **C** | 提供另一个远程 URL 我去 `git clone`（注意：这种方式拿到的还是有历史的，需要再清洗） |
| **D** | 全新创建 — 由你贴出文件清单 / 关键代码，我在工作目录里搭一个全新仓库 |

### Q2. GitHub 认证方式？

`https://github.com/dunature/WinBuddy.git` 推送需要凭证，三选一：

| 选项 | 操作 |
|------|------|
| **A** | **Personal Access Token（推荐）**：去 https://github.com/settings/tokens 生成一个 `repo` 权限的 token。**请通过 Craft Agent 的安全输入框提供**（不要直接贴在对话里）— 我会用 `source_credential_prompt` 工具弹出一个带掩码的输入框 |
| **B** | **SSH Key**：如果你之前配过，告诉我 `~/.ssh/id_rsa` 或 `id_ed25519` 是否已添加到 GitHub |
| **C** | **GitHub CLI**：如果 `gh auth login` 过了，直接用 |

⚠️ **额外问题**：token / SSH 所属的 GitHub 账号是否就是 `dunature` 这个用户？必须是该账号（或被列为协作者）才能推送到 `dunature/WinBuddy`。

### Q3. GitHub 端仓库的状态？

| 选项 | 影响 |
|------|------|
| **A. 仓库已存在** | 我用 `git push --force` 覆盖远程历史（⚠️ 会丢失 GitHub 端现有内容） |
| **B. 仓库不存在** | 我用 `gh repo create dunature/WinBuddy --public --source=. --remote=origin` 或 REST API 创建（需要 token 有 `repo` 权限 + `dunature` 组织授权） |

### Q4. "去除历史"的精确含义？

| 选项 | 结果 |
|------|------|
| **A. 单个 initial commit** | 清空所有历史，只留 1 个 `Initial commit`（保留 .gitignore、README 等） |
| **B. 包含当前原始信息** | 把现有最后一次提交作为新仓库的第 1 个 commit（其它全部丢弃） |
| **C. 带 squash 注释** | 把历史打包成 1 个 commit 且 commit message 描述原仓库大致情况 |

**默认推荐 A**，干净利落。

## 📋 一旦回答完，我会执行的计划

1. **拿到源码**（基于 Q1）
2. **认证 GitHub**（基于 Q2）— 通过安全输入框
3. **创建或接管远程仓库**（基于 Q3）
4. **重写本地 git 历史**（基于 Q4）
   ```bash
   cd <winbuddy 来源>
   rm -rf .git
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://<TOKEN>@github.com/dunature/WinBuddy.git
   git branch -M main
   git push -u origin main --force   # 或者不带 --force 如果是新建
   ```
5. **回显结果**：远程仓库 URL、新仓库首页截图（如可）、commit SHA

## 🚧 当前模式

当前是 **Explore 模式**，只能读不能写。需要你切到 **Ask to Edit** 或 **Execute** 模式我才能执行 `git push`。我建议：

> **SHIFT+TAB 切到 Execute 模式后再开始**

## ❓请回答

请回我类似：

```
Q1: B（把 zip 放到 data/winbuddy.zip）
Q2: A（PAT 走安全输入框）
Q3: A（仓库已存在）
Q4: A（单个 Initial commit）
```

我收到答复后会立刻给出一份完整可执行计划（SubmitPlan），你点 "Accept Plan" 就开始干。
