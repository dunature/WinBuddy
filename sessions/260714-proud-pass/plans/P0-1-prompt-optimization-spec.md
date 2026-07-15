# P0-1 提示词优化按钮 - 完整实现规格说明书

**功能优先级**: P0（最高优先级）  
**功能名称**: 提示词优化按钮  
**目标**: 帮助用户将模糊、简短的请求转化为清晰、结构化、高效的指令  
**竞品参考**: QoderWork、WorkBuddy、CustomGPT.ai、FixMyPrompt  
**GitHub 参考**: 50+ 项目分析（prompt-optimizer ⭐32.2k、PromptWizard ⭐3.9k 等）

---

## 1. 功能概述

### 1.1 核心交互
- **按钮位置**: 输入框工具栏，位于语音按钮（Speech）和工具按钮（Tools）之间
- **触发方式**: 点击按钮调用轻量模型优化当前输入框内容
- **替换策略**: 直接替换输入框内容（无对比浮层）
- **撤回机制**: 提供 5 秒自动隐藏的"撤回"按钮

### 1.2 适用范围
- **Chat 模式**: 对话场景，侧重输出格式和约束条件
- **Agent 模式**: 任务执行场景，侧重执行步骤和验收标准
- **实现方式**: 使用 `{{mode}}` 变量区分优化策略

### 1.3 模型选择
- **调用模型**: 当前渠道的轻量模型（如 DeepSeek Flash / Qwen Flash）
- **选择理由**: 降低成本、提高响应速度、满足简单优化需求

---

## 2. 系统指令模板（System Prompt）

```markdown
# 角色
你是一个专业的提示词优化专家，帮助用户将模糊、简短的请求转化为清晰、结构化、高效的指令。你的目标是让 AI 助手更好地理解用户意图并输出高质量结果。

# 核心原则

## 1. 意图保留（最高优先级）
- **必须保留**用户的核心意图和任务目标
- 不得改变用户想要完成的任务类型
- 不得添加与原始请求无关的新需求

## 2. 分层扩展策略
根据输入长度采用不同强度的优化策略：

### 极短输入（<20 字符）→ 大胆扩展
**示例**：
- 输入："写个方案"
- 输出："作为资深商业顾问，请撰写一份完整的项目实施方案，包括项目背景分析、目标设定、实施步骤、时间规划、资源需求和风险评估。要求逻辑清晰、数据支撑、分章节输出，总字数控制在 2000-3000 字。"

**扩展维度**：
- ✅ 添加专业角色定义
- ✅ 补充任务上下文和背景
- ✅ 明确输出格式和结构
- ✅ 添加质量约束和验收标准
- ✅ 指定字数/长度范围

### 中等输入（20-100 字符）→ 结构化优化
**示例**：
- 输入："帮我分析这个代码的性能问题，给出优化建议"
- 输出："请深入分析提供的代码，从时间复杂度、空间复杂度、内存占用、I/O 操作四个维度识别性能瓶颈，并为每个问题提供具体的优化方案、预期收益和实施优先级。要求使用代码对比示例说明优化前后的差异。"

**优化重点**：
- ✅ 澄清模糊表述（如"这个问题"→明确具体维度）
- ✅ 补充缺失的约束条件
- ✅ 改善逻辑结构和层次
- ✅ 添加输出格式要求

### 详细输入（>100 字符）→ 轻量微调
**示例**：
- 输入："我想做一个 React 组件库，需要支持 TypeScript，要有完善的文档和测试，最好能自动发布到 npm"
- 输出："我想构建一个生产级 React 组件库，技术要求：TypeScript 严格模式、Jest + React Testing Library 单元测试覆盖率>80%、Storybook 交互式文档、基于 Changesets 的语义化版本管理和自动化 CI/CD 流水线发布到 npm。请提供完整的项目结构设计、核心组件实现方案、测试策略和发布流程。"

**微调原则**：
- ✅ 保留所有已有细节
- ✅ 仅改善表述清晰度
- ✅ 不添加用户未暗示的新需求
- ✅ 保持原有结构和重点

## 3. 模式感知（{{mode}} 变量）

### Chat 模式（对话场景）
优化重点：
- 输出格式（如"分点列出"、"使用表格对比"）
- 约束条件（如"不超过 500 字"、"用通俗语言"）
- 交互方式（如"先提问确认再回答"）

**示例**：
- 输入（Chat）："解释一下量子计算"
- 输出："请用通俗易懂的语言（避免过多专业术语）解释量子计算的核心概念，包括量子比特、叠加态、纠缠现象和量子优势。要求：1）用生活中的类比帮助理解；2）分 4 个段落，每段 100 字左右；3）最后给出 2-3 个实际应用场景。"

### Agent 模式（任务执行场景）
优化重点：
- 执行步骤（如"按以下顺序执行"）
- 文件范围（如"涉及的文件"）
- 验收标准（如"完成后验证"）
- 错误处理（如"如果失败则"）

**示例**：
- 输入（Agent）："重构用户认证模块"
- 输出："请重构用户认证模块，具体要求：1）分析现有代码结构，识别问题点；2）设计新的模块化架构（包含接口定义、实现层、测试层）；3）逐步重构，确保向后兼容；4）编写完整的单元测试（覆盖率>90%）；5）更新相关文档；6）提供迁移指南。涉及文件：src/auth/*, tests/auth/*。完成后运行 npm test 验证。"

# 输出规范

1. **直接输出**：只输出优化后的提示词，不要任何前缀说明
2. **语言保持**：保持用户的语言风格（中文/英文/混合）
3. **长度控制**：优化后长度不超过原文的 2-3 倍（极短输入除外）
4. **格式一致**：使用与用户相同的标点符号和段落风格

# 禁止行为

❌ 不得添加"请帮我"、"我想要"等冗余前缀
❌ 不得改变任务的核心目标（如把"写代码"变成"分析代码"）
❌ 不得添加与原始请求无关的新需求
❌ 不得过度扩展导致偏离用户意图
❌ 不得输出解释性文字（如"我为你优化为..."）
```

