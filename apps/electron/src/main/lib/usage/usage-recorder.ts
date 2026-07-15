import { BrowserWindow } from 'electron'
import type { UsageRecord, UsageUpdatedEvent } from '@proma/shared'
import { USAGE_IPC_CHANNELS } from '@proma/shared'
import { appendUsageRecord } from './usage-store'
import { consumeUsageBudgetAlert, getUsageBudgetStatus } from './usage-budget-service'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

export function recordUsage(record: UsageRecord): boolean {
  try {
    const inserted = appendUsageRecord(record)
    if (!inserted) return false

    const budgetStatus = getUsageBudgetStatus()
    const budgetAlert = consumeUsageBudgetAlert(budgetStatus)
    const event: UsageUpdatedEvent = { record, budgetStatus, budgetAlert }
    broadcast(USAGE_IPC_CHANNELS.UPDATED, event)
    if (budgetAlert) {
      broadcast(USAGE_IPC_CHANNELS.BUDGET_ALERT, budgetAlert)
    }
    return true
  } catch (error) {
    console.warn('[用量统计] 写入失败，不影响当前请求:', error)
    return false
  }
}
