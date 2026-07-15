import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type PromptComplexity = 'simple' | 'medium' | 'complex'

export interface PromptFramework {
  id: string
  name: string
  complexity: PromptComplexity
  domains: string[]
  capabilities: string[]
  sourcePath: string
}

export interface FrameworkCard {
  id: string
  name: string
  text: string
}

const EXPECTED_FRAMEWORK_COUNT = 57

const DOMAIN_RULES: Array<{ words: string[]; domains: string[]; capabilities: string[] }> = [
  { words: ['bug', '报错', '修复', '代码', '开发', '实现', '测试', '性能'], domains: ['engineering'], capabilities: ['execution', 'validation'] },
  { words: ['对比', '比较', '选型', '利弊', '选择'], domains: ['decision'], capabilities: ['comparison', 'decision'] },
  { words: ['研究', '分析', '诊断', '数据', '报告'], domains: ['analysis'], capabilities: ['reasoning', 'evidence'] },
  { words: ['营销', '销售', '文案', '推广', '海报', '落地页'], domains: ['marketing'], capabilities: ['writing', 'conversion'] },
  { words: ['教学', '培训', '解释', '课程', '教程'], domains: ['education'], capabilities: ['teaching', 'structure'] },
  { words: ['计划', '方案', '规划', '发布', '流程'], domains: ['planning'], capabilities: ['planning', 'execution'] },
]

function normalizeFrameworkName(value: string): string {
  return value
    .replace(/^\d+_/, '')
    .replace(/_Framework$/, '')
    .replace(/_/g, ' ')
    .trim()
}

function inferComplexity(text: string): PromptComplexity {
  const parts = text.split(/[\n。！？；;，,]/).filter((part) => part.trim())
  if (text.length > 180 || parts.length >= 8) return 'complex'
  if (text.length > 50 || parts.length >= 3) return 'medium'
  return 'simple'
}

function inferTags(name: string, content: string): Pick<PromptFramework, 'domains' | 'capabilities'> {
  const haystack = `${name}\n${content}`.toLowerCase()
  const domains = new Set<string>()
  const capabilities = new Set<string>()
  for (const rule of DOMAIN_RULES) {
    if (rule.words.some((word) => haystack.includes(word.toLowerCase()))) {
      rule.domains.forEach((item) => domains.add(item))
      rule.capabilities.forEach((item) => capabilities.add(item))
    }
  }
  return {
    domains: domains.size > 0 ? [...domains] : ['general'],
    capabilities: capabilities.size > 0 ? [...capabilities] : ['structure'],
  }
}

function compactMarkdown(text: string, maxChars: number): string {
  const sections: string[] = []
  for (const heading of ['应用场景', '概述', '框架构成', '详细说明']) {
    const match = text.match(new RegExp(`^## ${heading}\\s*$\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))
    if (match?.[1]) sections.push(`## ${heading}\n${match[1].trim()}`)
  }
  const compact = (sections.length > 0 ? sections.join('\n\n') : text)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return compact.slice(0, maxChars).trim()
}

export function resolvePromptOptimizerResourceDir(): string {
  const candidates = [
    resolve(process.cwd(), 'resources/prompt-optimizer'),
    resolve(process.cwd(), 'apps/electron/resources/prompt-optimizer'),
    resolve(__dirname, '../resources/prompt-optimizer'),
    resolve(__dirname, 'resources/prompt-optimizer'),
  ]
  const found = candidates.find((candidate) => existsSync(join(candidate, 'SKILL.md')))
  if (!found) {
    throw new Error('找不到提示词优化框架资源，请确认 prompt-optimizer 已复制到应用资源目录')
  }
  return found
}

export function loadPromptFrameworks(resourceDir = resolvePromptOptimizerResourceDir()): PromptFramework[] {
  const frameworksDir = join(resourceDir, 'references/frameworks')
  if (!existsSync(frameworksDir)) {
    throw new Error(`找不到提示词优化框架目录：${frameworksDir}`)
  }

  const files = readdirSync(frameworksDir)
    .filter((file) => file.endsWith('_Framework.md'))
    .sort()

  if (files.length !== EXPECTED_FRAMEWORK_COUNT) {
    throw new Error(`提示词优化框架库不完整：预期 ${EXPECTED_FRAMEWORK_COUNT} 个，实际 ${files.length} 个`)
  }

  return files.map((file) => {
    const sourcePath = join(frameworksDir, file)
    const content = readFileSync(sourcePath, 'utf-8')
    const name = normalizeFrameworkName(file.replace(/\.md$/, ''))
    const tags = inferTags(name, content)
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name,
      complexity: inferComplexity(content),
      ...tags,
      sourcePath,
    }
  })
}

export function buildFrameworkCards(frameworks: PromptFramework[], budgetChars = 6000): FrameworkCard[] {
  if (frameworks.length === 0) return []
  const separatorBudget = Math.max(0, frameworks.length - 1) * 8
  let remaining = Math.max(300, budgetChars - separatorBudget)
  return frameworks.map((framework, index) => {
    const slots = frameworks.length - index
    const allowance = Math.max(300, Math.floor(remaining / slots))
    const raw = readFileSync(framework.sourcePath, 'utf-8')
    const body = compactMarkdown(raw, allowance)
    const text = `# ${framework.name}\n${body}`.slice(0, allowance).trim()
    remaining -= text.length
    return { id: framework.id, name: framework.name, text }
  })
}
