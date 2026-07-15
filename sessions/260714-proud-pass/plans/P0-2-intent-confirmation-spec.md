# P0-2 意图选项/结构化确认 - 完整实现规格说明书

**功能优先级**: P0（最高优先级）  
**功能名称**: 意图选项 / 结构化确认（Intent Confirmation）  
**目标**: 让 Agent 在首轮交互中主动识别模糊意图，通过结构化选项确认用户真实需求，避免错误执行  
**实现方案**: 方案 C — 系统提示词强规则 + 复用现有 AskUserQuestion UI  
**API 调用**: 零额外 API 调用（完全基于系统提示词引导 Agent 行为）

---

## 1. 功能概述

### 1.1 核心问题
用户输入模糊时（如"帮我改一下这个项目"、"优化这个代码"），Agent 容易假设意图并直接执行，导致：
- 做了用户不想要的事情
- 浪费时间和 token
- 用户体验差

### 1.2 解决方案
通过系统提示词规则，让 Agent 学会：
1. **识别模糊意图**：判断用户请求是否存在多种合理解读
2. **区分决策级别**：关键决策必须确认，低风险细节自行判断
3. **结构化确认**：使用 `AskUserQuestion` 工具提供清晰的选项卡

### 1.3 设计原则
- **零额外 API 调用**：不引入新的模型调用，完全依赖系统提示词
- **复用现有 UI**：`AskUserBanner` 已完善，无需任何 UI 开发
- **不过度确认**：只对"关键决策"确认，"低风险细节"自行判断
- **首轮聚焦**：主要在第一轮交互时触发，后续对话中 Agent 已有上下文

---

## 2. 系统指令规则设计

### 2.1 插入位置
在 `agent-prompt-builder.ts` 的 `buildSystemPrompt()` 函数中，**替换/增强** 现有的 "不确定性处理" 段落。

### 2.2 完整系统指令文本

```markdown
## 意图确认与结构化选项

**首轮交互时，主动识别模糊意图并通过结构化选项确认用户真实需求。**

### 何时需要确认（关键决策 → 必须使用 AskUserQuestion）

以下场景存在多种合理解读，必须用 AskUserQuestion 提供结构化选项：

1. **任务方向不明确**
   - 用户说"帮我改一下这个项目" → 改什么？重构？修 bug？加功能？
   - 用户说"优化一下" → 优化性能？可读性？架构？

2. **技术选型存在多个方案**
   - 用户说"加个数据库" → SQLite / PostgreSQL / MongoDB？
   - 用户说"做个前端" → React / Vue / Svelte？

3. **范围和优先级不清晰**
   - 用户说"把所有文件整理一下" → 整理哪些文件？按什么维度？
   - 用户说"做个完整的系统" → MVP 还是完整版？

4. **存在破坏性操作风险**
   - 用户说"清理一下代码" → 是重构还是删除未使用的代码？
   - 用户说"更新依赖" → 小版本升级还是大版本迁移？

### 何时不需要确认（低风险细节 → 自行判断）

以下场景意图清晰，不需要打断用户：

1. **单文件操作**：用户明确指定了文件和操作（如"把 utils.ts 中的 formatDate 改成 dayjs"）
2. **常规任务**：意图明确的标准任务（如"写个单元测试"、"加个 error handler"）
3. **信息查询**：纯信息请求（如"解释一下这段代码"、"这个函数做什么"）
4. **已有上下文**：对话中已经有足够上下文，可以推断意图

### AskUserQuestion 使用规范

#### 问题设计原则
- **每个问题聚焦一个决策维度**：不要在一个问题里混杂多个决策
- **选项数量 2-5 个**：太少无意义，太多增加认知负担
- **每个选项必须有 description**：简短说明该选项的含义和适用场景
- **推荐选项放第一个**：Agent 认为最合适的选项排在首位
- **使用 preview 展示细节**：对于技术方案类选项，用 Markdown preview 展示具体内容

#### 多问题拆分
当有多个决策维度时，拆成多个问题（AskUserQuestion 支持多 Tab）：
- 问题 1：任务方向（如"你想要我做什么？"）
- 问题 2：技术方案（如"使用哪种方案？"）
- 问题 3：范围和约束（如"做到什么程度？"）

#### 示例调用格式

```json
{
  "questions": [
    {
      "question": "你说的「优化一下」具体是指哪方面？",
      "header": "优化方向",
      "multiSelect": true,
      "options": [
        {
          "label": "性能优化",
          "description": "减少响应时间、降低内存占用、优化渲染",
          "preview": "## 性能优化方案\n\n1. 分析瓶颈点（CPU Profile、Memory Snapshot）\n2. 优化热路径\n3. 减少不必要的重渲染\n4. 懒加载非关键资源"
        },
        {
          "label": "代码重构",
          "description": "改善代码结构、可读性和可维护性",
          "preview": "## 代码重构方案\n\n1. 识别重复代码和设计问题\n2. 提取公共模块\n3. 统一命名和代码风格\n4. 补充类型定义和注释"
        },
        {
          "label": "架构优化",
          "description": "调整模块划分、依赖关系和数据流",
          "preview": "## 架构优化方案\n\n1. 分析当前架构的问题点\n2. 设计新的模块边界\n3. 定义清晰的接口\n4. 渐进式迁移"
        }
      ]
    }
  ]
}
```

### 决策流程

```
用户输入 → 意图是否清晰？
├── 清晰 → 直接执行
├── 部分清晰 → 先执行确定部分 + AskUserQuestion 确认不确定部分
└── 完全模糊 → AskUserQuestion 确认意图后再执行
```

### 避免过度确认

- 同一轮对话中，AskUserQuestion 最多问 **3 个问题**
- 如果用户的回答暗示了其他决策，直接推断，不再追问
- 用户明确表示"你来决定"、"随便"、"都行"时，按 Agent 最佳判断执行
```

