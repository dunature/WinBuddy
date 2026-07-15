import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import type { PromptOptimizationRequest } from '@proma/shared'
import { buildPromptReferenceContext } from './prompt-context-builder'
import type { ProtectedReference } from './prompt-reference-validator'

function baseRequest(workspacePath: string): PromptOptimizationRequest {
  return {
    mode: 'agent',
    draftText: '处理 @spec.md',
    workspacePath,
    currentModel: { channelId: 'channel', modelId: 'model' },
  }
}

describe('prompt reference context builder', () => {
  test('reads referenced workspace text files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-prompt-context-'))
    writeFileSync(join(dir, 'spec.md'), '这是需要保留的文件上下文。', 'utf-8')
    const references: ProtectedReference[] = [
      { placeholder: '[[PROMA_REF_001]]', rawText: '@spec.md', char: '@', id: 'spec.md', label: 'spec.md' },
    ]

    const context = buildPromptReferenceContext(baseRequest(dir), references)

    expect(context).toContain('文件引用 @spec.md')
    expect(context).toContain('这是需要保留的文件上下文。')
  })

  test('keeps missing references as non-blocking context', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-prompt-context-'))
    const references: ProtectedReference[] = [
      { placeholder: '[[PROMA_REF_001]]', rawText: '@missing.md', char: '@', id: 'missing.md', label: 'missing.md' },
    ]

    const context = buildPromptReferenceContext(baseRequest(dir), references)

    expect(context).toContain('文件引用 @missing.md')
    expect(context).toContain('无法读取文件内容')
  })
})
