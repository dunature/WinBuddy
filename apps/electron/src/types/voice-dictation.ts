/**
 * 语音输入相关类型
 *
 * 主进程、preload 和语音输入浮窗共享。
 */

/** 语音输入供应商 */
export type VoiceDictationProvider = 'doubao'

/** 豆包 ASR 连接模式 */
export type VoiceDictationEndpointMode = 'async' | 'duplex'

/** 语音输入输出方式 */
export type VoiceDictationOutputMode = 'auto' | 'clipboard' | 'proma-input'

/** 语音整理风格语义 */
export type VoicePolishMode = 'raw' | 'light' | 'structured' | 'formal'

/** 语音输入浮窗位置 */
export interface VoiceDictationWindowPosition {
  x: number
  y: number
  /** 窗口相对于所在屏幕 workArea 的归一化水平偏移 (0~1) */
  relativeX?: number
  /** 窗口相对于所在屏幕 workArea 的归一化垂直偏移 (0~1) */
  relativeY?: number
}

/** LLM 智能整理设置 */
export interface VoicePolishSettings {
  /** 是否启用 ASR 后整理 */
  enabled: boolean
  /** 使用的渠道 ID；为空时无法调用 LLM，会回退原文 */
  channelId?: string
  /** 使用的模型 ID */
  modelId?: string
  /** 当前风格包 ID */
  stylePackId: string
  /** 是否提交前预览 */
  previewBeforeCommit: boolean
}

/** 语音输入设置（渲染进程读取到的是解密后的值） */
export interface VoiceDictationSettings {
  /** 是否启用语音输入 */
  enabled: boolean
  /** 语音识别供应商 */
  provider: VoiceDictationProvider
  /** 豆包 APP ID，对应 X-Api-App-Key 请求头 */
  appId: string
  /** 豆包 Access Token，对应 X-Api-Access-Key 请求头 */
  accessToken: string
  /** 豆包 Resource ID */
  resourceId: string
  /** 语言，空字符串表示自动 */
  language: string
  /** WebSocket 端点模式 */
  endpointMode: VoiceDictationEndpointMode
  /** 输出方式 */
  outputMode: VoiceDictationOutputMode
  /** 自定义热词，按行或逗号分隔；保留用于旧配置迁移 */
  customHotwords: string
  /** 智能整理设置 */
  polish: VoicePolishSettings
  /** 语音输入浮窗上次拖动后的位置 */
  windowPosition?: VoiceDictationWindowPosition
}

/** 语音输入设置更新 */
export type VoiceDictationSettingsUpdate = Partial<VoiceDictationSettings>

/** 落盘配置，保留旧字段用于从 MVP 早期版本平滑迁移 */
export interface VoiceDictationPersistedSettings extends Partial<VoiceDictationSettings> {
  /** @deprecated 使用 appId */
  appKey?: string
  /** @deprecated 使用 accessToken */
  accessKey?: string
}

/** 语音输入转写事件 */
export interface VoiceDictationTranscriptEvent {
  sessionId: string
  text: string
  isFinal: boolean
}

/** 语音输入状态事件 */
export interface VoiceDictationStateEvent {
  sessionId?: string
  status: 'idle' | 'connecting' | 'recording' | 'stopping' | 'polishing' | 'preview' | 'completed' | 'error'
  message?: string
}

/** 开始语音输入会话参数 */
export interface VoiceDictationStartInput {
  sessionId: string
}

/** 语音音频分片 */
export interface VoiceDictationAudioChunkInput {
  sessionId: string
  data: ArrayBuffer
}

/** 结束语音输入会话参数 */
export interface VoiceDictationStopInput {
  sessionId: string
}

/** 输出语音输入文本参数 */
export interface VoiceDictationCommitInput {
  text: string
}

/** 调整语音输入浮窗尺寸参数 */
export interface VoiceDictationResizeInput {
  height: number
}

/** 输出语音输入文本结果 */
export interface VoiceDictationCommitResult {
  mode: 'proma-input' | 'cursor' | 'clipboard'
  success: boolean
  message: string
}

/** 语音输入测试结果 */
export interface VoiceDictationTestResult {
  success: boolean
  message: string
}

/** 语音风格包示例 */
export interface VoiceStylePackExample {
  input: string
  output: string
}

/** 语音整理风格包 */
export interface VoiceStylePack {
  id: string
  name: string
  mode: VoicePolishMode
  description: string
  instruction: string
  examples: VoiceStylePackExample[]
  isBuiltin?: boolean
  createdAt: number
  updatedAt: number
}

/** 风格包创建或更新输入 */
export interface VoiceStylePackInput {
  id?: string
  name: string
  mode: VoicePolishMode
  description: string
  instruction: string
  examples?: VoiceStylePackExample[]
}

/** 语音词典条目 */
export interface VoiceDictionaryEntry {
  id: string
  term: string
  aliases: string[]
  category: string
  description: string
  enabled: boolean
  usageCount: number
  createdAt: number
  updatedAt: number
}

/** 语音词典创建或更新输入 */
export interface VoiceDictionaryEntryInput {
  id?: string
  term: string
  aliases?: string[]
  category?: string
  description?: string
  enabled?: boolean
}

/** 语音整理请求 */
export interface VoicePolishInput {
  requestId: string
  text: string
}

/** 取消语音整理请求 */
export interface VoicePolishCancelInput {
  requestId: string
}

/** 语音整理结果 */
export interface VoicePolishResult {
  text: string
  rawText: string
  stylePackId: string
  usedRaw: boolean
  message?: string
}