### 2.3 与现有段落的合并策略

现有的 "不确定性处理" 段落将被**替换**为上述更详细的版本。原因是：
- 现有段落过于笼统（"把选项列清楚"），缺乏具体触发条件
- 新版本包含明确的分类标准（何时确认 vs 何时不确认）
- 新版本包含 AskUserQuestion 工具的具体使用规范

---

## 3. 典型场景示例

### 3.1 场景 A：模糊任务方向（需要确认）

**用户输入**：
> "帮我改一下这个项目"

**Agent 正确行为**：
```
调用 AskUserQuestion：
{
  "questions": [
    {
      "question": "你希望我对这个项目做什么？",
      "header": "任务方向",
      "options": [
        {
          "label": "代码审查",
          "description": "检查代码质量、发现问题和改进点",
          "preview": "## 代码审查\n\n1. 分析代码结构和设计模式\n2. 识别 bug 和潜在问题\n3. 评估性能和安全性\n4. 输出改进建议报告"
        },
        {
          "label": "Bug 修复",
          "description": "找到并修复已知的 bug",
          "preview": "## Bug 修复\n\n1. 复现问题\n2. 定位根因\n3. 实施修复\n4. 编写回归测试"
        },
        {
          "label": "新功能开发",
          "description": "基于现有代码添加新功能",
          "preview": "## 新功能开发\n\n1. 需求分析和方案设计\n2. 代码实现\n3. 测试覆盖\n4. 文档更新"
        },
        {
          "label": "重构优化",
          "description": "改善代码结构和质量，不改变功能",
          "preview": "## 重构优化\n\n1. 识别技术债务\n2. 设计新架构\n3. 渐进式重构\n4. 确保功能不变"
        }
      ]
    }
  ]
}
```

### 3.2 场景 B：技术选型多方案（需要确认）

**用户输入**：
> "给这个项目加个数据库"

**Agent 正确行为**：
```
调用 AskUserQuestion：
{
  "questions": [
    {
      "question": "你的项目需要哪种类型的数据库？",
      "header": "数据库选型",
      "options": [
        {
          "label": "SQLite",
          "description": "嵌入式、零配置，适合小型项目和本地应用",
          "preview": "## SQLite\n\n**优点**\n- 零配置、单文件存储\n- 适合嵌入式和本地应用\n- 无需额外进程\n\n**缺点**\n- 不支持高并发写入\n- 不适合分布式场景\n\n**推荐场景**: 桌面应用、个人项目、原型开发"
        },
        {
          "label": "PostgreSQL",
          "description": "功能完善的关系型数据库，适合生产环境",
          "preview": "## PostgreSQL\n\n**优点**\n- ACID 事务、高可靠性\n- 丰富的数据类型和索引\n- 强大的查询优化器\n\n**缺点**\n- 需要独立进程和配置\n- 学习曲线较陡\n\n**推荐场景**: Web 应用、企业级系统、复杂查询"
        },
        {
          "label": "MongoDB",
          "description": "文档型数据库，Schema 灵活，适合快速迭代",
          "preview": "## MongoDB\n\n**优点**\n- Schema-free、灵活的数据模型\n- 水平扩展容易\n- 适合非结构化数据\n\n**缺点**\n- 事务支持有限\n- 存储空间占用大\n\n**推荐场景**: 内容管理、日志分析、快速原型"
        }
      ]
    }
  ]
}
```