---

## 3. 完整示例集（测试用例）

### 3.1 极短输入（<20 字符）

| 模式 | 输入 | 输出 | 扩展倍数 |
|------|------|------|---------|
| Chat | "翻译这段话" | "请将以下内容翻译成英文，要求：1）保持原文的语气和风格；2）专业术语准确；3）语句通顺自然。如果原文有歧义，请提供多种可能的翻译并说明差异。" | 4.5x |
| Agent | "修复这个 bug" | "请定位并修复当前代码中的 bug，要求：1）先分析问题根因；2）提供最小化修复方案；3）编写回归测试；4）更新相关文档；5）说明如何避免类似问题。完成后运行测试套件验证。" | 6x |
| Chat | "写个方案" | "作为资深商业顾问，请撰写一份完整的项目实施方案，包括项目背景分析、目标设定、实施步骤、时间规划、资源需求和风险评估。要求逻辑清晰、数据支撑、分章节输出，总字数控制在 2000-3000 字。" | 5x |
| Agent | "优化性能" | "请对当前代码进行全面的性能优化，分析维度包括：1）算法复杂度；2）内存占用；3）I/O 操作；4）并发处理。要求：提供优化前后的性能对比数据、具体代码修改、预期收益和潜在风险。" | 5x |

### 3.2 中等输入（20-100 字符）

| 模式 | 输入 | 输出 | 扩展倍数 |
|------|------|------|---------|
| Chat | "分析一下这个数据" | "请深入分析提供的数据，从趋势、异常值、相关性三个维度进行解读，并给出可视化建议。要求：1）指出关键发现；2）提供可能的原因分析；3）给出行动建议。" | 2.5x |
| Agent | "帮我分析这个代码的性能问题" | "请深入分析提供的代码，从时间复杂度、空间复杂度、内存占用、I/O 操作四个维度识别性能瓶颈，并为每个问题提供具体的优化方案、预期收益和实施优先级。要求使用代码对比示例说明优化前后的差异。" | 2.8x |
| Chat | "对比一下 React 和 Vue" | "请从以下维度对比 React 和 Vue：1）学习曲线；2）性能表现；3）生态系统；4）社区支持；5）适用场景。要求使用表格形式呈现，并给出选型建议。" | 2.2x |
| Agent | "写个 API 接口" | "请设计并实现一个 RESTful API 接口，包括：1）请求参数定义和验证；2）业务逻辑处理；3）错误处理机制；4）日志记录；5）单元测试。要求符合 OpenAPI 规范，提供完整的文档说明。" | 2.5x |

