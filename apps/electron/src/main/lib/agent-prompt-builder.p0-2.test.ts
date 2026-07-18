/**
 * P0-2 意图确认规则 — 系统提示词验证测试
 *
 * 验证 buildSystemPrompt 输出包含完整的意图确认规则，
 * 确保 Agent 在首轮交互中能正确识别模糊意图并提供结构化选项。
 */

import { describe, test, expect } from 'bun:test'
import { PROMA_DEFAULT_PERMISSION_MODE, PROMA_PERMISSION_MODES, type PromaPermissionMode } from '@proma/shared'
import { buildSystemPrompt } from './agent-prompt-builder'

/** 构建测试用的系统提示词 */
function getTestSystemPrompt(mode: PromaPermissionMode = PROMA_DEFAULT_PERMISSION_MODE) {
  return buildSystemPrompt({
    sessionId: 'test-session-p0-2',
    permissionMode: mode,
    workspaceName: 'TestWorkspace',
    workspaceSlug: 'test-workspace',
  })
}

describe('P0-2 意图确认规则 — 系统提示词内容验证', () => {

  // ===== 1. 核心段落存在性 =====

  test('系统提示词包含"意图确认与结构化选项"段落', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('## 意图确认与结构化选项')
    expect(prompt).toContain('首轮交互时，主动识别模糊意图')
    expect(prompt).toContain('AskUserQuestion 工具提供结构化选项')
  })

  test('系统提示词不再包含旧的"不确定性处理"段落', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).not.toContain('## 不确定性处理')
  })

  // ===== 2. 关键决策分类 =====

  test('包含"何时需要确认"的四类场景', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('何时需要确认')
    expect(prompt).toContain('关键决策')
    expect(prompt).toContain('任务方向不明确')
    expect(prompt).toContain('技术选型存在多个方案')
    expect(prompt).toContain('范围和优先级不清晰')
    expect(prompt).toContain('存在破坏性操作风险')
  })

  test('包含"何时不需要确认"的四类场景', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('何时不需要确认')
    expect(prompt).toContain('低风险细节')
    expect(prompt).toContain('单文件操作')
    expect(prompt).toContain('常规任务')
    expect(prompt).toContain('信息查询')
    expect(prompt).toContain('已有上下文')
  })

  // ===== 3. 具体示例 =====

  test('包含模糊输入示例', () => {
    const prompt = getTestSystemPrompt()
    // 模糊输入示例
    expect(prompt).toContain('帮我改一下这个项目')
    expect(prompt).toContain('优化一下')
    expect(prompt).toContain('加个数据库')
    expect(prompt).toContain('做个前端')
    expect(prompt).toContain('清理一下代码')
    expect(prompt).toContain('更新依赖')
  })

  test('包含清晰输入示例', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('把 utils.ts 中的 formatDate 改成 dayjs')
    expect(prompt).toContain('写个单元测试')
    expect(prompt).toContain('解释一下这段代码')
  })

  // ===== 4. AskUserQuestion 使用规范 =====

  test('包含问题设计原则', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('每个问题聚焦一个决策维度')
    expect(prompt).toContain('选项数量 2-5 个')
    expect(prompt).toContain('每个选项必须有 description')
    expect(prompt).toContain('推荐选项放第一个')
    expect(prompt).toContain('善用 preview 展示细节')
  })

  test('包含多问题拆分指南', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('多问题拆分')
    expect(prompt).toContain('任务方向')
    expect(prompt).toContain('技术方案')
    expect(prompt).toContain('范围和约束')
  })

  // ===== 5. 决策流程 =====

  test('包含决策流程', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('决策流程')
    expect(prompt).toContain('意图是否清晰')
    expect(prompt).toContain('清晰 → 直接执行')
    expect(prompt).toContain('部分清晰 → 先执行确定部分')
    expect(prompt).toContain('完全模糊 → AskUserQuestion 确认意图后再执行')
  })

  // ===== 6. 避免过度确认 =====

  test('包含避免过度确认规则', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('避免过度确认')
    expect(prompt).toContain('最多问 **3 个问题**')
    expect(prompt).toContain('你来决定')
    expect(prompt).toContain('随便')
    expect(prompt).toContain('都行')
  })

  test('保留了原有的合理建议', () => {
    const prompt = getTestSystemPrompt()
    // 原"不确定性处理"段落中有价值的建议应被保留
    expect(prompt).toContain('站在用户角度多想一步')
    expect(prompt).toContain('不要盲目附和')
  })

  // ===== 7. 不同权限模式下的兼容性 =====

  test.each([...PROMA_PERMISSION_MODES])('%s 模式下包含意图确认规则', (mode) => {
    const prompt = getTestSystemPrompt(mode)
    expect(prompt).toContain('意图确认与结构化选项')
  })

  // ===== 8. 与其他段落不冲突 =====

  test('SubAgent 策略段落仍然完整', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('## SubAgent 委派策略')
    expect(prompt).toContain('善用 SubAgent 拓宽探索边界')
  })

  test('交互规范段落仍然完整', () => {
    const prompt = getTestSystemPrompt()
    expect(prompt).toContain('## 交互规范')
  })

  test('计划模式段落仍然完整', () => {
    const prompt = getTestSystemPrompt('plan')
    expect(prompt).toContain('## 计划模式')
    expect(prompt).toContain('.context/plan/')
  })
})
