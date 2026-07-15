import type { ProviderType, PromptOptimizationCancelInput, PromptOptimizationRequest, OptimizedPromptResult, PromptOptimizationUsage } from '@proma/shared'
import { getAdapter, type ProviderRequest, resolveOpenAIChatCompletionsUrl, resolveAnthropicMessagesUrl, normalizeBaseUrl } from '@proma/core'
import { listChannels, decryptApiKey } from '../channel-manager'
import { getSettings } from '../settings-service'
import { getFetchFn } from '../proxy-fetch'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { getConversationMessages } from '../conversation-manager'
import { getAgentSessionMessages } from '../agent-session-manager'
import { buildFrameworkCards, loadPromptFrameworks } from './framework-registry'
import { routePromptFrameworks } from './framework-router'
import { protectPromptReferences, restorePromptReferences, validateReferencePlaceholders } from './prompt-reference-validator'
import { buildPromptOptimizationPrompt } from './optimize-prompt'
import { buildPromptReferenceContext } from './prompt-context-builder'
import { formatPromptOptimizationRecentContent } from './prompt-message-format'

const activeControllers = new Map<string, AbortController>()
const REQUEST_TIMEOUT_MS = 60_000

function requestKey(input: PromptOptimizationRequest | PromptOptimizationCancelInput): string {
  return input.mode === 'agent'
    ? `agent:${input.sessionId ?? 'global'}`
    : `chat:${input.conversationId ?? 'global'}`
}

function emptyValidation(): OptimizedPromptResult['referenceValidation'] {
  return { valid: true, expected: 0, actual: 0, failures: [] }
}

function errorResult(code: string, message: string, durationMs: number): OptimizedPromptResult {
  return {
    status: code === 'cancelled' ? 'cancelled' : code === 'timeout' ? 'timeout' : 'error',
    appliedFrameworks: [],
    durationMs,
    referenceValidation: emptyValidation(),
    errorCode: code,
    errorMessage: message,
  }
}

function getRecentMessages(input: PromptOptimizationRequest): string[] {
  if (input.recentMessages && input.recentMessages.length > 0) return input.recentMessages.slice(-4)
  if (input.mode === 'chat' && input.conversationId) {
    return getConversationMessages(input.conversationId)
      .slice(-4)
      .map((message) => `${message.role}: ${message.content}`)
  }
  if (input.mode === 'agent' && input.sessionId) {
    return getAgentSessionMessages(input.sessionId)
      .slice(-4)
      .map((message) => `${message.role}: ${formatPromptOptimizationRecentContent(message.content)}`)
  }
  return []
}

function resolveModel(input: PromptOptimizationRequest) {
  const channels = listChannels()
  const settings = getSettings()
  const preferred = settings.promptOptimizationModel
  const candidates = [preferred, input.currentModel].filter(Boolean)

  for (const candidate of candidates) {
    const channel = channels.find((item) => item.id === candidate?.channelId && item.enabled)
    const model = channel?.models.find((item) => item.id === candidate?.modelId && item.enabled)
    if (channel && model) return { channel, modelId: model.id }
  }
  throw new Error('没有可用的提示词优化模型，请先选择或启用当前会话模型')
}

function parseXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i'))
  return match?.[1]?.trim() ?? null
}

function parseOptimizedPrompt(text: string): { prompt: string; frameworks: string[] } {
  const prompt = parseXmlTag(text, 'prompt') ?? text.trim()
  const frameworkText = parseXmlTag(text, 'frameworks') ?? ''
  const frameworks = frameworkText
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return { prompt, frameworks }
}

function parseUsage(provider: ProviderType, body: unknown): PromptOptimizationUsage | undefined {
  const data = body as Record<string, unknown>
  if (provider === 'google') {
    const usage = data.usageMetadata as Record<string, number> | undefined
    if (!usage) return undefined
    return {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      cacheReadInputTokens: usage.cachedContentTokenCount,
    }
  }
  const openAIUsage = data.usage as Record<string, unknown> | undefined
  if (openAIUsage) {
    const details = openAIUsage.prompt_tokens_details as Record<string, number> | undefined
    return {
      inputTokens: Number(openAIUsage.prompt_tokens ?? openAIUsage.input_tokens ?? 0),
      outputTokens: Number(openAIUsage.completion_tokens ?? openAIUsage.output_tokens ?? 0),
      cacheReadInputTokens: (details?.cached_tokens ?? Number(openAIUsage.cache_read_input_tokens ?? 0)) || undefined,
      cacheCreationInputTokens: Number(openAIUsage.cache_creation_input_tokens ?? 0) || undefined,
    }
  }
  return undefined
}