### 3.3 详细输入（>100 字符）

| 模式 | 输入 | 输出 | 扩展倍数 |
|------|------|------|---------|
| Chat | "我想做一个 React 组件库，需要支持 TypeScript，要有完善的文档和测试，最好能自动发布到 npm" | "我想构建一个生产级 React 组件库，技术要求：TypeScript 严格模式、Jest + React Testing Library 单元测试覆盖率>80%、Storybook 交互式文档、基于 Changesets 的语义化版本管理和自动化 CI/CD 流水线发布到 npm。请提供完整的项目结构设计、核心组件实现方案、测试策略和发布流程。" | 1.8x |
| Agent | "重构用户认证模块，要用 JWT，支持刷新 token，还要有完整的测试" | "请重构用户认证模块，具体要求：1）采用 JWT 双 token 机制（access token + refresh token）；2）实现 token 刷新逻辑和过期处理；3）设计安全的 token 存储方案；4）编写完整的单元测试（覆盖率>90%）；5）提供集成测试示例；6）更新 API 文档。涉及文件：src/auth/*, tests/auth/*。完成后运行 npm test 验证。" | 1.6x |

---

## 4. 技术实现细节

### 4.1 API 调用流程

```typescript
// apps/electron/src/main/lib/ipc/handlers.ts

ipcMain.handle('chat:optimize-prompt', async (event, { text, mode }: { text: string; mode: 'chat' | 'agent' }) => {
  try {
    // 1. 获取当前渠道的轻量模型
    const currentModel = await modelManager.getCurrentModel();
    const liteModel = currentModel.getLiteModel(); // 如 DeepSeek Flash / Qwen Flash
    
    // 2. 构建系统指令（注入 mode 变量）
    const systemPrompt = OPTIMIZE_PROMPT_TEMPLATE.replace('{{mode}}', mode);
    
    // 3. 调用模型
    const response = await liteModel.chat({
      model: liteModel.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3, // 低温度确保稳定性
      max_tokens: 2000,
      stream: false // 非流式，等待完整结果
    });
    
    // 4. 返回优化后的文本
    const optimizedText = response.choices[0].message.content.trim();
    
    return {
      success: true,
      optimizedText,
      originalLength: text.length,
      optimizedLength: optimizedText.length,
      expansionRatio: optimizedText.length / text.length
    };
    
  } catch (error) {
    console.error('[IPC] optimize-prompt error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});
```

### 4.2 错误处理与撤回机制

```typescript
// apps/electron/src/renderer/components/chat/ChatInput.tsx

const handleOptimizePrompt = async () => {
  const editor = editorRef.current;
  if (!editor || editor.isEmpty) return;
  
  const originalText = editor.getText();
  setIsOptimizing(true);
  
  try {
    const result = await window.desktopAPI.optimizePrompt({
      text: originalText,
      mode: currentMode // 'chat' | 'agent'
    });
    
    if (result.success) {
      // 保存原始内容用于撤回
      setPreviousContent(originalText);
      
      // 替换输入框内容
      editor.commands.setContent(result.optimizedText);
      
      // 显示撤回按钮（5秒后自动隐藏）
      setShowUndo(true);
      setTimeout(() => setShowUndo(false), 5000);
      
      // 可选：显示扩展比例提示
      if (result.expansionRatio > 3) {
        toast.info('已大幅扩展提示词，请检查是否符合预期');
      }
    } else {
      toast.error(`优化失败：${result.error}`);
    }
  } catch (error) {
    toast.error('优化请求失败，请重试');
  } finally {
    setIsOptimizing(false);
  }
};

const handleUndoOptimize = () => {
  const editor = editorRef.current;
  if (editor && previousContent) {
    editor.commands.setContent(previousContent);
    setShowUndo(false);
  }
};
```

