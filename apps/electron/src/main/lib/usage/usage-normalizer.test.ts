import { describe, expect, test } from 'bun:test'
import type { SDKMessage, SDKResultMessage } from '@proma/shared'
import { isSDKResultMessage, normalizeAgentUsage, normalizeChatUsage } from './usage-normalizer'

describe('usage normalizer', () => {
  test('Given catch-all 消息伪装成 result When 校验用量结果 Then 缺少必要结构的消息被拒绝', () => {
    const malformed = { type: 'result' } as SDKMessage

    expect(isSDKResultMessage(malformed)).toBe(false)
  })

  test('Given SDK result 包含 subtype 和 token usage When 校验用量结果 Then 接受有效消息', () => {
    const result: SDKMessage = {
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    }

    expect(isSDKResultMessage(result)).toBe(true)
  })

  test('normalizes Agent result usage without flattening missing cost to zero', () => {
    const result: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
      },
      modelUsage: {
        'claude-sonnet': {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 2,
          contextWindow: 200000,
        },
      },
    }

    const record = normalizeAgentUsage({
      result,
      timestamp: 1000,
      durationMs: 250,
      session: {
        sessionId: 's1',
        sessionTitleSnapshot: '会话',
        sessionType: 'agent',
        channelId: 'c1',
        provider: 'anthropic',
        modelId: 'claude-sonnet',
      },
    })

    expect(record?.totalTokens).toBe(20)
    expect(record?.costUsd).toBeUndefined()
    expect(record?.models[0]?.contextWindow).toBe(200000)
  })

  test('normalizes Chat stream usage and keeps real zero cost distinct', () => {
    const record = normalizeChatUsage({
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        cacheReadInputTokens: 4,
        cacheCreationInputTokens: 1,
        costUsd: 0,
      },
      timestamp: 2000,
      durationMs: 100,
      requestIndex: 2,
      status: 'success',
      session: {
        sessionId: 'chat1',
        sessionType: 'chat',
        channelId: 'c1',
        provider: 'openai',
        modelId: 'gpt',
      },
    })

    expect(record?.totalTokens).toBe(10)
    expect(record?.costUsd).toBe(0)
    expect(record?.requestIndex).toBe(2)
  })
})
