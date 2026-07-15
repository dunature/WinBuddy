import { describe, expect, test } from 'bun:test'
import { protectPromptReferences, restorePromptReferences, validateReferencePlaceholders } from './prompt-reference-validator'

describe('prompt reference validator', () => {
  test('protects and restores text references', () => {
    const protectedResult = protectPromptReferences({
      text: '修复 @apps/electron/src/main/ipc.ts 并使用 /diagnose #GitHubMCP &提示词优化讨论',
    })

    expect(protectedResult.references).toHaveLength(4)
    expect(protectedResult.protectedText).toContain('[[PROMA_REF_001]]')

    const optimized = `请完成 [[PROMA_REF_001]]，并保留 [[PROMA_REF_002]]、[[PROMA_REF_003]]、[[PROMA_REF_004]]。`
    const validation = validateReferencePlaceholders(optimized, protectedResult.references)
    expect(validation.valid).toBe(true)

    const restored = restorePromptReferences(optimized, protectedResult.references)
    expect(restored.text).toContain('@apps/electron/src/main/ipc.ts')
    expect(restored.text).toContain('/diagnose')
    expect(restored.text).toContain('#GitHubMCP')
    expect(restored.text).toContain('&提示词优化讨论')
  })

  test('rejects deleted or duplicated references', () => {
    const protectedResult = protectPromptReferences({ text: '处理 @a 和 @b' })
    const validation = validateReferencePlaceholders('只保留 [[PROMA_REF_001]] [[PROMA_REF_001]]', protectedResult.references)

    expect(validation.valid).toBe(false)
    expect(validation.failures.length).toBeGreaterThan(0)
  })

  test('restores mention html when provided', () => {
    const html = '<p>处理 <span data-type="mention" data-id="a.ts" data-label="a.ts" data-mention-suggestion-char="@" class="mention-chip">@a.ts</span></p>'
    const protectedResult = protectPromptReferences({ text: '处理 @a.ts', html })
    const restored = restorePromptReferences('请处理 [[PROMA_REF_001]]', protectedResult.references)

    expect(restored.html).toContain('data-type="mention"')
    expect(restored.html).toContain('@a.ts')
  })
})