### 4.3 工具栏按钮 UI

```tsx
// apps/electron/src/renderer/components/chat/InputToolbarOverflow.tsx

export function InputToolbarOverflow({ mode }: { mode: 'chat' | 'agent' }) {
  const { isOptimizing, handleOptimizePrompt, showUndo, handleUndoOptimize } = usePromptOptimize();
  
  return (
    <div className="flex items-center gap-1">
      {/* 现有按钮 */}
      <ModelSelector />
      <ThinkingToggle />
      <AttachButton />
      <SpeechButton />
      
      {/* 新增：优化按钮 */}
      <button
        className={inputToolbarButtonClass}
        onClick={handleOptimizePrompt}
        disabled={isOptimizing}
        title="优化提示词"
        data-testid="optimize-button"
      >
        {isOptimizing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
      </button>
      
      {/* 新增：撤回按钮（条件显示） */}
      {showUndo && (
        <button
          className={inputToolbarButtonClass}
          onClick={handleUndoOptimize}
          title="撤回优化"
          data-testid="undo-button"
        >
          <Undo2 className="w-4 h-4" />
        </button>
      )}
      
      {/* 现有按钮 */}
      <ToolsButton />
      <ContextButton />
      <ClearButton />
    </div>
  );
}
```

---

## 5. 集成点清单

### 5.1 需要修改的文件

| 文件路径 | 修改内容 | 优先级 |
|---------|---------|--------|
| `apps/electron/src/main/lib/ipc/handlers.ts` | 新增 `chat:optimize-prompt` IPC handler | P0 |
| `apps/electron/src/main/lib/model-manager.ts` | 新增 `getLiteModel()` 方法获取轻量模型 | P0 |
| `apps/electron/src/renderer/components/chat/ChatInput.tsx` | 新增优化按钮和撤回按钮 UI | P0 |
| `apps/electron/src/renderer/components/chat/InputToolbarOverflow.tsx` | 在工具栏添加工具按钮 | P0 |
| `apps/electron/src/renderer/components/chat/input-toolbar-styles.ts` | 复用 `inputToolbarButtonClass` 样式 | P0 |
| `packages/shared/src/constants/ipc.ts` | 新增 `OPTIMIZE_PROMPT` IPC 常量 | P0 |
| `apps/electron/src/main/lib/prompts/optimize-prompt.ts` | 新增系统指令模板文件 | P0 |

### 5.2 新增文件

```typescript
// apps/electron/src/main/lib/prompts/optimize-prompt.ts

export const OPTIMIZE_PROMPT_TEMPLATE = `
# 角色
你是一个专业的提示词优化专家...（完整系统指令，见第 2 节）

## 3. 模式感知（{{mode}} 变量）
当前模式：{{mode}}
...
`;
```

### 5.3 IPC 通道定义

```typescript
// packages/shared/src/constants/ipc.ts

export const IPC_CHANNELS = {
  // ... 现有通道
  
  // 新增：提示词优化
  OPTIMIZE_PROMPT: 'chat:optimize-prompt',
} as const;

// IPC 类型定义
export interface OptimizePromptRequest {
  text: string;
  mode: 'chat' | 'agent';
}

export interface OptimizePromptResponse {
  success: boolean;
  optimizedText?: string;
  originalLength?: number;
  optimizedLength?: number;
  expansionRatio?: number;
  error?: string;
}
```

### 5.4 React Hook

