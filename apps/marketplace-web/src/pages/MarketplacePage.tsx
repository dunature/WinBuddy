import * as React from 'react'
import { AlertCircle, Search, Send, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type {
  MarketplaceCategory,
  MarketplacePaginatedResponse,
  MarketplaceScope,
  MarketplaceSkillSummary,
  MarketplaceSort,
} from '@proma/shared'
import { Pagination } from '../components/Pagination.tsx'
import { SkillCard } from '../components/SkillCard.tsx'
import { MarketplaceRequestError, marketplaceApi } from '../lib/api-client.ts'

const SCOPES: Array<{ value: MarketplaceScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'official', label: '官方精选' },
  { value: 'community', label: '社区' },
]

interface MarketplacePageState {
  status: 'loading' | 'ready' | 'error'
  categories: MarketplaceCategory[]
  result?: MarketplacePaginatedResponse<MarketplaceSkillSummary>
  error?: string
}

export function MarketplacePage(): React.ReactElement {
  const [urlParams, setUrlParams] = useSearchParams()
  const [searchInput, setSearchInput] = React.useState(urlParams.get('query') ?? '')
  const [retryKey, setRetryKey] = React.useState(0)
  const [state, setState] = React.useState<MarketplacePageState>({ status: 'loading', categories: [] })

  const scope = parseScope(urlParams.get('scope'))
  const category = urlParams.get('category') ?? ''
  const sort = parseSort(urlParams.get('sort'))
  const page = Math.max(1, Number(urlParams.get('page')) || 1)
  const query = urlParams.get('query') ?? ''

  React.useEffect(() => setSearchInput(query), [query])

  React.useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ ...previous, status: 'loading', error: undefined }))
    Promise.all([
      marketplaceApi.listCategories(controller.signal),
      marketplaceApi.listSkills({ query: query || undefined, scope, category: category || undefined, sort, page, pageSize: 12 }, controller.signal),
    ]).then(([categories, result]) => {
      setState({ status: 'ready', categories, result })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState((previous) => ({
        ...previous,
        status: 'error',
        error: error instanceof MarketplaceRequestError ? error.message : '加载技能市场失败',
      }))
    })
    return () => controller.abort()
  }, [category, page, query, retryKey, scope, sort])

  const updateParams = (updates: Record<string, string | undefined>, replace = false): void => {
    const next = new URLSearchParams(urlParams)
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === 'all' || value === 'popular' || value === '1') next.delete(key)
      else next.set(key, value)
    }
    setUrlParams(next, { replace })
  }

  const submitSearch = (event: React.FormEvent): void => {
    event.preventDefault()
    updateParams({ query: searchInput.trim() || undefined, page: undefined })
  }

  const clearFilters = (): void => {
    setSearchInput('')
    setUrlParams({})
  }

  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-16 pt-16 sm:px-8 lg:px-16 lg:pt-20">
      <header className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">Proma Skill Marketplace</p>
        <h1 className="mx-auto mt-5 max-w-3xl text-balance text-5xl font-medium tracking-[-0.045em] sm:text-6xl">释放你的 Agent 潜能</h1>
        <p className="mx-auto mt-5 max-w-2xl font-serif text-lg leading-8 text-muted">浏览经过社区验证的 Skills，让 Proma 快速获得专业能力。</p>
        <form className="relative mx-auto mt-10 max-w-2xl" role="search" onSubmit={submitSearch}>
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={19} aria-hidden="true" />
          <input className="h-14 w-full rounded-xl border border-line bg-panel pl-12 pr-28 text-base shadow-card outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索 Skills、作者或能力…" aria-label="搜索市场 Skills" />
          <button className="absolute right-2 top-2 h-10 rounded-lg bg-ink px-4 text-sm font-medium text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" type="submit">搜索</button>
        </form>
      </header>

      <div className="mt-12 flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 border-b border-line sm:flex-row sm:items-end">
          <div className="flex gap-6" role="tablist" aria-label="Skill 来源">
            {SCOPES.map((item) => <button key={item.value} className={item.value === scope ? 'scope-tab scope-tab-active' : 'scope-tab'} type="button" role="tab" aria-selected={item.value === scope} onClick={() => updateParams({ scope: item.value, page: undefined })}>{item.label}</button>)}
          </div>
          <label className="mb-2 flex items-center gap-2 text-sm text-muted">
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="sr-only">排序</span>
            <select className="rounded-lg bg-transparent py-2 pl-1 pr-2 text-ink outline-none focus:ring-2 focus:ring-accent" value={sort} onChange={(event) => updateParams({ sort: event.target.value, page: undefined })}>
              <option value="popular">最热</option>
              <option value="recent">最近更新</option>
            </select>
          </label>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Skill 分类">
          <button className={!category ? 'category-chip category-chip-active' : 'category-chip'} type="button" onClick={() => updateParams({ category: undefined, page: undefined })}>全部分类</button>
          {state.categories.map((item) => <button key={item.slug} className={item.slug === category ? 'category-chip category-chip-active' : 'category-chip'} type="button" onClick={() => updateParams({ category: item.slug, page: undefined })}>{item.name}</button>)}
        </div>
      </div>

      {state.status === 'loading' && <SkillGridSkeleton />}
      {state.status === 'error' && (
        <div className="market-state">
          <AlertCircle className="text-accent" size={24} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">暂时无法加载技能市场</h2>
          <p className="mt-2 text-muted">{state.error}</p>
          <button className="market-action" type="button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button>
        </div>
      )}
      {state.status === 'ready' && state.result?.items.length === 0 && (
        <div className="market-state">
          <Search className="text-muted" size={24} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">没有找到匹配的 Skill</h2>
          <p className="mt-2 text-muted">试试更短的关键词，或清除当前筛选。</p>
          <button className="market-action" type="button" onClick={clearFilters}>清除筛选</button>
        </div>
      )}
      {state.status === 'ready' && state.result && state.result.items.length > 0 && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {state.result.items.map((skill) => <SkillCard key={skill.id} skill={skill} />)}
          </div>
          <Pagination page={state.result.page} totalPages={state.result.totalPages} onChange={(nextPage) => updateParams({ page: String(nextPage) })} />
        </>
      )}

      <aside className="mt-12 flex flex-col items-start justify-between gap-5 rounded-xl bg-[#fff0e9] px-6 py-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold">把你的经验变成 Skill</h2>
          <p className="mt-1 text-sm text-muted">创建、分享，帮助更多人提升 Agent 能力。</p>
        </div>
        <a className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-5 text-sm font-medium text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" href="https://github.com/dunature/WinBuddy/issues/new"><Send size={15} />提交到社区</a>
      </aside>
    </section>
  )
}

function parseScope(value: string | null): MarketplaceScope {
  return value === 'official' || value === 'community' ? value : 'all'
}

function parseSort(value: string | null): MarketplaceSort {
  return value === 'recent' ? 'recent' : 'popular'
}

function SkillGridSkeleton(): React.ReactElement {
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="正在加载 Skills">
      {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-panel shadow-card" />)}
    </div>
  )
}
