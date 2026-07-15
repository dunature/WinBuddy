import * as React from 'react'
import { useAtom } from 'jotai'
import { BarChart3, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { UsageBudgetConfig, UsageExportFormat, UsageQueryInput, UsageRecord } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  resolvePresetRange,
  usageBudgetStatusAtom,
  usageErrorAtom,
  usageFilterAtom,
  usageLoadingAtom,
  usageQueryResultAtom,
  usageRescanningAtom,
  type UsageFilterState,
  type UsageRangePreset,
} from '@/atoms/usage-atoms'
import { SettingsCard, SettingsSection } from './primitives'

const PAGE_SIZE = 50

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatUsd(value: number | undefined): string {
  return value === undefined ? '暂无估算' : `$${value.toFixed(4)}`
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return '-'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function fromDateInputValue(value: string, endOfDay: boolean): number {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return Date.now()
  const date = new Date(year, month - 1, day)
  if (endOfDay) date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toQuery(filter: UsageFilterState): UsageQueryInput {
  return {
    startTime: filter.startTime,
    endTime: filter.endTime,
    sessionType: filter.sessionType,
    groupBy: filter.groupBy,
    page: filter.page,
    pageSize: PAGE_SIZE,
  }
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function RecordRow({ record }: { record: UsageRecord }): React.ReactElement {
  return (
    <div className="grid grid-cols-[120px_80px_1fr_120px_110px] gap-3 px-3 py-2 text-xs">
      <div className="tabular-nums text-muted-foreground">{new Date(record.timestamp).toLocaleString()}</div>
      <div>{record.sessionType === 'automation' ? '自动任务' : record.sessionType === 'agent' ? 'Agent' : 'Chat'}</div>
      <div className="truncate" title={record.sessionTitleSnapshot ?? record.sessionId}>
        {record.sessionTitleSnapshot ?? record.sessionId}
      </div>
      <div className="tabular-nums">{formatTokens(record.totalTokens)}</div>
      <div className="tabular-nums">{formatUsd(record.costUsd)}</div>
    </div>
  )
}

export function UsageSettings(): React.ReactElement {
  const [filter, setFilter] = useAtom(usageFilterAtom)
  const [result, setResult] = useAtom(usageQueryResultAtom)
  const [loading, setLoading] = useAtom(usageLoadingAtom)
  const [error, setError] = useAtom(usageErrorAtom)
  const [budgetStatus, setBudgetStatus] = useAtom(usageBudgetStatusAtom)
  const [rescanning, setRescanning] = useAtom(usageRescanningAtom)
  const initialRescanRef = React.useRef(false)
  const [budget, setBudget] = React.useState<UsageBudgetConfig>({
    enabled: false,
    period: 'month',
    amountUsd: 0,
    thresholdPercent: 80,
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [usageResult, status, settings] = await Promise.all([
        window.electronAPI.queryUsage(toQuery(filter)),
        window.electronAPI.getUsageBudgetStatus(),
        window.electronAPI.getSettings(),
      ])
      setResult(usageResult)
      setBudgetStatus(status)
      setBudget(settings.usageBudget ?? {
        enabled: false,
        period: 'month',
        amountUsd: 0,
        thresholdPercent: 80,
      })
    } catch (err) {
      setError(sanitizeError(err))
    } finally {
      setLoading(false)
    }
  }, [filter, setBudgetStatus, setError, setLoading, setResult])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (initialRescanRef.current) return
    initialRescanRef.current = true
    window.electronAPI.rescanUsageHistory()
      .then((summary) => {
        if (summary.insertedRecords > 0) void load()
      })
      .catch(() => {})
  }, [load])

  React.useEffect(() => {
    return window.electronAPI.onUsageUpdated(() => {
      void load()
    })
  }, [load])

  const updatePreset = (preset: UsageRangePreset): void => {
    const range = resolvePresetRange(preset)
    setFilter((prev) => ({ ...prev, ...range, preset, page: 1 }))
  }

  const saveBudget = async (next: UsageBudgetConfig): Promise<void> => {
    setBudget(next)
    try {
      const settings = await window.electronAPI.updateSettings({ usageBudget: next })
      setBudget(settings.usageBudget ?? next)
      setBudgetStatus(await window.electronAPI.getUsageBudgetStatus())
    } catch {
      toast.error('用量预算保存失败')
    }
  }

  const exportRecords = async (format: UsageExportFormat): Promise<void> => {
    try {
      const exported = await window.electronAPI.exportUsage(toQuery(filter), format)
      if (exported.filePath) {
        toast.success(`已导出 ${exported.recordCount} 条用量记录`)
      }
    } catch (err) {
      toast.error('导出失败', { description: sanitizeError(err) })
    }
  }

  const rescan = async (): Promise<void> => {
    setRescanning(true)
    try {
      const summary = await window.electronAPI.rescanUsageHistory()
      toast.success(`重新扫描完成：新增 ${summary.insertedRecords} 条`)
      await load()
    } catch (err) {
      toast.error('重新扫描失败', { description: sanitizeError(err) })
    } finally {
      setRescanning(false)
    }
  }

  const summary = result?.summary
  const maxTrendTokens = Math.max(1, ...(result?.trends.map((point) => point.totalTokens) ?? [0]))

  return (
    <div className="space-y-5">
      <SettingsSection
        title="用量统计"
        description="查看 Chat、Agent 与自动任务的 Token 历史和费用估算。"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={rescan} disabled={rescanning}>
              <RefreshCw className={cn('size-4 mr-1.5', rescanning && 'animate-spin')} />
              重新扫描
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportRecords('csv')}>
              <Download className="size-4 mr-1.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportRecords('json')}>JSON</Button>
          </div>
        }
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['today', 'week', 'month', 'custom'] as const).map((preset) => (
              <Button
                key={preset}
                type="button"
                variant={filter.preset === preset ? 'default' : 'outline'}
                size="sm"
                onClick={() => updatePreset(preset)}
              >
                {preset === 'today' ? '今天' : preset === 'week' ? '本周' : preset === 'month' ? '本月' : '自定义'}
              </Button>
            ))}
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={filter.sessionType ?? 'all'}
              onChange={(event) => setFilter((prev) => ({ ...prev, sessionType: event.target.value as UsageQueryInput['sessionType'], page: 1 }))}
            >
              <option value="all">全部来源</option>
              <option value="chat">Chat</option>
              <option value="agent">Agent</option>
              <option value="automation">自动任务</option>
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={filter.groupBy ?? 'model'}
              onChange={(event) => setFilter((prev) => ({ ...prev, groupBy: event.target.value as UsageQueryInput['groupBy'] }))}
            >
              <option value="model">按模型</option>
              <option value="session">按会话</option>
            </select>
          </div>
          {filter.preset === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={toDateInputValue(filter.startTime)}
                onChange={(event) => setFilter((prev) => ({ ...prev, startTime: fromDateInputValue(event.target.value, false), page: 1 }))}
                className="w-40"
              />
              <span className="text-sm text-muted-foreground">至</span>
              <Input
                type="date"
                value={toDateInputValue(filter.endTime)}
                onChange={(event) => setFilter((prev) => ({ ...prev, endTime: fromDateInputValue(event.target.value, true), page: 1 }))}
                className="w-40"
              />
            </div>
          )}
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            费用估算来自模型或 SDK 返回的客户端估算值，不是账单真值，不能用于终端计费或硬性财务决策。
          </p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="概览">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="总 Token" value={formatTokens(summary?.totalTokens ?? 0)} hint={`${summary?.callCount ?? 0} 次调用`} />
          <StatTile label="输入 / 输出" value={`${formatTokens(summary?.inputTokens ?? 0)} / ${formatTokens(summary?.outputTokens ?? 0)}`} />
          <StatTile label="缓存 Token" value={formatTokens((summary?.cacheReadInputTokens ?? 0) + (summary?.cacheCreationInputTokens ?? 0))} />
          <StatTile label="费用估算" value={formatUsd(summary?.costUsd)} hint={`覆盖率 ${Math.round((summary?.costCoverageRatio ?? 0) * 100)}%`} />
        </div>
      </SettingsSection>

      <SettingsSection title="预算提醒">
        <SettingsCard divided={false} className="p-4 space-y-3">
          <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={budget.enabled}
                onChange={(event) => { void saveBudget({ ...budget, enabled: event.target.checked }) }}
              />
              启用
            </label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={budget.period}
              onChange={(event) => { void saveBudget({ ...budget, period: event.target.value as UsageBudgetConfig['period'] }) }}
            >
              <option value="day">日预算</option>
              <option value="week">周预算</option>
              <option value="month">月预算</option>
            </select>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={budget.amountUsd}
              onChange={(event) => setBudget({ ...budget, amountUsd: Number(event.target.value) })}
              onBlur={() => saveBudget(budget)}
              placeholder="美元预算"
            />
            <Input
              type="number"
              min={1}
              max={100}
              value={budget.thresholdPercent}
              onChange={(event) => setBudget({ ...budget, thresholdPercent: Number(event.target.value) })}
              onBlur={() => saveBudget(budget)}
              placeholder="提醒阈值"
            />
            <div className="text-right text-sm tabular-nums">
              {budgetStatus?.usageRatio !== undefined ? `${Math.round(budgetStatus.usageRatio * 100)}%` : '-'}
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', budgetStatus?.exceeded ? 'bg-red-500' : 'bg-emerald-500')}
              style={{ width: `${Math.min(100, Math.round((budgetStatus?.usageRatio ?? 0) * 100))}%` }}
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="趋势与分组">
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="flex h-28 items-end gap-1">
            {result?.trends.length ? result.trends.map((point) => (
              <div key={point.date} className="flex min-w-6 flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${Math.max(4, (point.totalTokens / maxTrendTokens) * 96)}px` }}
                  title={`${point.date}: ${formatTokens(point.totalTokens)}`}
                />
                <span className="text-[10px] text-muted-foreground">{point.date.slice(5)}</span>
              </div>
            )) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">暂无趋势数据</div>
            )}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {(result?.groups ?? []).slice(0, 8).map((group) => (
              <div key={group.key} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span className="truncate">{group.label}</span>
                <span className="tabular-nums text-muted-foreground">{formatTokens(group.totalTokens)}</span>
              </div>
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="调用明细"
        action={<span className="text-xs text-muted-foreground">每页 {PAGE_SIZE} 条</span>}
      >
        <SettingsCard divided={false} className="overflow-hidden">
          <div className="grid grid-cols-[120px_80px_1fr_120px_110px] gap-3 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div>时间</div>
            <div>来源</div>
            <div>会话</div>
            <div>Token</div>
            <div>费用估算</div>
          </div>
          {loading ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="flex h-24 items-center justify-center text-sm text-destructive">{error}</div>
          ) : result?.records.length ? (
            <div className="divide-y divide-border/50">
              {result.records.map((record) => <RecordRow key={record.id} record={record} />)}
            </div>
          ) : (
            <div className="flex h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <BarChart3 className="size-5" />
              暂无用量记录
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">共 {result?.totalRecords ?? 0} 条</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={filter.page <= 1}
                onClick={() => setFilter((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              >
                上一页
              </Button>
              <span className="text-xs tabular-nums">{filter.page}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!result?.hasMore}
                onClick={() => setFilter((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                下一页
              </Button>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