```typescript
// apps/electron/src/renderer/hooks/usePromptOptimize.ts

import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export function usePromptOptimize() {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [previousContent, setPreviousContent] = useState<string | null>(null);
  
  const handleOptimizePrompt = useCallback(async (
    editor: Editor | null,
    mode: 'chat' | 'agent'
  ) => {
    if (!editor || editor.isEmpty) return;
    
    const originalText = editor.getText();
    setIsOptimizing(true);
    
    try {
      const result = await window.desktopAPI.optimizePrompt({
        text: originalText,
        mode
      });
      
      if (result.success && result.optimizedText) {
        setPreviousContent(originalText);
        editor.commands.setContent(result.optimizedText);
        setShowUndo(true);
        setTimeout(() => setShowUndo(false), 5000);
        
        if (result.expansionRatio && result.expansionRatio > 3) {
          toast.info('已大幅扩展提示词，请检查是否符合预期');
        }
      } else {
        toast.error(`优化失败：${result.error || '未知错误'}`);
      }
    } catch (error) {
      toast.error('优化请求失败，请重试');
    } finally {
      setIsOptimizing(false);
    }
  }, []);
  
  const handleUndoOptimize = useCallback((editor: Editor | null) => {
    if (editor && previousContent) {
      editor.commands.setContent(previousContent);
      setShowUndo(false);
      setPreviousContent(null);
    }
  }, [previousContent]);
  
  return {
    isOptimizing,
    showUndo,
    handleOptimizePrompt,
    handleUndoOptimize
  };
}
```

---

## 6. 测试策略

### 6.1 单元测试

```typescript
// tests/unit/optimize-prompt.test.ts

import { describe, test, expect } from 'bun:test';

describe('Prompt Optimization', () => {
  test('短输入（<20字符）应该大幅扩展', async () => {
    const input = '写个方案';
    const result = await optimizePrompt(input, 'chat');
    
    expect(result.success).toBe(true);
    expect(result.optimizedText).toBeDefined();
    expect(result.optimizedText!.length / input.length).toBeGreaterThan(3);
    expect(result.optimizedText).toContain('角色');
    expect(result.optimizedText).toContain('输出格式');
  });
  
  test('中等输入应该结构化优化', async () => {
    const input = '帮我分析这个代码的性能问题';
    const result = await optimizePrompt(input, 'agent');
    
    expect(result.success).toBe(true);
    expect(result.optimizedText).toBeDefined();
    expect(result.optimizedText!.length / input.length).toBeGreaterThan(1.5);
    expect(result.optimizedText!.length / input.length).toBeLessThan(3);
  });
  
  test('长输入应该轻量微调', async () => {
    const input = '我想做一个 React 组件库，需要支持 TypeScript，要有完善的文档和测试';
    const result = await optimizePrompt(input, 'chat');
    
    expect(result.success).toBe(true);
    expect(result.optimizedText).toBeDefined();
    expect(result.optimizedText!.length / input.length).toBeLessThan(2);
  });
  
  test('Chat 模式应该侧重输出格式', async () => {
    const input = '解释一下量子计算';
    const result = await optimizePrompt(input, 'chat');
    
    expect(result.success).toBe(true);
    expect(result.optimizedText).toMatch(/输出格式|分点|表格|段落/);
  });
  
  test('Agent 模式应该侧重执行步骤', async () => {
    const input = '重构用户认证模块';
    const result = await optimizePrompt(input, 'agent');
    
    expect(result.success).toBe(true);
    expect(result.optimizedText).toMatch(/步骤|文件|验证|测试/);
  });
  
  test('意图保留：不得改变任务核心目标', async () => {
    const input = '写代码';
    const result = await optimizePrompt(input, 'agent');
    
    expect(result.success).toBe(true);
    expect(result.optimizedText).toMatch(/编写|实现|开发/);
    expect(result.optimizedText).not.toMatch(/分析|审查|优化/);
  });
});
```

### 6.2 集成测试

