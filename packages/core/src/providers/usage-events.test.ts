import { describe, expect, test } from 'bun:test'
import { AnthropicAdapter } from './anthropic-adapter.ts'
import { OpenAIAdapter } from './openai-adapter.ts'
import { GoogleAdapter } from './google-adapter.ts'

describe('provider usage events', () => {
  test('parses Anthropic message usage events', () => {
    const adapter = new AnthropicAdapter()
    const events = adapter.parseSSELine(JSON.stringify({
      type: 'message_delta',
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
      },
      delta: { stop_reason: 'end_turn' },
    }))

    expect(events).toContainEqual({
      type: 'usage',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 2,
      },
    })
  })

  test('parses OpenAI include_usage chunks', () => {
    const adapter = new OpenAIAdapter()
    const events = adapter.parseSSELine(JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 4 },
      },
    }))

    expect(events).toEqual([{
      type: 'usage',
      usage: {
        inputTokens: 8,
        outputTokens: 5,
        cacheReadInputTokens: 4,
        cacheCreationInputTokens: 0,
      },
    }])
  })

  test('parses Google usageMetadata chunks without content parts', () => {
    const adapter = new GoogleAdapter()
    const events = adapter.parseSSELine(JSON.stringify({
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 6,
        cachedContentTokenCount: 7,
      },
    }))

    expect(events).toEqual([{
      type: 'usage',
      usage: {
        inputTokens: 13,
        outputTokens: 6,
        cacheReadInputTokens: 7,
        cacheCreationInputTokens: 0,
      },
    }])
  })
})
