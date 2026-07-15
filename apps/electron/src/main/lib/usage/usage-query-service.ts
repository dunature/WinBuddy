import type {
  UsageGroupSummary,
  UsageQueryInput,
  UsageQueryResult,
  UsageRecord,
  UsageSummary,
  UsageTrendPoint,
} from '@proma/shared'
import { listUsageMonths, readUsageRecordsFromMonth } from './usage-store'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 50

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localMonthKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function validateQuery(input: UsageQueryInput): Required<Pick<UsageQueryInput, 'startTime' | 'endTime' | 'page' | 'pageSize'>> & UsageQueryInput {
  if (!Number.isFinite(input.startTime) || !Number.isFinite(input.endTime)) {
    throw new Error('用量查询时间范围无效')
  }
  if (input.endTime < input.startTime) {
    throw new Error('用量查询结束时间不能早于开始时间')
  }
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)))
  return { ...input, page, pageSize }
}

function monthInRange(month: string, startTime: number, endTime: number): boolean {
  const startMonth = localMonthKey(startTime)
  const endMonth = localMonthKey(endTime)
  return month >= startMonth && month <= endMonth
}

function matchesQuery(record: UsageRecord, query: UsageQueryInput): boolean {
  if (record.timestamp < query.startTime || record.timestamp > query.endTime) return false
  if (query.sessionType && query.sessionType !== 'all' && record.sessionType !== query.sessionType) return false
  if (query.sessionId && record.sessionId !== query.sessionId) return false
  if (query.channelId && record.channelId !== query.channelId) return false
  if (query.provider && record.provider !== query.provider) return false
  if (query.status && query.status !== 'all' && record.status !== query.status) return false
  if (query.modelId && !record.models.some((model) => model.modelId === query.modelId)) return false
  return true
}

function summarize(records: UsageRecord[]): UsageSummary {
  let totalDuration = 0
  let durationCount = 0
  let costSum = 0
  let costCount = 0
  const summary: UsageSummary = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costCoverageRatio: 0,
    callCount: records.length,
  }

  for (const record of records) {
    summary.totalTokens += record.totalTokens
    summary.inputTokens += record.inputTokens
    summary.outputTokens += record.outputTokens
    summary.cacheReadInputTokens += record.cacheReadInputTokens
    summary.cacheCreationInputTokens += record.cacheCreationInputTokens
    if (record.costUsd !== undefined) {
      costSum += record.costUsd
      costCount++
    }
    if (record.durationMs !== undefined) {
      totalDuration += record.durationMs
      durationCount++
    }
  }

  if (costCount > 0) summary.costUsd = costSum
  summary.costCoverageRatio = records.length > 0 ? costCount / records.length : 0
  if (durationCount > 0) summary.averageDurationMs = totalDuration / durationCount
  return summary
}

function buildTrends(records: UsageRecord[]): UsageTrendPoint[] {
  const byDate = new Map<string, UsageRecord[]>()
  for (const record of records) {
    const key = localDateKey(record.timestamp)
    byDate.set(key, [...(byDate.get(key) ?? []), record])
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRecords]) => {
      const summary = summarize(dayRecords)
      return {
        date,
        totalTokens: summary.totalTokens,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        cacheReadInputTokens: summary.cacheReadInputTokens,
        cacheCreationInputTokens: summary.cacheCreationInputTokens,
        costUsd: summary.costUsd,
        callCount: summary.callCount,
      }
    })
}

function buildGroups(records: UsageRecord[], groupBy: UsageQueryInput['groupBy']): UsageGroupSummary[] {
  if (!groupBy) return []
  const sessionGroups = new Map<string, { label: string; records: UsageRecord[] }>()
  const modelGroups = new Map<string, UsageGroupSummary>()
  const modelCostCounts = new Map<string, number>()

  for (const record of records) {
    if (groupBy === 'session') {
      const label = record.sessionTitleSnapshot ?? record.sessionId
      const existing = sessionGroups.get(record.sessionId)
      sessionGroups.set(record.sessionId, { label, records: [...(existing?.records ?? []), record] })
      continue
    }

    for (const model of record.models) {
      const current = modelGroups.get(model.modelId) ?? {
        key: model.modelId,
        label: model.modelId,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costCoverageRatio: 0,
        callCount: 0,
      }
      current.totalTokens += model.totalTokens
      current.inputTokens += model.inputTokens
      current.outputTokens += model.outputTokens
      current.cacheReadInputTokens += model.cacheReadInputTokens
      current.cacheCreationInputTokens += model.cacheCreationInputTokens
      current.callCount += 1
      if (model.costUsd !== undefined) {
        current.costUsd = (current.costUsd ?? 0) + model.costUsd
        modelCostCounts.set(model.modelId, (modelCostCounts.get(model.modelId) ?? 0) + 1)
      }
      current.costCoverageRatio = current.callCount > 0 ? (modelCostCounts.get(model.modelId) ?? 0) / current.callCount : 0
      modelGroups.set(model.modelId, current)
    }
  }

  if (groupBy === 'model') {
    return [...modelGroups.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }

  return [...sessionGroups.entries()]
    .map(([key, value]) => ({ key, label: value.label, ...summarize(value.records) }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

export function queryUsage(input: UsageQueryInput): UsageQueryResult {
  const query = validateQuery(input)
  const records = listUsageMonths()
    .filter((month) => monthInRange(month, query.startTime, query.endTime))
    .flatMap(readUsageRecordsFromMonth)
    .filter((record) => matchesQuery(record, query))
    .sort((a, b) => b.timestamp - a.timestamp)

  const offset = (query.page - 1) * query.pageSize
  const pageRecords = records.slice(offset, offset + query.pageSize)

  return {
    records: pageRecords,
    summary: summarize(records),
    trends: buildTrends(records),
    groups: buildGroups(records, query.groupBy),
    page: query.page,
    pageSize: query.pageSize,
    totalRecords: records.length,
    hasMore: offset + query.pageSize < records.length,
  }
}