```typescript
// tests/integration/chat-optimize.test.ts

import { test, expect } from '@playwright/test';

test.describe('Chat Optimize Integration', () => {
  test('完整流程：输入→优化→撤回→恢复', async ({ page }) => {
    const originalText = '写个方案';
    
    // 1. 输入原始文本
    await page.fill('[data-testid="chat-input"]', originalText);
    
    // 2. 点击优化按钮
    await page.click('[data-testid="optimize-button"]');
    
    // 3. 等待优化完成（显示撤回按钮）
    await page.waitForSelector('[data-testid="undo-button"]', { timeout: 10000 });
    
    // 4. 验证内容已替换
    const optimizedText = await page.textContent('[data-testid="chat-input"]');
    expect(optimizedText).not.toBe(originalText);
    expect(optimizedText!.length).toBeGreaterThan(originalText.length * 3);
    
    // 5. 点击撤回
    await page.click('[data-testid="undo-button"]');
    
    // 6. 验证恢复原始内容
    const restoredText = await page.textContent('[data-testid="chat-input"]');
    expect(restoredText).toBe(originalText);
  });
  
  test('优化失败时显示错误提示', async ({ page }) => {
    // Mock API 失败
    await page.route('**/optimize-prompt', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ success: false, error: 'API Error' })
      });
    });
    
    await page.fill('[data-testid="chat-input"]', '测试文本');
    await page.click('[data-testid="optimize-button"]');
    
    // 验证错误提示
    await expect(page.locator('.toast-error')).toBeVisible();
    await expect(page.locator('.toast-error')).toContainText('优化失败');
  });
  
  test('撤回按钮 5 秒后自动隐藏', async ({ page }) => {
    await page.fill('[data-testid="chat-input"]', '写个方案');
    await page.click('[data-testid="optimize-button"]');
    
    // 验证撤回按钮显示
    await expect(page.locator('[data-testid="undo-button"]')).toBeVisible();
    
    // 等待 5 秒
    await page.waitForTimeout(5000);
    
    // 验证撤回按钮隐藏
    await expect(page.locator('[data-testid="undo-button"]')).not.toBeVisible();
  });
});
```

### 6.3 E2E 测试

```typescript
// tests/e2e/optimize-prompt-e2e.test.ts

import { test, expect } from '@playwright/test';

test.describe('Prompt Optimization E2E', () => {
  test('Chat 模式优化并发送消息', async ({ page }) => {
    // 1. 打开应用
    await page.goto('/');
    
    // 2. 输入短文本
    await page.fill('[data-testid="chat-input"]', '翻译这段话');
    
    // 3. 点击优化
    await page.click('[data-testid="optimize-button"]');
    
    // 4. 等待优化完成
    await page.waitForSelector('[data-testid="undo-button"]');
    
    // 5. 验证优化结果
    const optimizedText = await page.textContent('[data-testid="chat-input"]');
    expect(optimizedText).toContain('翻译');
    expect(optimizedText).toContain('要求');
    
    // 6. 发送消息
    await page.click('[data-testid="send-button"]');
    
    // 7. 验证消息已发送
    await expect(page.locator('[data-testid="message-list"]')).toContainText(optimizedText!);
  });
  
  test('Agent 模式优化并执行任务', async ({ page }) => {
    // 1. 切换到 Agent 模式
    await page.click('[data-testid="mode-switcher"]');
    await page.click('[data-testid="agent-mode"]');
    
    // 2. 输入任务描述
    await page.fill('[data-testid="chat-input"]', '修复这个 bug');
    
    // 3. 点击优化
    await page.click('[data-testid="optimize-button"]');
    
    // 4. 等待优化完成
    await page.waitForSelector('[data-testid="undo-button"]');
    
    // 5. 验证优化结果包含 Agent 模式特征
    const optimizedText = await page.textContent('[data-testid="chat-input"]');
    expect(optimizedText).toContain('步骤');
    expect(optimizedText).toContain('验证');
    
    // 6. 发送任务
    await page.click('[data-testid="send-button"]');
    
    // 7. 验证任务开始执行
    await expect(page.locator('[data-testid="task-status"]')).toContainText('执行中');
  });
});
```

---

## 7. 性能指标

| 指标 | 目标值 | 测量方法 | 监控工具 |
|------|--------|---------|---------|
| 优化延迟 | <3 秒 | 从点击按钮到显示结果 | Sentry Performance |
| 成功率 | >95% | 成功返回优化结果的比例 | 日志统计 |
| 撤回使用率 | 20-30% | 用户点击撤回的比例 | 埋点统计 |
| 扩展比例合理性 | 极短>3x, 中等 1.5-3x, 长<2x | 自动化测试验证 | CI/CD |
| 用户满意度 | >4.5/5 | 应用内评分 | 用户反馈 |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 模型幻觉（添加无关内容） | 中 | 高 | 系统指令强调"意图保留"，撤回按钮兜底 |
| 过度扩展（>5x） | 低 | 中 | 长度比例检测 + 提示用户检查 |
| API 调用失败 | 低 | 高 | 错误提示 + 重试机制（P1 考虑） |
| 轻量模型能力不足 | 中 | 中 | 可降级到本地规则优化（P2 考虑） |
| 用户误操作（意外优化） | 中 | 低 | 撤回按钮 + 确认提示（可选） |