### 3.3 场景 C：意图清晰（不需要确认）

**用户输入**：
> "把 src/utils/date.ts 中的 formatDate 函数改成使用 dayjs"

**Agent 正确行为**：
> 直接执行。用户明确指定了文件路径、函数名和修改方向，无需确认。

### 3.4 场景 D：部分清晰（执行确定部分 + 确认不确定部分）

**用户输入**：
> "帮我写个用户登录功能"

**Agent 正确行为**：
```
调用 AskUserQuestion：
{
  "questions": [
    {
      "question": "登录功能的认证方式你倾向哪种？",
      "header": "认证方式",
      "options": [
        {
          "label": "JWT Token",
          "description": "无状态认证，适合前后端分离架构",
          "preview": "## JWT Token 认证\n\n- 登录后签发 access_token + refresh_token\n- 前端存储在 localStorage/cookie\n- 适合 SPA 和移动端"
        },
        {
          "label": "Session + Cookie",
          "description": "有状态认证，传统 Web 应用常用",
          "preview": "## Session + Cookie\n\n- 服务端维护 session 存储\n- 通过 cookie 传递 session ID\n- 适合传统 Web 应用"
        },
        {
          "label": "OAuth 2.0",
          "description": "第三方登录（Google、GitHub 等）",
          "preview": "## OAuth 2.0\n\n- 支持第三方社交登录\n- 用户无需注册新账号\n- 可结合 JWT 使用"
        }
      ]
    },
    {
      "question": "需要支持哪些登录方式？",
      "header": "登录方式",
      "multiSelect": true,
      "options": [
        { "label": "用户名 + 密码", "description": "最基本的登录方式" },
        { "label": "手机号 + 验证码", "description": "短信验证码登录" },
        { "label": "邮箱 + 验证码", "description": "邮件验证码登录" },
        { "label": "第三方登录", "description": "Google/GitHub/微信等" }
      ]
    }
  ]
}
```

### 3.5 场景 E：用户回答暗示其他决策（不再追问）

**Agent 问**："使用哪种数据库？"  
**用户回答**："SQLite 就行，项目很小"

**Agent 正确行为**：
> 直接执行 SQLite 方案。用户说"项目很小"暗示了不需要复杂的部署配置、不需要高并发支持，Agent 可以自行判断使用 SQLite 默认配置。

---

## 4. 技术实现

### 4.1 修改文件清单

| 文件路径 | 修改内容 | 复杂度 |
|---------|---------|--------|
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | 替换"不确定性处理"段落为新的"意图确认与结构化选项" | 低 |

**仅此一个文件**，因为：
- AskUserBanner UI 已完善，无需修改
- AskUserQuestion 工具已由 SDK 注册，无需新增
- IPC 通道和类型定义已存在

### 4.2 代码变更详情

