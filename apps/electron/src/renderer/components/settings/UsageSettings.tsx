import * as React from 'react'
import { useAtom } from 'jotai'
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  Download,
  Layers3,
  LineChart,
  Loader2,
  RefreshCw,
  WalletCards,
} from 'lucide-react'
import { toast } from 'sonner'
import type { UsageBudgetConfig, UsageExportFormat, UsageGroupSummary, UsageQueryInput, UsageRecord, UsageTrendPoint } from '@proma/shared'
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
const TREND_WIDTH = 720
const TREND_HEIGHT = 240
const TREND_PADDING = { top: 18, right: 20, bottom: 38, left: 54 }

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

function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '-'
  return `${Math.round(value * 100)}%`
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

function getSessionTypeLabel(type: UsageRecord['sessionType']): string {
  if (type === 'automation') return '自动任务'
  if (type === 'agent') return 'Agent'
  return 'Chat'
}

function getStatusLabel(status: UsageRecord['status']): string {
  if (status === 'error') return '失败'
  if (status === 'aborted') return '已取消'
  return '成功'
}

function getBudgetPeriodLabel(period: UsageBudgetConfig['period']): string {
  if (period === 'day') return '日预算'
  if (period === 'week') return '周预算'
  return '月预算'
}

function getPresetLabel(preset: UsageRangePreset): string {
  if (preset === 'today') return '今天'
  if (preset === 'week') return '本周'
  if (preset === 'month') return '本月'
  return '自定义'
}

function getRecordModelLabel(record: UsageRecord): string {
  if (record.models.length === 0) return record.provider ?? '-'
  const firstModel = record.models[0]
  if (!firstModel) return record.provider ?? '-'
  if (record.models.length === 1) return firstModel.modelId
  return `${firstModel.modelId} 等 ${record.models.length} 个`
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}): React.ReactElement {
  return (
    <div className="min-h-[104px] rounded-lg bg-card px-4 py-3 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.55),0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  )
}

function EmptyPanel({ label }: { label: string }): React.ReactElement {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 text-sm text-muted-foreground">
      <BarChart3 className="size-5" aria-hidden="true" />
      {label}
    </div>
  )
}

function LoadingPanel(): React.ReactElement {
  return (
    <div className="flex min-h-[180px] items-center justify-center gap-2 rounded-lg bg-muted/30 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      加载中...
    </div>
  )
}