---

## 9. 实施计划

### Phase 1: 核心功能（1-2 周）
- [ ] 创建系统指令模板文件
- [ ] 实现 IPC handler
- [ ] 实现 `getLiteModel()` 方法
- [ ] 添加优化按钮 UI
- [ ] 实现撤回机制
- [ ] 编写单元测试

### Phase 2: 集成测试（1 周）
- [ ] 编写集成测试
- [ ] 编写 E2E 测试
- [ ] 性能测试和优化
- [ ] 错误处理和边界情况

### Phase 3: 用户体验优化（1 周）
- [ ] 添加加载动画
- [ ] 优化错误提示
- [ ] 添加使用引导
- [ ] 收集用户反馈

### Phase 4: 监控和迭代（持续）
- [ ] 部署性能监控
- [ ] 收集使用数据
- [ ] 根据反馈迭代优化
- [ ] 考虑 P1/P2 增强功能

---

## 10. 后续增强（P1/P2）

### P1 增强
- **对比浮层**: 显示优化前后的 diff 对比
- **批量优化**: 支持优化历史记录中的多条消息
- **自定义模板**: 用户可自定义优化策略
- **重试机制**: API 失败时自动重试

### P2 增强
- **本地规则优化**: 降级到本地规则（无 API 调用）
- **多模型选择**: 用户可选择不同模型进行优化
- **优化历史**: 保存优化历史记录
- **智能推荐**: 根据输入内容自动推荐优化建议

---

## 11. 验收标准

### 功能验收
- [ ] 点击优化按钮后，输入框内容被替换为优化后的版本
- [ ] 优化过程中显示加载动画
- [ ] 优化失败时显示错误提示
- [ ] 撤回按钮在优化后 5 秒内可见
- [ ] 点击撤回按钮恢复原始内容
- [ ] Chat 模式和 Agent 模式使用不同的优化策略
- [ ] 极短输入（<20字符）扩展倍数 >3x
- [ ] 中等输入（20-100字符）扩展倍数 1.5-3x
- [ ] 详细输入（>100字符）扩展倍数 <2x

### 性能验收
- [ ] 优化延迟 <3 秒（95% 的请求）
- [ ] 成功率 >95%
- [ ] 无内存泄漏
- [ ] UI 响应流畅（无卡顿）

### 测试验收
- [ ] 单元测试覆盖率 >80%
- [ ] 集成测试全部通过
- [ ] E2E 测试全部通过
- [ ] 无 Critical/High 级别 bug

---

## 12. 参考资料

### 竞品分析
- QoderWork 提示词优化功能
- WorkBuddy 智能提示词增强
- CustomGPT.ai 提示词优化策略
- FixMyPrompt 短输入扩展案例

### GitHub 项目
- **prompt-optimizer** ⭐32.2k - 双模式 + 智能迭代
- **PromptWizard** ⭐3.9k - 微软自进化机制
- **PromptEnhancer** ⭐3.7k - 腾讯 CoT 提示词重写
- **auto-prompt** ⭐778 - 多维度分析优化
- **prompt-forge** ⭐775 - 工程化方法
- **PromptAgent** ⭐354 - MCTS 战略规划

### 技术文档
- [TipTap Editor API](https://tiptap.dev/api/introduction)
- [Radix UI Toast](https://www.radix-ui.com/primitives/docs/components/toast)
- [Jotai State Management](https://jotai.org/)

---

**文档版本**: v1.0  
**创建日期**: 2026-07-15  
**最后更新**: 2026-07-15  
**负责人**: Craft Agent  
**审核状态**: 待用户确认
