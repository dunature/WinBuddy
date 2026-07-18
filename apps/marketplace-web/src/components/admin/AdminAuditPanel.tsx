import * as React from 'react'
import { useAtom } from 'jotai'
import { ChevronLeft, ChevronRight, FileClock, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { MarketplaceAdminAuditQuery, MarketplaceAdminSkillSummary } from '@proma/shared'
import { listAdminAuditEntries } from '../../admin-api'
import { adminAuditQueryAtom, adminAuditStateAtom } from '../../admin-audit-state'

interface AdminAuditPanelProps {
  skills: MarketplaceAdminSkillSummary[]
}

function stateText(value: unknown): string {
  return value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)
}

const filterClass = 'h-12 min-w-0 rounded-2xl bg-white/70 px-4 text-sm text-[var(--ink)] shadow-[inset_0_0_0_1px_rgba(16,35,61,0.11)] outline-none focus:bg-white focus:shadow-[inset_0_0_0_2px_rgba(30,85,199,0.4)]'
type AuditTextFilter = 'skillId' | 'actor' | 'action' | 'from' | 'to'

export function AdminAuditPanel({ skills }: AdminAuditPanelProps): React.ReactElement {
  const [query, setQuery] = useAtom(adminAuditQueryAtom)
  const [state, setState] = useAtom(adminAuditStateAtom)

  const load = React.useCallback(async (next: MarketplaceAdminAuditQuery): Promise<void> => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const result = await listAdminAuditEntries(next)
      setState({ status: 'ready', result, error: null })
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : '审计日志加载失败',
      }))
    }
  }, [setState])

  React.useEffect(() => {
    if (state.status === 'idle') void load(query)
  }, [load, query, state.status])

  const update = (key: AuditTextFilter, value: string): void => {
    setQuery((current) => ({ ...current, [key]: value }))
  }
  const apply = (): void => {
    const next = { ...query, page: 1 }
    setQuery(next)
    void load(next)
  }
  const movePage = (page: number): void => {
    const next = { ...query, page }
    setQuery(next)
    void load(next)
  }
  const result = state.result

  return (
    <section className="mb-8 rounded-[28px] bg-[#e8e3d7] p-5 text-[var(--ink)] shadow-[0_28px_80px_rgba(0,0,0,0.18)] sm:p-8" aria-label="审计日志">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Governance ledger</div><h2 className="mt-2 font-display text-3xl font-semibold">审计日志</h2></div>
        {state.status === 'loading' && <span className="flex items-center gap-2 text-xs text-[var(--muted)]"><LoaderCircle className="animate-spin" size={14} /> 正在查询</span>}
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <select aria-label="按 Skill 筛选审计" value={query.skillId} onChange={(event) => update('skillId', event.target.value)} className={filterClass}>
          <option value="">全部 Skill</option>
          {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
        </select>
        <input aria-label="按管理员筛选审计" value={query.actor} onChange={(event) => update('actor', event.target.value)} placeholder="管理员标识" className={filterClass} />
        <input aria-label="按动作筛选审计" value={query.action} onChange={(event) => update('action', event.target.value)} placeholder="动作，如 skill.updated" className={filterClass} />
        <input aria-label="审计起始时间" value={query.from} onChange={(event) => update('from', event.target.value)} placeholder="起点 ISO（包含）" className={filterClass} />
        <input aria-label="审计结束时间" value={query.to} onChange={(event) => update('to', event.target.value)} placeholder="终点 ISO（不包含）" className={filterClass} />
      </div>
      <button type="button" onClick={apply} disabled={state.status === 'loading'} className="admin-primary-button mt-4"><Search size={15} /> 查询审计</button>

      {state.error && (
        <div role="alert" className="mt-5 rounded-2xl bg-red-100 px-4 py-3 text-sm text-red-800">
          {state.error}
          <button type="button" onClick={() => { void load(query) }} className="ml-3 inline-flex items-center gap-1 font-bold"><RefreshCw size={14} /> 重试</button>
        </div>
      )}
      {state.status === 'ready' && result?.items.length === 0 && (
        <div className="mt-6 rounded-2xl bg-white/45 px-5 py-12 text-center text-sm text-[var(--muted)]"><FileClock className="mx-auto mb-3" size={24} />当前筛选下没有审计记录</div>
      )}
      {result && result.items.length > 0 && (
        <div className="mt-6 space-y-3">
          {result.items.map((entry) => (
            <article key={entry.id} className="rounded-2xl bg-white/55 p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <strong className="font-mono text-emerald-800">{entry.action}</strong>
                <span>{new Date(entry.createdAt).toLocaleString('zh-CN')}</span>
                <span>actor: {entry.actorIdentifier ?? '系统'}</span>
                {entry.skillId && <span>Skill: {entry.skillIdentifier ?? entry.skillId}</span>}
                {entry.versionId && <span>版本: {entry.version ?? entry.versionId}</span>}
              </div>
              <p className="mt-2 text-sm">{entry.reason ?? '未记录原因'}</p>
              <div className="mt-2 font-mono text-[10px] text-[var(--muted)]">request ID: {entry.requestId}</div>
              <details className="mt-3 text-xs"><summary className="cursor-pointer font-bold">查看前后状态</summary><div className="mt-2 grid gap-3 md:grid-cols-2"><pre className="overflow-auto rounded-xl bg-[#10233d] p-3 text-white/75">{stateText(entry.beforeState)}</pre><pre className="overflow-auto rounded-xl bg-[#10233d] p-3 text-white/75">{stateText(entry.afterState)}</pre></div></details>
            </article>
          ))}
        </div>
      )}
      {result && (
        <div className="mt-5 flex items-center justify-between text-xs text-[var(--muted)]">
          <span>共 {result.page.total} 条 · 第 {result.page.number}/{result.page.pages} 页</span>
          <div className="flex gap-2"><button type="button" aria-label="上一页审计" disabled={result.page.number <= 1 || state.status === 'loading'} onClick={() => movePage(result.page.number - 1)} className="admin-secondary-button"><ChevronLeft size={14} /> 上一页</button><button type="button" aria-label="下一页审计" disabled={result.page.number >= result.page.pages || state.status === 'loading'} onClick={() => movePage(result.page.number + 1)} className="admin-secondary-button">下一页 <ChevronRight size={14} /></button></div>
        </div>
      )}
    </section>
  )
}
