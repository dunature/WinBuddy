import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { UsageRecord } from '@proma/shared'
import { getUsageDir, getUsageIndexPath, getUsageMonthPath } from '../config-paths'
import { getUsageMonth } from './usage-normalizer'

interface UsageIndex {
  sourceKeys: string[]
  backfillCursors?: Record<string, number>
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch (error) {
    console.warn('[用量统计] 索引读取失败，将重建:', error)
    return null
  }
}

function writeIndex(index: UsageIndex): void {
  writeFileSync(getUsageIndexPath(), JSON.stringify(index, null, 2), 'utf-8')
}

function monthFromFileName(fileName: string): string | null {
  const name = basename(fileName)
  return /^\d{4}-\d{2}\.jsonl$/.test(name) ? name.slice(0, 7) : null
}

export function readUsageRecordsFromMonth(month: string): UsageRecord[] {
  const filePath = getUsageMonthPath(month)
  if (!existsSync(filePath)) return []

  const records: UsageRecord[] = []
  const lines = readFileSync(filePath, 'utf-8').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line) as UsageRecord)
    } catch {
      console.warn(`[用量统计] 跳过损坏 JSONL 行: ${filePath}`)
    }
  }
  return records
}

export function listUsageMonths(): string[] {
  const dir = getUsageDir()
  return readdirSync(dir)
    .map(monthFromFileName)
    .filter((month): month is string => month !== null)
    .sort()
}

export function readAllUsageRecords(): UsageRecord[] {
  return listUsageMonths().flatMap(readUsageRecordsFromMonth)
}

function rebuildIndex(): UsageIndex {
  const sourceKeys = new Set<string>()
  for (const record of readAllUsageRecords()) {
    sourceKeys.add(record.sourceKey)
  }
  const index: UsageIndex = { sourceKeys: [...sourceKeys] }
  writeIndex(index)
  return index
}

export function readUsageIndex(): UsageIndex {
  return readJsonFile<UsageIndex>(getUsageIndexPath()) ?? rebuildIndex()
}

export function getBackfillCursor(key: string): number | undefined {
  return readUsageIndex().backfillCursors?.[key]
}

export function setBackfillCursor(key: string, value: number): void {
  const index = readUsageIndex()
  writeIndex({
    ...index,
    backfillCursors: {
      ...(index.backfillCursors ?? {}),
      [key]: value,
    },
  })
}

export function appendUsageRecord(record: UsageRecord): boolean {
  const index = readUsageIndex()
  if (index.sourceKeys.includes(record.sourceKey)) return false

  const month = getUsageMonth(record.timestamp)
  appendFileSync(getUsageMonthPath(month), `${JSON.stringify(record)}\n`, 'utf-8')
  writeIndex({
    ...index,
    sourceKeys: [...index.sourceKeys, record.sourceKey],
  })
  return true
}
