import { describe, expect, test } from 'bun:test'
import { cleanVoicePolishOutput } from './voice-polish-output'

describe('voice polish output cleaner', () => {
  test('removes think blocks', () => {
    expect(cleanVoicePolishOutput('<think>分析过程</think>\n整理后的文本')).toBe('整理后的文本')
  })

  test('unwraps whole output code fences', () => {
    expect(cleanVoicePolishOutput('```markdown\n整理后的文本\n```')).toBe('整理后的文本')
  })

  test('removes common prefaces', () => {
    expect(cleanVoicePolishOutput('整理如下：\n整理后的文本')).toBe('整理后的文本')
    expect(cleanVoicePolishOutput('以下是整理后的文本：\n整理后的文本')).toBe('整理后的文本')
  })
})