```diff
// apps/electron/src/main/lib/agent-prompt-builder.ts

  // 不确定性处理策略
- sections.push(`## 不确定性处理
-
- **遇到不确定的部分时，站在用户角度多想一步，把可选方案梳理完善再交给用户判断：**
- - 把你能想到的选项列清楚，每个选项附带简短说明（利弊、适用场景），降低用户决策成本
- - 问题较多或方向差异较大时，拆分成几个独立的小问题分别抛给用户，不要一次性堆一大段
- - 抛出选择后耐心等待用户反馈再继续，不要在没有确认的情况下擅自替用户拍板
- - 特别是在触发 brainstorming / 头脑风暴类 Skill 时，通过逐步提问引导用户明确需求和方向，而非让用户自己大段输入
- - 发现用户的假设或判断可能有误时，主动指出并提供依据，不要盲目附和`)

+ sections.push(`## 意图确认与结构化选项
+
+ **首轮交互时，主动识别模糊意图并通过 AskUserQuestion 工具提供结构化选项确认用户真实需求。**
+
+ ### 何时需要确认（关键决策 → 必须使用 AskUserQuestion）
+
+ 以下场景存在多种合理解读，必须用 AskUserQuestion 提供结构化选项：
+
+ 1. **任务方向不明确**
+    - 用户说"帮我改一下这个项目" → 改什么？重构？修 bug？加功能？
+    - 用户说"优化一下" → 优化性能？可读性？架构？
+
+ 2. **技术选型存在多个方案**
+    - 用户说"加个数据库" → SQLite / PostgreSQL / MongoDB？
+    - 用户说"做个前端" → React / Vue / Svelte？
+
+ 3. **范围和优先级不清晰**
+    - 用户说"把所有文件整理一下" → 整理哪些文件？按什么维度？
+    - 用户说"做个完整的系统" → MVP 还是完整版？
+
+ 4. **存在破坏性操作风险**
+    - 用户说"清理一下代码" → 是重构还是删除未使用的代码？
+    - 用户说"更新依赖" → 小版本升级还是大版本迁移？
+
+ ### 何时不需要确认（低风险细节 → 自行判断）
+
+ 以下场景意图清晰，不需要打断用户：
+
+ 1. **单文件操作**：用户明确指定了文件和操作（如"把 utils.ts 中的 formatDate 改成 dayjs"）
+ 2. **常规任务**：意图明确的标准任务（如"写个单元测试"、"加个 error handler"）
+ 3. **信息查询**：纯信息请求（如"解释一下这段代码"、"这个函数做什么"）
+ 4. **已有上下文**：对话中已经有足够上下文，可以推断意图
+
+ ### AskUserQuestion 使用规范
+
+ #### 问题设计原则
+ - **每个问题聚焦一个决策维度**：不要在一个问题里混杂多个决策
+ - **选项数量 2-5 个**：太少无意义，太多增加认知负担
+ - **每个选项必须有 description**：简短说明该选项的含义和适用场景
+ - **推荐选项放第一个**：Agent 认为最合适的选项排在首位
+ - **善用 preview 展示细节**：对于技术方案类选项，用 Markdown preview 展示具体内容
+
+ #### 多问题拆分
+ 当有多个决策维度时，拆成多个问题（AskUserQuestion 支持多 Tab）：
+ - 问题 1：任务方向（如"你想要我做什么？"）
+ - 问题 2：技术方案（如"使用哪种方案？"）
+ - 问题 3：范围和约束（如"做到什么程度？"）
+
+ ### 决策流程
+
+ 用户输入 → 意图是否清晰？
+ - 清晰 → 直接执行
+ - 部分清晰 → 先执行确定部分 + AskUserQuestion 确认不确定部分
+ - 完全模糊 → AskUserQuestion 确认意图后再执行
+
+ ### 避免过度确认
+
+ - 同一轮对话中，AskUserQuestion 最多问 **3 个问题**
+ - 如果用户的回答暗示了其他决策，直接推断，不再追问
+ - 用户明确表示"你来决定"、"随便"、"都行"时，按 Agent 最佳判断执行
+ - 遇到不确定的部分时，站在用户角度多想一步，把可选方案梳理完善再交给用户判断
+ - 发现用户的假设或判断可能有误时，主动指出并提供依据，不要盲目附和`)
```

### 4.3 不变更的文件

以下文件**不需要修改**，因为现有实现已满足需求：

| 文件 | 原因 |
|------|------|
| `AskUserBanner.tsx` | UI 已完善，支持多选/单选/preview/键盘导航 |
| `agent-ask-user-service.ts` | 服务层已完善，管理请求生命周期 |
| `agent-orchestrator.ts` | 已拦截 AskUserQuestion 工具调用 |
| `packages/shared/src/types/agent.ts` | 类型定义已完善 |
| `preload/index.ts` | IPC 通道已存在 |

---

## 5. 测试策略

### 5.1 提示词验证测试（Prompt Evaluation）

由于 P0-2 完全基于系统提示词，测试重点是验证 Agent 行为是否符合预期：

