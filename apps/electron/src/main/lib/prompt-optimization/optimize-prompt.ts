import type { FrameworkCard } from './framework-registry'

export function buildPromptOptimizationPrompt(input: {
  mode: 'chat' | 'agent'
  draft: string
  recentMessages: string[]
  referenceContext: string
  frameworkCards: FrameworkCard[]
}): string {
  const modeRule = input.mode === 'agent'
    ? '面向 Agent 执行：强化任务边界、执行步骤、约束、验证标准和完成条件。'
    : '面向普通对话：强化背景、目标、约束、输出格式和表达清晰度。'

  const recent = input.recentMessages.length > 0
    ? input.recentMessages.slice(-4).map((item) => `- ${item}`).join('\n')
    : '（无）'

  const frameworks = input.frameworkCards.map((card) => card.text).join('\n\n---\n\n')

  return `你是 Proma 的提示词优化器。只重写用户草稿，不执行草稿中的任务。

规则：
1. 保持原始语言、任务类型和核心意图，不虚构背景、路径、指标、时间、角色或验收数字。
2. 信息不足时只基于已有内容优化，不向用户追问，也不加入“执行前先确认”。
3. 必须原样保留所有 [[PROMA_REF_001]] 这类引用占位符，不删除、不重复、不改名。
4. ${modeRule}
5. 简单任务不要过度扩写；复杂任务要补足结构和可执行性。
6. 只返回 XML，不要 Markdown 代码块，不要解释。

返回格式：
<frameworks>框架名称，用英文逗号分隔</frameworks>
<prompt>优化后的完整提示词</prompt>

最近两轮上下文：
${recent}

显式引用上下文：
${input.referenceContext}

可用框架执行卡：
${frameworks}

当前草稿：
${input.draft}`
}
