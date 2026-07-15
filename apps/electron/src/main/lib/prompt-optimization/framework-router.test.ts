import { describe, expect, test } from 'bun:test'
import { buildFrameworkCards, loadPromptFrameworks, resolvePromptOptimizerResourceDir } from './framework-registry'
import { detectPromptComplexity, routePromptFrameworks } from './framework-router'

describe('prompt framework router', () => {
  test('loads bundled 57 framework files', () => {
    const frameworks = loadPromptFrameworks(resolvePromptOptimizerResourceDir())
    expect(frameworks).toHaveLength(57)
  })

  test('selects at most 1/2/3 frameworks by complexity', () => {
    const frameworks = loadPromptFrameworks(resolvePromptOptimizerResourceDir())
    const simple = routePromptFrameworks({ mode: 'chat', prompt: '写好一点', frameworks })
    const medium = routePromptFrameworks({ mode: 'chat', prompt: '比较这两个方案，说明利弊，最后给建议。', frameworks })
    const complex = routePromptFrameworks({
      mode: 'agent',
      prompt: '登录偶发失败，刷新又好了，没有复现步骤，也不知道前端还是接口。请先诊断，再给最小修复和验证方案，不要大重构。',
      frameworks,
    })

    expect(detectPromptComplexity('写好一点')).toBe('simple')
    expect(simple.length).toBeLessThanOrEqual(1)
    expect(medium.length).toBeLessThanOrEqual(2)
    expect(complex.length).toBeLessThanOrEqual(3)
  })

  test('keeps framework cards under budget', () => {
    const frameworks = routePromptFrameworks({
      mode: 'agent',
      prompt: '修复复杂 bug，需要诊断、实现、测试和验收。',
      frameworks: loadPromptFrameworks(resolvePromptOptimizerResourceDir()),
    })
    const cards = buildFrameworkCards(frameworks, 1500)
    const total = cards.map((card) => card.text).join('\n\n---\n\n').length
    expect(total).toBeLessThanOrEqual(1500)
  })
})
