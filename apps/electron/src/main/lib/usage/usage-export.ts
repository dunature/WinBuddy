import { writeFileSync } from 'node:fs'
import type { UsageExportFormat, UsageQueryInput, UsageRecord } from '@proma/shared'
import { queryUsage } from './usage-query-service'

function escapeCsvCell(value: string | number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

function toCsv(records: UsageRecord[]): string {
  const header = [
    'timestamp',
    'sessionType',
    'sessionTitle',
    'sessionId',
    'channelId',
    'provider',
    'status',
    'inputTokens',
    'outputTokens',
    'cacheReadInputTokens',
    'cacheCreationInputTokens',
    'totalTokens',
    'costUsd',
    'durationMs',
    'requestIndex',
    'models',
  ]
  const rows = records.map((record) => [
    new Date(record.timestamp).toISOString(),
    record.sessionType,
    record.sessionTitleSnapshot,
    record.sessionId,
    record.channelId,
    record.provider,
    record.status,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadInputTokens,
    record.cacheCreationInputTokens,
    record.totalTokens,
    record.costUsd,
    record.durationMs,
    record.requestIndex,
    record.models.map((model) => model.modelId).join(';'),
  ].map(escapeCsvCell).join(','))
  return [header.map(escapeCsvCell).join(','), ...rows].join('\n')
}

export function exportUsage(query: UsageQueryInput, format: UsageExportFormat, filePath: string): number {
  const result = queryUsage({ ...query, page: 1, pageSize: 50 })
  let records = [...result.records]
  let page = 2
  while (records.length < result.totalRecords) {
    const next = queryUsage({ ...query, page, pageSize: 50 })
    records = [...records, ...next.records]
    page++
  }

  const content = format === 'json'
    ? JSON.stringify(records, null, 2)
    : toCsv(records)
  writeFileSync(filePath, content, 'utf-8')
  return records.length
}