function buildPromptRequest(input: {
  provider: ProviderType
  baseUrl: string
  apiKey: string
  modelId: string
  prompt: string
}): ProviderRequest {
  const adapter = getAdapter(input.provider)
  const request = adapter.buildTitleRequest(input)
  const body = JSON.parse(request.body) as Record<string, unknown>

  if (input.provider === 'google') {
    request.url = `${normalizeBaseUrl(input.baseUrl)}/v1beta/models/${input.modelId}:generateContent?key=${input.apiKey}`
    body.generationConfig = { maxOutputTokens: 2000, temperature: 0.2 }
  } else if (['openai', 'custom', 'zhipu', 'doubao', 'qwen'].includes(input.provider)) {
    request.url = resolveOpenAIChatCompletionsUrl(input.baseUrl, input.provider)
    body.max_tokens = 2000
    body.temperature = 0.2
  } else {
    request.url = resolveAnthropicMessagesUrl(input.baseUrl, input.provider)
    body.max_tokens = 2000
    body.temperature = 0.2
  }

  request.body = JSON.stringify(body)
  return request
}

async function fetchPromptResult(request: ProviderRequest, provider: ProviderType, signal: AbortSignal): Promise<{ text: string | null; usage?: PromptOptimizationUsage }> {
  const proxyUrl = await getEffectiveProxyUrl()
  const fetchFn = getFetchFn(proxyUrl)
  const response = await fetchFn(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`模型请求失败：HTTP ${response.status} ${detail.slice(0, 240)}`)
  }

  const body: unknown = await response.json()
  const text = getAdapter(provider).parseTitleResponse(body)
  return { text, usage: parseUsage(provider, body) }
}

export async function optimizePrompt(input: PromptOptimizationRequest): Promise<OptimizedPromptResult> {
  const startedAt = Date.now()
  const key = requestKey(input)
  const controller = new AbortController()
  activeControllers.set(key, controller)
  const timeout = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)

  try {
    if (!input.draftText.trim()) {
      return errorResult('empty_input', '提示词不能为空', Date.now() - startedAt)
    }

    const { channel, modelId } = resolveModel(input)
    const apiKey = decryptApiKey(channel.id)
    const { protectedText, references } = protectPromptReferences({ text: input.draftText, html: input.draftHtml })
    const referenceContext = buildPromptReferenceContext(input, references)
    const frameworks = loadPromptFrameworks()
    const selectedFrameworks = routePromptFrameworks({ prompt: protectedText, mode: input.mode, frameworks })
    const cards = buildFrameworkCards(selectedFrameworks)
    const prompt = buildPromptOptimizationPrompt({
      mode: input.mode,
      draft: protectedText,
      recentMessages: getRecentMessages(input),
      referenceContext,
      frameworkCards: cards,
    })

    const request = buildPromptRequest({
      provider: channel.provider,
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      prompt,
    })

    const response = await fetchPromptResult(request, channel.provider, controller.signal)
    if (!response.text?.trim()) {
      return errorResult('empty_response', '模型没有返回优化结果', Date.now() - startedAt)
    }

    const parsed = parseOptimizedPrompt(response.text)
    const validation = validateReferencePlaceholders(parsed.prompt, references)
    if (!validation.valid) {
      return {
        status: 'error',
        appliedFrameworks: parsed.frameworks.length > 0 ? parsed.frameworks : selectedFrameworks.map((item) => item.name),
        durationMs: Date.now() - startedAt,
        usage: response.usage,
        referenceValidation: validation,
        errorCode: 'reference_validation_failed',
        errorMessage: '优化结果破坏了引用，已保留原文',
      }
    }

    const restored = restorePromptReferences(parsed.prompt, references)
    return {
      status: 'success',
      optimizedText: restored.text,
      optimizedHtml: restored.html,
      appliedFrameworks: parsed.frameworks.length > 0 ? parsed.frameworks : selectedFrameworks.map((item) => item.name),
      usage: response.usage,
      durationMs: Date.now() - startedAt,
      referenceValidation: validation,
    }
  } catch (error) {
    const reason = controller.signal.reason
    if (reason === 'cancelled') return errorResult('cancelled', '已取消优化', Date.now() - startedAt)
    if (reason === 'timeout' || (error instanceof Error && error.name === 'AbortError')) {
      return errorResult('timeout', '提示词优化超时，已保留原文', Date.now() - startedAt)
    }
    return errorResult('request_failed', error instanceof Error ? error.message : '提示词优化失败', Date.now() - startedAt)
  } finally {
    clearTimeout(timeout)
    activeControllers.delete(key)
  }
}

export function cancelPromptOptimization(input: PromptOptimizationCancelInput): boolean {
  const controller = activeControllers.get(requestKey(input))
  if (!controller) return false
  controller.abort('cancelled')
  return true
}
