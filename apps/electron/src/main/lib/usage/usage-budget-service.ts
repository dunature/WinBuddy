import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { UsageBudgetAlert, UsageBudgetConfig, UsageBudgetPeriod, UsageBudgetStatus } from '@proma/shared'
import { getUsageAlertStatePath } from '../config-paths'
import { getSettings } from '../settings-service'
import { queryUsage } from './usage-query-service'

interface AlertState {
  alertedKeys: string[]
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function getBudgetRange(period: UsageBudgetPeriod, now = Date.now()): { start: number; end: number } {
  const date = new Date(now)
  const dayStart = startOfLocalDay(date)
  if (period === 'day') {
    return { start: dayStart, end: dayStart + 24 * 60 * 60 * 1000 - 1 }
  }
  if (period === 'week') {
    const day = date.getDay() === 0 ? 7 : date.getDay()
    const start = dayStart - (day - 1) * 24 * 60 * 60 * 1000
    return { start, end: start + 7 * 24 * 60 * 60 * 1000 - 1 }
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1
  return { start, end }
}

function readAlertState(): AlertState {
  const filePath = getUsageAlertStatePath()
  if (!existsSync(filePath)) return { alertedKeys: [] }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as AlertState
  } catch {
    return { alertedKeys: [] }
  }
}

function writeAlertState(state: AlertState): void {
  writeFileSync(getUsageAlertStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

function alertKey(period: UsageBudgetPeriod, rangeStart: number, kind: UsageBudgetAlert['kind']): string {
  return `${period}:${rangeStart}:${kind}`
}

function normalizeConfig(config: UsageBudgetConfig | undefined): UsageBudgetConfig {
  return config ?? {
    enabled: false,
    period: 'month',
    amountUsd: 0,
    thresholdPercent: 80,
  }
}

export function getUsageBudgetStatus(now = Date.now()): UsageBudgetStatus {
  const budget = normalizeConfig(getSettings().usageBudget)
  const { start, end } = getBudgetRange(budget.period, now)
  const query = queryUsage({ startTime: start, endTime: end })
  const spentUsd = query.summary.costUsd ?? 0
  const usageRatio = budget.amountUsd > 0 ? spentUsd / budget.amountUsd : undefined

  return {
    enabled: budget.enabled,
    period: budget.period,
    amountUsd: budget.amountUsd,
    thresholdPercent: budget.thresholdPercent,
    spentUsd,
    costCoverageRatio: query.summary.costCoverageRatio,
    usageRatio,
    thresholdReached: budget.enabled && usageRatio !== undefined && usageRatio >= budget.thresholdPercent / 100,
    exceeded: budget.enabled && usageRatio !== undefined && usageRatio >= 1,
    rangeStart: start,
    rangeEnd: end,
  }
}

export function consumeUsageBudgetAlert(status: UsageBudgetStatus): UsageBudgetAlert | undefined {
  if (!status.enabled || !status.amountUsd || status.spentUsd === undefined || status.usageRatio === undefined || status.thresholdPercent === undefined) {
    return undefined
  }

  const kind: UsageBudgetAlert['kind'] | undefined = status.exceeded
    ? 'exceeded'
    : status.thresholdReached
      ? 'threshold'
      : undefined
  if (!kind) return undefined

  const key = alertKey(status.period, status.rangeStart, kind)
  const state = readAlertState()
  if (state.alertedKeys.includes(key)) return undefined

  writeAlertState({ alertedKeys: [...state.alertedKeys, key] })
  return {
    period: status.period,
    kind,
    amountUsd: status.amountUsd,
    spentUsd: status.spentUsd,
    usageRatio: status.usageRatio,
    thresholdPercent: status.thresholdPercent,
  }
}