function TrendChart({ trends, loading }: { trends: UsageTrendPoint[]; loading: boolean }): React.ReactElement {
  if (loading) return <LoadingPanel />
  if (trends.length === 0) return <EmptyPanel label="暂无趋势数据" />

  const maxTokens = Math.max(1, ...trends.map((point) => point.totalTokens))
  const plotWidth = TREND_WIDTH - TREND_PADDING.left - TREND_PADDING.right
  const plotHeight = TREND_HEIGHT - TREND_PADDING.top - TREND_PADDING.bottom
  const points = trends.map((point, index) => {
    const x = trends.length === 1
      ? TREND_PADDING.left + plotWidth / 2
      : TREND_PADDING.left + (index / (trends.length - 1)) * plotWidth
    const y = TREND_PADDING.top + (1 - point.totalTokens / maxTokens) * plotHeight
    return { x, y, point }
  })
  const linePath = buildLinePath(points)
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const areaPath = firstPoint && lastPoint
    ? `${linePath} L ${lastPoint.x.toFixed(2)} ${TREND_HEIGHT - TREND_PADDING.bottom} L ${firstPoint.x.toFixed(2)} ${TREND_HEIGHT - TREND_PADDING.bottom} Z`
    : ''
  const labelStep = Math.max(1, Math.ceil(trends.length / 6))
  const gridValues = [1, 0.75, 0.5, 0.25, 0]

  return (
    <div>
      <div className="h-[260px] w-full overflow-hidden rounded-lg bg-muted/20 px-2 py-3">
        <svg
          role="img"
          aria-label="Token 用量趋势图"
          viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="usageTrendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.28)" />
              <stop offset="100%" stopColor="hsl(var(--primary) / 0.02)" />
            </linearGradient>
          </defs>
          {gridValues.map((ratio) => {
            const y = TREND_PADDING.top + (1 - ratio) * plotHeight
            return (
              <g key={ratio}>
                <line
                  x1={TREND_PADDING.left}
                  x2={TREND_WIDTH - TREND_PADDING.right}
                  y1={y}
                  y2={y}
                  stroke="hsl(var(--border) / 0.55)"
                  strokeWidth="1"
                />
                <text x="8" y={y + 4} className="fill-muted-foreground text-[11px] tabular-nums">
                  {formatTokens(Math.round(maxTokens * ratio))}
                </text>
              </g>
            )
          })}
          <path d={areaPath} fill="url(#usageTrendFill)" />
          <path d={linePath} fill="none" stroke="hsl(var(--primary))" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {points.map(({ x, y, point }, index) => (
            <g key={point.date}>
              <circle cx={x} cy={y} r="4" fill="hsl(var(--background))" stroke="hsl(var(--primary))" strokeWidth="2" vectorEffect="non-scaling-stroke">
                <title>{`${point.date}: ${formatTokens(point.totalTokens)} Token，${point.callCount} 次调用`}</title>
              </circle>
              {(index % labelStep === 0 || index === points.length - 1) && (
                <text x={x} y={TREND_HEIGHT - 10} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                  {point.date.slice(5)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-md bg-muted/30 px-3 py-2">
          <span className="font-medium text-foreground">峰值</span>
          <span className="ml-2 tabular-nums">{formatTokens(maxTokens)} Token</span>
        </div>
        <div className="rounded-md bg-muted/30 px-3 py-2">
          <span className="font-medium text-foreground">时间点</span>
          <span className="ml-2 tabular-nums">{trends.length}</span>
        </div>
        <div className="rounded-md bg-muted/30 px-3 py-2">
          <span className="font-medium text-foreground">总调用</span>
          <span className="ml-2 tabular-nums">{trends.reduce((sum, point) => sum + point.callCount, 0)}</span>
        </div>
      </div>
    </div>
  )
}

function UsageComposition({
  inputTokens,
  outputTokens,
  cacheTokens,
}: {
  inputTokens: number
  outputTokens: number
  cacheTokens: number
}): React.ReactElement {
  const total = Math.max(1, inputTokens + outputTokens + cacheTokens)
  const segments = [
    { key: 'input', label: '输入', value: inputTokens, className: 'bg-primary' },
    { key: 'output', label: '输出', value: outputTokens, className: 'bg-emerald-500' },
    { key: 'cache', label: '缓存', value: cacheTokens, className: 'bg-amber-500' },
  ]

  return (
    <div className="rounded-lg bg-muted/25 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">Token 构成</span>
        <span className="text-muted-foreground tabular-nums">{formatTokens(total)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={cn(segment.className, segment.value === 0 && 'hidden')}
            style={{ width: `${Math.max(2, (segment.value / total) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn('size-2 rounded-full', segment.className)} />
              {segment.label}
            </span>
            <span className="tabular-nums text-foreground">{formatTokens(segment.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GroupList({ groups, groupBy }: { groups: UsageGroupSummary[]; groupBy: UsageQueryInput['groupBy'] }): React.ReactElement {
  const topGroups = groups.slice(0, 8)
  const maxTokens = Math.max(1, ...topGroups.map((group) => group.totalTokens))

  return (
    <SettingsCard divided={false} className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{groupBy === 'session' ? '会话分布' : '模型分布'}</h4>
          <p className="mt-1 text-xs text-muted-foreground">按 Token 消耗排序展示前 8 项</p>
        </div>
        <Layers3 className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      {topGroups.length === 0 ? (
        <EmptyPanel label="暂无分组数据" />
      ) : (
        <div className="space-y-3">
          {topGroups.map((group) => (
            <div key={group.key}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-foreground" title={group.label}>{group.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatTokens(group.totalTokens)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/75" style={{ width: `${Math.max(4, (group.totalTokens / maxTokens) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}

function BudgetPanel({
  budget,
  setBudget,
  saveBudget,
  usageRatio,
  spentUsd,
  exceeded,
}: {
  budget: UsageBudgetConfig
  setBudget: React.Dispatch<React.SetStateAction<UsageBudgetConfig>>
  saveBudget: (next: UsageBudgetConfig) => Promise<void>
  usageRatio: number | undefined
  spentUsd: number | undefined
  exceeded: boolean
}): React.ReactElement {
  const ratio = clampRatio(usageRatio ?? 0)

  return (
    <SettingsCard divided={false} className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">预算提醒</h4>
          <p className="mt-1 text-xs text-muted-foreground">仅统计带费用估算的记录，提醒不会阻断请求。</p>
        </div>
        <WalletCards className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="space-y-3">
        <label className="flex min-h-10 items-center justify-between gap-3 rounded-md bg-muted/25 px-3 text-sm">
          <span className="font-medium text-foreground">启用提醒</span>
          <input
            type="checkbox"
            checked={budget.enabled}
            onChange={(event) => { void saveBudget({ ...budget, enabled: event.target.checked }) }}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            周期
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={budget.period}
              onChange={(event) => { void saveBudget({ ...budget, period: event.target.value as UsageBudgetConfig['period'] }) }}
            >
              <option value="day">日预算</option>
              <option value="week">周预算</option>
              <option value="month">月预算</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            金额
            <Input
              type="number"
              min={0}
              step="0.01"
              value={budget.amountUsd}
              onChange={(event) => setBudget({ ...budget, amountUsd: Number(event.target.value) })}
              onBlur={() => saveBudget(budget)}
              placeholder="美元预算"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            阈值
            <Input
              type="number"
              min={1}
              max={100}
              value={budget.thresholdPercent}
              onChange={(event) => setBudget({ ...budget, thresholdPercent: Number(event.target.value) })}
              onBlur={() => saveBudget(budget)}
              placeholder="提醒阈值"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-muted/25 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">{getBudgetPeriodLabel(budget.period)}</span>
          <span className="tabular-nums text-muted-foreground">
            {formatUsd(spentUsd)} / {budget.amountUsd > 0 ? `$${budget.amountUsd.toFixed(2)}` : '未设置'}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-200', exceeded ? 'bg-destructive' : 'bg-emerald-500')}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          当前使用率 <span className="font-medium text-foreground tabular-nums">{formatPercent(usageRatio)}</span>
        </div>
      </div>
    </SettingsCard>
  )
}

function RecordRow({ record }: { record: UsageRecord }): React.ReactElement {
  return (
    <div className="grid min-w-[860px] grid-cols-[150px_88px_minmax(220px,1fr)_160px_100px_110px_90px] items-center gap-3 px-4 py-3 text-xs">
      <div className="tabular-nums text-muted-foreground">{new Date(record.timestamp).toLocaleString()}</div>
      <div>{getSessionTypeLabel(record.sessionType)}</div>
      <div className="truncate" title={record.sessionTitleSnapshot ?? record.sessionId}>
        {record.sessionTitleSnapshot ?? record.sessionId}
      </div>
      <div className="truncate text-muted-foreground" title={getRecordModelLabel(record)}>{getRecordModelLabel(record)}</div>
      <div className="tabular-nums">{formatTokens(record.totalTokens)}</div>
      <div className="tabular-nums">{formatUsd(record.costUsd)}</div>
      <div className={cn('text-xs', record.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{getStatusLabel(record.status)}</div>
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
  const cacheTokens = (summary?.cacheReadInputTokens ?? 0) + (summary?.cacheCreationInputTokens ?? 0)
  const rangeLabel = `${toDateInputValue(filter.startTime)} 至 ${toDateInputValue(filter.endTime)}`

  return (
    <div className="space-y-6">
      <SettingsSection
        title="用量统计"
        description="查看 Chat、Agent 与自动任务的 Token 历史和费用估算。"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={rescan} disabled={rescanning}>
              <RefreshCw className={cn('size-4', rescanning && 'animate-spin')} />
              重新扫描
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportRecords('csv')}>
              <Download className="size-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportRecords('json')}>JSON</Button>
          </div>
        }
      >
        <SettingsCard divided={false} className="overflow-hidden">
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg bg-muted p-1">
                  {(['today', 'week', 'month', 'custom'] as const).map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={filter.preset === preset ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => updatePreset(preset)}
                      className="min-w-[64px]"
                    >
                      {getPresetLabel(preset)}
                    </Button>
                  ))}
                </div>
                <select
                  className="h-9 min-w-[132px] rounded-md border border-input bg-background px-3 text-sm"
                  value={filter.sessionType ?? 'all'}
                  onChange={(event) => setFilter((prev) => ({ ...prev, sessionType: event.target.value as UsageQueryInput['sessionType'], page: 1 }))}
                  aria-label="筛选来源"
                >
                  <option value="all">全部来源</option>
                  <option value="chat">Chat</option>
                  <option value="agent">Agent</option>
                  <option value="automation">自动任务</option>
                </select>
                <select
                  className="h-9 min-w-[132px] rounded-md border border-input bg-background px-3 text-sm"
                  value={filter.groupBy ?? 'model'}
                  onChange={(event) => setFilter((prev) => ({ ...prev, groupBy: event.target.value as UsageQueryInput['groupBy'] }))}
                  aria-label="分组方式"
                >
                  <option value="model">按模型</option>
                  <option value="session">按会话</option>
                </select>
              </div>
              {filter.preset === 'custom' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={toDateInputValue(filter.startTime)}
                    onChange={(event) => setFilter((prev) => ({ ...prev, startTime: fromDateInputValue(event.target.value, false), page: 1 }))}
                    className="w-40"
                    aria-label="开始日期"
                  />
                  <span className="text-sm text-muted-foreground">至</span>
                  <Input
                    type="date"
                    value={toDateInputValue(filter.endTime)}
                    onChange={(event) => setFilter((prev) => ({ ...prev, endTime: fromDateInputValue(event.target.value, true), page: 1 }))}
                    className="w-40"
                    aria-label="结束日期"
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg bg-muted/35 px-3 py-2 text-xs leading-relaxed text-muted-foreground xl:max-w-[360px]">
              <div className="font-medium text-foreground">当前范围：{rangeLabel}</div>
              <div className="mt-1">费用估算来自模型或 SDK 返回的客户端估算值，不是账单真值。</div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="概览">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile icon={<Database className="size-4" />} label="总 Token" value={formatTokens(summary?.totalTokens ?? 0)} hint={`${summary?.callCount ?? 0} 次调用`} />
          <StatTile icon={<Activity className="size-4" />} label="输入 / 输出" value={`${formatTokens(summary?.inputTokens ?? 0)} / ${formatTokens(summary?.outputTokens ?? 0)}`} hint="分别统计四类 Token" />
          <StatTile icon={<Layers3 className="size-4" />} label="缓存 Token" value={formatTokens(cacheTokens)} hint={`读 ${formatTokens(summary?.cacheReadInputTokens ?? 0)} / 写 ${formatTokens(summary?.cacheCreationInputTokens ?? 0)}`} />
          <StatTile icon={<WalletCards className="size-4" />} label="费用估算" value={formatUsd(summary?.costUsd)} hint={`费用覆盖率 ${formatPercent(summary?.costCoverageRatio)}`} />
          <StatTile icon={<Clock3 className="size-4" />} label="平均耗时" value={formatDuration(summary?.averageDurationMs)} hint="按已记录请求计算" />
        </div>
      </SettingsSection>

      <SettingsSection title="趋势分析">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
          <SettingsCard divided={false} className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Token 趋势</h4>
                <p className="mt-1 text-xs text-muted-foreground">按日期展示总消耗，适合观察上升、下降和峰值。</p>
              </div>
              <LineChart className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <TrendChart trends={result?.trends ?? []} loading={loading} />
            <div className="mt-4">
              <UsageComposition
                inputTokens={summary?.inputTokens ?? 0}
                outputTokens={summary?.outputTokens ?? 0}
                cacheTokens={cacheTokens}
              />
            </div>
          </SettingsCard>

          <div className="space-y-4">
            <BudgetPanel
              budget={budget}
              setBudget={setBudget}
              saveBudget={saveBudget}
              usageRatio={budgetStatus?.usageRatio}
              spentUsd={budgetStatus?.spentUsd}
              exceeded={budgetStatus?.exceeded ?? false}
            />
            <GroupList groups={result?.groups ?? []} groupBy={filter.groupBy} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="调用明细"
        description="每页展示 50 条记录，完整数据可导出 CSV 或 JSON。"
        action={<span className="text-xs text-muted-foreground">共 {result?.totalRecords ?? 0} 条</span>}
      >
        <SettingsCard divided={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="grid min-w-[860px] grid-cols-[150px_88px_minmax(220px,1fr)_160px_100px_110px_90px] gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
              <div>时间</div>
              <div>来源</div>
              <div>会话</div>
              <div>模型</div>
              <div>Token</div>
              <div>费用估算</div>
              <div>状态</div>
            </div>
            {loading ? (
              <LoadingPanel />
            ) : error ? (
              <div className="flex h-24 items-center justify-center text-sm text-destructive">{error}</div>
            ) : result?.records.length ? (
              <div className="divide-y divide-border/50">
                {result.records.map((record) => <RecordRow key={record.id} record={record} />)}
              </div>
            ) : (
              <EmptyPanel label="暂无用量记录" />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
            <span className="text-xs text-muted-foreground">第 <span className="tabular-nums">{filter.page}</span> 页</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={filter.page <= 1}
                onClick={() => setFilter((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              >
                上一页
              </Button>
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
