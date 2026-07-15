import type { PromptOptimizationMode } from '@proma/shared'
import type { PromptFramework, PromptComplexity } from './framework-registry'

const ROUTE_RULES: Array<{ words: string[]; frameworks: string[] }> = [
  { words: ['对比', '比较', '选型', '利弊', '选择'], frameworks: ['FOCUS', 'Pros and Cons', 'RICE'] },
  { words: ['教学', '解释', '科普', '学习', '教程', '培训'], frameworks: ['ELI5', "Bloom's Taxonomy", 'PEE'] },
  { words: ['营销', '销售', '推广', '文案', '转化', '落地页'], frameworks: ['BAB', 'SPEAR', 'PROMPT'] },
  { words: ['图片', '图像', '海报', 'midjourney', 'dall-e', '视觉'], frameworks: ['Atomic Prompting'] },
  { words: ['代码', '开发', 'bug', '修复', '报错', '实现', '测试', '性能'], frameworks: ['APE', 'CIDI', 'RASCEF'] },
  { words: ['计划', '方案', '规划', '执行', '项目', '发布'], frameworks: ['APE', 'GOPA', 'RISEN'] },
  { words: ['分析', '研究', '推理', '诊断', '数据'], frameworks: ['APE', 'GRADE', 'RASCEF'] },
]

export function detectPromptComplexity(prompt: string): PromptComplexity {
  const parts = prompt.split(/[\n。！？；;，,]/).filter((part) => part.trim())
  if (prompt.length > 180 || parts.length >= 8) return 'complex'
  if (prompt.length > 50 || parts.length >= 3) return 'medium'
  return 'simple'
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function findFramework(frameworks: PromptFramework[], name: string): PromptFramework | undefined {
  const target = normalize(name.replace(/framework/ig, ''))
  return frameworks.find((framework) => normalize(framework.name) === target || normalize(framework.id) === target)
}

export function routePromptFrameworks(input: {
  prompt: string
  mode: PromptOptimizationMode
  frameworks: PromptFramework[]
}): PromptFramework[] {
  const complexity = detectPromptComplexity(input.prompt)
  const maxCount = complexity === 'simple' ? 1 : complexity === 'medium' ? 2 : 3
  const lowerPrompt = input.prompt.toLowerCase()
  const matched = ROUTE_RULES.find((rule) => rule.words.some((word) => lowerPrompt.includes(word.toLowerCase())))
  const preferred = matched?.frameworks ?? (input.mode === 'agent' ? ['APE', 'RASCEF', 'RISEN'] : ['APE', 'RTF', 'RASCEF'])

  const selected: PromptFramework[] = []
  for (const name of preferred) {
    const framework = findFramework(input.frameworks, name)
    if (framework && !selected.some((item) => item.id === framework.id)) selected.push(framework)
    if (selected.length >= maxCount) break
  }

  if (selected.length === 0 && input.frameworks[0]) selected.push(input.frameworks[0])
  return selected.slice(0, maxCount)
}
