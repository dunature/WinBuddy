import type { ModelOption } from './chat'

export type PromptOptimizationMode = 'chat' | 'agent'

export type PromptOptimizationStatus = 'success' | 'cancelled' | 'timeout' | 'error'

export interface PromptOptimizationModelSelection {
  channelId: string
  modelId: string
}

export interface PromptOptimizationUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export interface PromptReferenceValidation {
  valid: boolean
  expected: number
  actual: number
  failures: string[]
}

export interface PromptOptimizationRequest {
  mode: PromptOptimizationMode
  draftText: string
  draftHtml?: string
  conversationId?: string
  sessionId?: string
  workspaceId?: string
  workspaceSlug?: string
  workspacePath?: string
  currentModel?: PromptOptimizationModelSelection | null
  currentModelOption?: ModelOption | null
  recentMessages?: string[]
}

export interface PromptOptimizationCancelInput {
  mode: PromptOptimizationMode
  conversationId?: string
  sessionId?: string
}

export interface OptimizedPromptResult {
  status: PromptOptimizationStatus
  optimizedText?: string
  optimizedHtml?: string
  appliedFrameworks: string[]
  usage?: PromptOptimizationUsage
  durationMs: number
  costEstimate?: number
  referenceValidation: PromptReferenceValidation
  errorCode?: string
  errorMessage?: string
}

export const PROMPT_OPTIMIZATION_IPC_CHANNELS = {
  OPTIMIZE: 'prompt-optimization:optimize',
  CANCEL: 'prompt-optimization:cancel',
} as const