```typescript
// tests/prompt-evaluation/intent-confirmation.test.ts

import { describe, test, expect } from 'bun:test'
import { buildSystemPrompt } from '../../apps/electron/src/main/lib/agent-prompt-builder'

describe('P0-2 意图确认规则 - 系统提示词验证', () => {
  const systemPrompt = buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'allow-all',
    workspaceName: 'Test',
    workspaceSlug: 'test',
  })

  test('系统提示词包含意图确认规则', () => {
    expect(systemPrompt).toContain('意图确认与结构化选项')
    expect(systemPrompt).toContain('何时需要确认')
    expect(systemPrompt).toContain('何时不需要确认')
    expect(systemPrompt).toContain('AskUserQuestion 使用规范')
  })

  test('系统提示词包含关键决策分类', () => {
    expect(systemPrompt).toContain('任务方向不明确')
    expect(systemPrompt).toContain('技术选型存在多个方案')
    expect(systemPrompt).toContain('范围和优先级不清晰')
    expect(systemPrompt).toContain('存在破坏性操作风险')
  })

  test('系统提示词包含避免过度确认规则', () => {
    expect(systemPrompt).toContain('避免过度确认')
    expect(systemPrompt).toContain('最多问 **3 个问题**')
    expect(systemPrompt).toContain('你来决定')
  })

  test('系统提示词包含问题设计原则', () => {
    expect(systemPrompt).toContain('每个问题聚焦一个决策维度')
    expect(systemPrompt).toContain('选项数量 2-5 个')
    expect(systemPrompt).toContain('每个选项必须有 description')
    expect(systemPrompt).toContain('推荐选项放第一个')
  })
})
```

### 5.2 行为验证测试（E2E Mock）

```typescript
// tests/e2e/intent-confirmation-behavior.test.ts

import { test, expect } from '@playwright/test'

test.describe('P0-2 意图确认行为验证', () => {

  test('模糊输入应触发 AskUserQuestion', async ({ page }) => {
    // 1. 输入模糊请求
    await page.fill('[data-testid="chat-input"]', '帮我改一下这个项目')
    await page.click('[data-testid="send-button"]')

    // 2. 等待 AskUserBanner 出现
    await page.waitForSelector('.ask-user-banner', { timeout: 30000 })

    // 3. 验证问题内容
    const questionText = await page.textContent('.ask-user-banner p')
    expect(questionText).toMatch(/做什么|方向|目标/)

    // 4. 验证选项数量（2-5 个）
    const optionCount = await page.locator('.ask-user-banner button[type="button"]').count()
    expect(optionCount).toBeGreaterThanOrEqual(2)
    expect(optionCount).toBeLessThanOrEqual(8) // 含"其他"和底部按钮
  })

  test('清晰输入不应触发 AskUserQuestion', async ({ page }) => {
    // 1. 输入明确请求
    await page.fill('[data-testid="chat-input"]', 
      '把 src/utils/date.ts 中的 formatDate 函数改成使用 dayjs')
    await page.click('[data-testid="send-button"]')

    // 2. 等待 Agent 开始回复（不应出现 AskUserBanner）
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 30000 })

    // 3. 验证没有 AskUserBanner
    const bannerCount = await page.locator('.ask-user-banner').count()
    expect(bannerCount).toBe(0)
  })

  test('用户选择后 Agent 应基于选择执行', async ({ page }) => {
    // 1. 输入模糊请求
    await page.fill('[data-testid="chat-input"]', '优化一下这个项目')
    await page.click('[data-testid="send-button"]')

    // 2. 等待 AskUserBanner
    await page.waitForSelector('.ask-user-banner', { timeout: 30000 })

    // 3. 选择第一个选项
    await page.click('.ask-user-banner button[type="button"]:first-of-type')

    // 4. 点击确认
    await page.click('.ask-user-banner button:has-text("确认")')

    // 5. 等待 AskUserBanner 消失
    await page.waitForSelector('.ask-user-banner', { state: 'hidden', timeout: 5000 })

    // 6. 验证 Agent 开始执行（基于用户选择）
    await page.waitForSelector('[data-testid="agent-response"]', { timeout: 30000 })
  })

  test('多问题场景应支持 Tab 切换', async ({ page }) => {
    // 1. 输入需要多决策的请求
    await page.fill('[data-testid="chat-input"]', '帮我写个用户登录功能')
    await page.click('[data-testid="send-button"]')

    // 2. 等待 AskUserBanner
    await page.waitForSelector('.ask-user-banner', { timeout: 30000 })

    // 3. 验证有多个 Tab
    const tabCount = await page.locator('.ask-user-banner .flex.gap-1 button').count()
    expect(tabCount).toBeGreaterThanOrEqual(2)

    // 4. 选择第一个问题的选项（自动跳转下一题）
    await page.click('.ask-user-banner button[type="button"]:first-of-type')

    // 5. 验证 Tab 自动切换
    await page.waitForTimeout(300) // 等待 auto-advance
    const activeTab = await page.locator('.ask-user-banner .bg-primary.text-primary-foreground.shadow-sm').first().textContent()
    expect(activeTab).toContain('2')
  })
})
```

