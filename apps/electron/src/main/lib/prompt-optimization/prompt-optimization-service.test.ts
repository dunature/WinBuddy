import { describe, expect, test } from 'bun:test'
import { formatPromptOptimizationRecentContent } from './prompt-message-format'

describe('prompt optimization service', () => {
  test('formats missing recent message content without throwing', () => {
    expect(formatPromptOptimizationRecentContent(undefined)).toBe('')
    expect(formatPromptOptimizationRecentContent(null)).toBe('')
  })

  test('formats non-string recent message content safely', () => {
    expect(formatPromptOptimizationRecentContent({ text: 'hello' })).toBe('{"text":"hello"}')
    expect(formatPromptOptimizationRecentContent({ value: BigInt(1) })).toBe('')
  })
})
