/**
 * Token 用量统计类型
 *
 * 历史账本记录的是一次模型请求的最终消费估算，不等同于
 * ContextUsageBadge 展示的当前上下文占用。
 */

export type UsageSessionType = 'chat' | 'agent' | 'automation'
export type UsageStatus = 'success' | 'error' | 'aborted'
export type UsageExportFormat = 'csv' | 'json'
export type UsageGroupBy = 'model' | 'session'
export type UsageBudgetPeriod = 'day' | 'week' | 'month'
export type UsageBudgetAlertKind = 'threshold' | 'exceeded'

export interface UsageModelBreakdown {
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  totalTokens: number
  costUsd?: number
  contextWindow?: number
}

export interface UsageRecord {
  id: string
  sourceKey: string
  timestamp: number
  sessionId: string
  sessionTitleSnapshot?: string
  sessionType: UsageSessionType
  automationId?: string
  workspaceId?: string
  channelId?: string
  provider?: string
  status: UsageStatus
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  totalTokens: number
  costUsd?: number
  durationMs?: number
  requestIndex?: number
  models: UsageModelBreakdown[]
}

export interface UsageQueryInput {
  startTime: number
  endTime: number
  sessionType?: UsageSessionType | 'all'
  sessionId?: string
  modelId?: string
  channelId?: string
  provider?: string
  status?: UsageStatus | 'all'
  page?: number
  pageSize?: number
  groupBy?: UsageGroupBy
}

export interface UsageSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd?: number
  costCoverageRatio: number
  callCount: number
  averageDurationMs?: number
}

export interface UsageTrendPoint {
  date: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd?: number
  callCount: number
}

export interface UsageGroupSummary extends UsageSummary {
  key: string
  label: string
}

export interface UsageQueryResult {
  records: UsageRecord[]
  summary: UsageSummary
  trends: UsageTrendPoint[]
  groups: UsageGroupSummary[]
  page: number
  pageSize: number
  totalRecords: number
  hasMore: boolean
}

export interface UsageExportInput {
  query: UsageQueryInput
  format: UsageExportFormat
}

export interface UsageExportResult {
  filePath: string
  recordCount: number
}

export interface UsageBudgetConfig {
  enabled: boolean
  period: UsageBudgetPeriod
  amountUsd: number
  thresholdPercent: number
}

export interface UsageBudgetStatus {
  enabled: boolean
  period: UsageBudgetPeriod
  amountUsd?: number
  thresholdPercent?: number
  spentUsd?: number
  costCoverageRatio: number
  usageRatio?: number
  thresholdReached: boolean
  exceeded: boolean
  rangeStart: number
  rangeEnd: number
}

export interface UsageBudgetAlert {
  period: UsageBudgetPeriod
  kind: UsageBudgetAlertKind
  amountUsd: number
  spentUsd: number
  usageRatio: number
  thresholdPercent: number
}

export interface UsageUpdatedEvent {
  record: UsageRecord
  budgetStatus?: UsageBudgetStatus
  budgetAlert?: UsageBudgetAlert
}

export interface UsageRescanResult {
  scannedSessions: number
  insertedRecords: number
  skippedRecords: number
}

export const USAGE_IPC_CHANNELS = {
  QUERY: 'usage:query',
  EXPORT: 'usage:export',
  GET_BUDGET_STATUS: 'usage:get-budget-status',
  RESCAN: 'usage:rescan',
  UPDATED: 'usage:updated',
  BUDGET_ALERT: 'usage:budget-alert',
} as const
