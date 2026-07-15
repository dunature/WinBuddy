import { createHash } from 'node:crypto'
import type {
  SDKResultMessage,
  UsageModelBreakdown,
  UsageRecord,
  UsageSessionType,
  UsageStatus,
} from '@proma/shared'
import type { StreamUsage } from '@proma/core'

export interface UsageSessionSnapshot {
  sessionId: string
  sessionTitleSnapshot?: string
  sessionType: UsageSessionType
  automationId?: string
  workspaceId?: string
  channelId?: string
  provider?: string
  modelId?: string
}

export interface NormalizeAgentUsageInput {
  result: SDKResultMessage
  session: UsageSessionSnapshot
  timestamp: number
  durationMs?: number
}

export interface NormalizeChatUsageInput {
  usage: StreamUsage
  session: UsageSessionSnapshot
  timestamp: number
  status: UsageStatus
  durationMs?: number
  requestIndex: number
}

function stableId(sourceKey: string): string {
  return createHash('sha256').update(sourceKey).digest('hex').slice(0, 32)
}

function totalTokens(inputTokens: number, outputTokens: number, cacheReadInputTokens: number, cacheCreationInputTokens: number): number {
  return inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens
}

function fromSnakeUsage(usage: SDKResultMessage['usage']): Omit<UsageModelBreakdown, 'modelId'> {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens: totalTokens(inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens),
  }
}

function sourceKey(parts: readonly (string | number | undefined)[]): string {
  return parts.map((part) => part === undefined ? '-' : String(part)).join(':')
}

function normalizeStatus(status: UsageStatus): UsageStatus {
  return status
}

export function normalizeAgentUsage(input: NormalizeAgentUsageInput): UsageRecord | null {
  const { result, session, timestamp, durationMs } = input
  if (!result.usage) return null

  const base = fromSnakeUsage(result.usage)
  const modelEntries = Object.entries(result.modelUsage ?? {})
  const fallbackModelId = session.modelId ?? 'unknown'
  const models: UsageModelBreakdown[] = modelEntries.length > 0
    ? modelEntries.map(([modelId, modelUsage]) => {
      const hasTokenBreakdown = modelUsage.inputTokens !== undefined
        || modelUsage.outputTokens !== undefined
        || modelUsage.cacheReadInputTokens !== undefined
        || modelUsage.cacheCreationInputTokens !== undefined
      const shouldUseAggregate = !hasTokenBreakdown && modelEntries.length === 1
      const inputTokens = shouldUseAggregate ? base.inputTokens : modelUsage.inputTokens ?? 0
      const outputTokens = shouldUseAggregate ? base.outputTokens : modelUsage.outputTokens ?? 0
      const cacheReadInputTokens = shouldUseAggregate ? base.cacheReadInputTokens : modelUsage.cacheReadInputTokens ?? 0
      const cacheCreationInputTokens = shouldUseAggregate ? base.cacheCreationInputTokens : modelUsage.cacheCreationInputTokens ?? 0
      return {
        modelId,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        totalTokens: totalTokens(inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens),
        costUsd: modelUsage.costUSD ?? (modelEntries.length === 1 ? result.total_cost_usd : undefined),
        contextWindow: modelUsage.contextWindow,
      }
    })
    : [{
      modelId: fallbackModelId,
      ...base,
      costUsd: result.total_cost_usd,
    }]

  const key = sourceKey([
    session.sessionType,
    session.sessionId,
    result.session_id,
    result.subtype,
    timestamp,
    base.totalTokens,
  ])

  return {
    id: stableId(key),
    sourceKey: key,
    timestamp,
    sessionId: session.sessionId,
    sessionTitleSnapshot: session.sessionTitleSnapshot,
    sessionType: session.sessionType,
    automationId: session.automationId,
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    provider: session.provider,
    status: result.subtype === 'success' ? 'success' : 'error',
    inputTokens: base.inputTokens,
    outputTokens: base.outputTokens,
    cacheReadInputTokens: base.cacheReadInputTokens,
    cacheCreationInputTokens: base.cacheCreationInputTokens,
    totalTokens: base.totalTokens,
    costUsd: result.total_cost_usd,
    durationMs,
    models,
  }
}

export function normalizeChatUsage(input: NormalizeChatUsageInput): UsageRecord | null {
  const { usage, session, timestamp, status, durationMs, requestIndex } = input
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const cacheReadInputTokens = usage.cacheReadInputTokens ?? 0
  const cacheCreationInputTokens = usage.cacheCreationInputTokens ?? 0
  const total = totalTokens(inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens)
  if (total <= 0 && usage.costUsd === undefined) return null

  const key = sourceKey([
    'chat',
    session.sessionId,
    requestIndex,
    timestamp,
    total,
  ])

  const modelId = session.modelId ?? 'unknown'
  return {
    id: stableId(key),
    sourceKey: key,
    timestamp,
    sessionId: session.sessionId,
    sessionTitleSnapshot: session.sessionTitleSnapshot,
    sessionType: session.sessionType,
    automationId: session.automationId,
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    provider: session.provider,
    status: normalizeStatus(status),
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens: total,
    costUsd: usage.costUsd,
    durationMs,
    requestIndex,
    models: [{
      modelId,
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalTokens: total,
      costUsd: usage.costUsd,
    }],
  }
}

export function getUsageMonth(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
