import { getAdapter, streamSSE } from '@proma/core'
import type { Channel } from '@proma/shared'
import { decryptApiKey, listChannels } from './channel-manager'
import { getVoiceDictationSettings } from './voice-dictation-settings-service'
import { getEnabledVoiceDictionaryEntries } from './voice-dictionary-service'
import { getVoiceStylePack } from './voice-style-pack-service'
import { RAW_STYLE_PACK_ID, DEFAULT_STYLE_PACK_ID } from './voice-style-pack-builtins'
import { buildVoicePolishSystemPrompt, buildVoicePolishUserPrompt } from './voice-polish-prompt'
import { cleanVoicePolishOutput } from './voice-polish-output'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getFetchFn } from './proxy-fetch'
import type { VoicePolishInput, VoicePolishResult } from '../../types'

const VOICE_POLISH_TIMEOUT_MS = 60_000

const activeControllers = new Map<string, AbortController>()

function rawResult(input: VoicePolishInput, stylePackId: string, message?: string): VoicePolishResult {
  return {
    text: input.text,
    rawText: input.text,
    stylePackId,
    usedRaw: true,
    message,
  }
}

function resolveChannel(channels: Channel[], channelId?: string): Channel | null {
  if (!channelId) return null
  return channels.find((channel) => channel.id === channelId && channel.enabled) ?? null
}

function isEnabledModel(channel: Channel, modelId?: string): boolean {
  if (!modelId) return false
  return channel.models.some((model) => model.id === modelId && model.enabled)
}

export function cancelVoicePolish(requestId: string): void {
  const controller = activeControllers.get(requestId)
  if (!controller) return
  controller.abort()
  activeControllers.delete(requestId)
}

export async function polishVoiceDictation(input: VoicePolishInput): Promise<VoicePolishResult> {
  const text = input.text.trim()
  if (!text) return rawResult(input, DEFAULT_STYLE_PACK_ID, '没有可整理的语音文本')

  const settings = getVoiceDictationSettings()
  const stylePackId = settings.polish.stylePackId || DEFAULT_STYLE_PACK_ID
  const stylePack = getVoiceStylePack(stylePackId) ?? getVoiceStylePack(DEFAULT_STYLE_PACK_ID)
  if (!settings.polish.enabled || !stylePack || stylePack.id === RAW_STYLE_PACK_ID || stylePack.mode === 'raw') {
    return rawResult(input, stylePack?.id ?? stylePackId)
  }

  const channels = listChannels()
  const channel = resolveChannel(channels, settings.polish.channelId)
  if (!channel || !isEnabledModel(channel, settings.polish.modelId)) {
    return rawResult(input, stylePack.id, '未配置可用的语音整理模型，已使用原始转写')
  }

  let apiKey: string
  try {
    apiKey = decryptApiKey(channel.id)
  } catch {
    return rawResult(input, stylePack.id, '语音整理模型凭证不可用，已使用原始转写')
  }

  const controller = new AbortController()
  activeControllers.set(input.requestId, controller)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, VOICE_POLISH_TIMEOUT_MS)

  try {
    const adapter = getAdapter(channel.provider)
    const dictionaryEntries = getEnabledVoiceDictionaryEntries(settings.customHotwords)
    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const request = adapter.buildStreamRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId: settings.polish.modelId!,
      history: [],
      userMessage: buildVoicePolishUserPrompt(text),
      systemMessage: buildVoicePolishSystemPrompt(stylePack, dictionaryEntries),
      readImageAttachments: () => [],
      thinkingEnabled: false,
    })

    const result = await streamSSE({
      request,
      adapter,
      signal: controller.signal,
      fetchFn,
      timeoutMs: VOICE_POLISH_TIMEOUT_MS,
      onEvent: () => {},
    })
    const cleaned = cleanVoicePolishOutput(result.content)
    if (!cleaned) {
      return rawResult(input, stylePack.id, '语音整理结果为空，已使用原始转写')
    }

    return {
      text: cleaned,
      rawText: text,
      stylePackId: stylePack.id,
      usedRaw: false,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) {
        return rawResult(input, stylePack.id, '语音整理超时，已使用原始转写')
      }
      throw new Error('语音整理已取消')
    }
    const message = error instanceof Error ? error.message : '未知错误'
    console.warn('[语音输入] LLM 整理失败，回退原文:', message)
    return rawResult(input, stylePack.id, '语音整理失败，已使用原始转写')
  } finally {
    clearTimeout(timeout)
    activeControllers.delete(input.requestId)
  }
}