---

## 6. 性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 首次确认延迟 | <5 秒 | 从用户发送到 AskUserBanner 显示 |
| 确认完成率 | >80% | 用户完成选项确认的比例 |
| 过度确认率 | <10% | 清晰输入下仍触发确认的比例 |
| 确认跳过率 | <5% | 模糊输入下未触发确认的比例 |

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Agent 忽略提示词规则 | 中 | 高 | 使用具体示例（而非抽象规则）强化指令 |
| 过度确认导致用户厌烦 | 低 | 中 | 明确"不需要确认"的场景清单 |
| 选项设计质量差 | 中 | 中 | 提供 preview 模板和 description 规范 |
| 模型版本更新导致行为变化 | 低 | 高 | 定期回归测试行为验证用例 |

---

## 8. 实施计划

### Phase 1: 系统提示词修改（0.5 天）
- [ ] 替换 `agent-prompt-builder.ts` 中的 "不确定性处理" 段落
- [ ] 确保新规则与现有段落（SubAgent 策略、交互规范）不冲突

### Phase 2: 提示词验证测试（0.5 天）
- [ ] 编写系统提示词内容验证测试
- [ ] 确认所有关键规则都包含在生成的提示词中

### Phase 3: 行为验证测试（1 天）
- [ ] 编写 E2E 行为验证测试
- [ ] 在真实 Agent 环境中验证 5 个典型场景
- [ ] 调整提示词直到行为符合预期

### Phase 4: 回归测试（0.5 天）
- [ ] 确认修改不影响现有 Agent 行为
- [ ] 验证计划模式、协作模式等不受影响

---

## 9. 验收标准

### 功能验收
- [ ] 模糊输入（如"帮我改一下"）触发 AskUserQuestion
- [ ] 清晰输入（如"改 formatDate 为 dayjs"）直接执行
- [ ] 多决策场景支持多 Tab 问题
- [ ] 选项包含 description 和 preview
- [ ] 推荐选项排在首位
- [ ] 用户选择后 Agent 基于选择执行

### 行为验收
- [ ] 同一轮对话最多 3 个问题
- [ ] 用户回答暗示其他决策时不再追问
- [ ] 用户说"你来决定"时 Agent 自行判断
- [ ] 首轮交互时更积极确认，后续对话减少确认

### 回归验收
- [ ] 计划模式行为不受影响
- [ ] 协作模式行为不受影响
- [ ] 权限审批流程不受影响
- [ ] ExitPlanMode 行为不受影响

---

## 10. 与 P0-1 的协同关系

P0-1（提示词优化）和 P0-2（意图确认）形成互补：

```
用户输入
  │
  ├─→ P0-1: 用户主动点击"优化"按钮 → 优化提示词质量
  │
  └─→ P0-2: Agent 自动识别模糊意图 → 结构化确认
  
两者不冲突：
- 用户可以先用 P0-1 优化输入，然后发送给 Agent
- Agent 收到优化后的输入，如果仍然模糊，触发 P0-2 确认
- P0-1 优化后的输入通常更清晰，会减少 P0-2 的触发频率
```

---

## 11. 后续增强（P1/P2）

### P1 增强
- **确认历史**：记录用户的确认选择，用于个性化推荐
- **智能阈值**：根据用户历史行为动态调整"何时确认"的阈值
- **确认模板**：为常见场景提供预设的选项模板

### P2 增强
- **确认反馈**：用户可以对确认结果评分（"这个确认很有用"/"不需要确认"）
- **A/B 测试**：对比不同确认策略的效果
- **跨会话学习**：记住用户在类似场景下的选择偏好

---

**文档版本**: v1.0  
**创建日期**: 2026-07-15  
**最后更新**: 2026-07-15  
**负责人**: Craft Agent  
**审核状态**: 待用户确认
