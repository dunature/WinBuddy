import { atom } from 'jotai'
import type { UsageBudgetStatus, UsageQueryInput, UsageQueryResult } from '@proma/shared'

export type UsageRangePreset = 'today' | 'week' | 'month' | 'custom'

export interface UsageFilterState {
  preset: UsageRangePreset
  startTime: number
  endTime: number
  sessionType: UsageQueryInput['sessionType']
  groupBy: UsageQueryInput['groupBy']
  page: number
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function defaultRange(): Pick<UsageFilterState, 'startTime' | 'endTime'> {
  const now = new Date()
  return {
    startTime: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    endTime: Date.now(),
  }
}

export function resolvePresetRange(preset: UsageRangePreset): Pick<UsageFilterState, 'startTime' | 'endTime'> {
  const now = new Date()
  if (preset === 'today') {
    return { startTime: startOfDay(now), endTime: Date.now() }
  }
  if (preset === 'week') {
    const day = now.getDay() === 0 ? 7 : now.getDay()
    return { startTime: startOfDay(now) - (day - 1) * 24 * 60 * 60 * 1000, endTime: Date.now() }
  }
  if (preset === 'month') {
    return defaultRange()
  }
  return defaultRange()
}

export const usageFilterAtom = atom<UsageFilterState>({
  preset: 'month',
  ...defaultRange(),
  sessionType: 'all',
  groupBy: 'model',
  page: 1,
})

export const usageQueryResultAtom = atom<UsageQueryResult | null>(null)
export const usageLoadingAtom = atom(false)
export const usageErrorAtom = atom<string | null>(null)
export const usageBudgetStatusAtom = atom<UsageBudgetStatus | null>(null)
export const usageRescanningAtom = atom(false)
