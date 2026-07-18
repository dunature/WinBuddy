import * as React from 'react'
import { useAtom } from 'jotai'
import { useNavigate, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Search, Sparkles, Store, WifiOff } from 'lucide-react'
import { marketplaceStateAtom, toMarketplaceListQuery } from '@/atoms/marketplace-atoms'
import { readMarketplaceCatalogRoute, writeMarketplaceCatalogRoute } from '@/atoms/marketplace-route'
import { cn } from '@/lib/utils'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '技能市场暂时无法访问'
}

function CatalogSkeleton(): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-48 animate-pulse rounded-2xl bg-muted/55" />
      ))}
    </div>
  )
}

export function MarketplaceCatalogPage(): React.ReactElement {
  const [state, setState] = useAtom(marketplaceStateAtom)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const route = React.useMemo(() => readMarketplaceCatalogRoute(searchParams), [searchParams])

  React.useEffect(() => {
    setState((current) => ({
      ...current,
      searchInput: route.query,
      query: route.query,
      category: route.category,
      featured: route.featured,
      sort: route.sort,
      page: route.page,
      selectedIdentifier: null,
      selectedSkill: null,
      selectedFile: null,
      selectedVersion: null,
    }))
  }, [route.category, route.featured, route.page, route.query, route.sort, setState])

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.listMarketplaceCategories()
      .then((categories) => {
        if (!cancelled) setState((current) => ({ ...current, categories }))
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((current) => ({ ...current, error: errorMessage(error) }))
      })
    return () => { cancelled = true }
  }, [setState])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = state.searchInput.trim()
      if (query !== route.query) {
        setSearchParams(writeMarketplaceCatalogRoute({ ...route, query, page: 1 }), { replace: true })
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [route, setSearchParams, state.searchInput])

  React.useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, loading: true, error: null }))
    window.electronAPI.listMarketplaceSkills(toMarketplaceListQuery({
      ...state,
      query: route.query,
      category: route.category,
      featured: route.featured,
      sort: route.sort,
      page: route.page,
    }))
      .then((result) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            skills: result.items,
            pageInfo: result.page,
            loading: false,
          }))
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: errorMessage(error) }))
      })
    return () => { cancelled = true }
  }, [route.category, route.featured, route.page, route.query, route.sort, state.pageSize, state.refreshVersion, setState])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-primary/[0.055] via-background to-background">
      <header className="border-b border-border/45 px-7 pb-5 pt-8 titlebar-no-drag">
        <div className="mx-auto max-w-[1480px]">
          <div className="mb-5 flex items-end justify-between gap-6">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                <Store size={16} /> Proma 技能市场
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">为 Agent 找到下一项能力</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">浏览社区发布的技能，并安装到当前 Agent 工作区。</p>
            </div>
            <div className="text-xs text-muted-foreground">共 {state.pageInfo.total} 项</div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="relative min-w-[260px] flex-1 md:max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <input
                value={state.searchInput}
                onChange={(event) => setState((current) => ({ ...current, searchInput: event.target.value }))}
                placeholder="搜索技能名称、标识符或用途"
                className="h-10 w-full rounded-xl bg-background/90 pl-9 pr-3 text-sm shadow-sm ring-1 ring-border/60 outline-none transition focus:ring-2 focus:ring-primary/35"
              />
            </label>
            <button
              type="button"
              onClick={() => setSearchParams(writeMarketplaceCatalogRoute({ ...route, featured: !route.featured, page: 1 }))}
              className={cn(
                'flex h-10 items-center gap-2 rounded-xl px-3 text-sm shadow-sm ring-1 transition',
                state.featured
                  ? 'bg-primary text-primary-foreground ring-primary'
                  : 'bg-background/90 text-muted-foreground ring-border/60 hover:text-foreground',
              )}
            >
              <Sparkles size={15} /> 精选
            </button>
            <select
              value={state.sort}
              onChange={(event) => setSearchParams(writeMarketplaceCatalogRoute({
                ...route,
                sort: event.target.value === 'latest' ? 'latest' : 'hot',
                page: 1,
              }))}
              className="h-10 rounded-xl bg-background/90 px-3 text-sm text-foreground shadow-sm ring-1 ring-border/60 outline-none"
            >
              <option value="hot">最受欢迎</option>
              <option value="latest">最近更新</option>
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[{ id: '', name: '全部' }, ...state.categories].map((category) => (
              <button
                key={category.id || 'all'}
                type="button"
                onClick={() => setSearchParams(writeMarketplaceCatalogRoute({ ...route, category: category.id, page: 1 }))}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition',
                  state.category === category.id
                    ? 'bg-foreground text-background'
                    : 'bg-muted/65 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-7 py-6 titlebar-no-drag">
        <div className="mx-auto max-w-[1480px]">
          {state.error && (
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <WifiOff size={17} />
              <span>{state.error}</span>
              <button
                type="button"
                className="ml-auto font-medium underline underline-offset-2"
                onClick={() => setState((current) => ({ ...current, refreshVersion: current.refreshVersion + 1 }))}
              >
                重试
              </button>
            </div>
          )}

          {state.loading ? (
            <CatalogSkeleton />
          ) : state.skills.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <div className="mb-4 rounded-2xl bg-muted p-4"><Search size={24} className="text-muted-foreground" /></div>
              <h2 className="font-medium">没有找到匹配的技能</h2>
              <p className="mt-1 text-sm text-muted-foreground">试试减少筛选条件或更换搜索词。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {state.skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => navigate(`/skills/${skill.identifier}`)}
                  className="group flex min-h-48 flex-col rounded-2xl bg-card p-5 text-left shadow-sm ring-1 ring-border/45 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold text-primary">
                      {skill.name.slice(0, 1)}
                    </div>
                    {skill.featured && <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">精选</span>}
                  </div>
                  <h2 className="mt-4 font-semibold tracking-tight group-hover:text-primary">{skill.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{skill.tagline}</p>
                  <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
                    <span>{skill.authorName}</span>
                    <span>{skill.installs.toLocaleString('zh-CN')} 次使用 · v{skill.latestVersion}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!state.loading && state.pageInfo.total > 0 && (
            <div className="mt-7 flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={state.pageInfo.number <= 1}
                onClick={() => setSearchParams(writeMarketplaceCatalogRoute({ ...route, page: Math.max(1, route.page - 1) }))}
                className="flex size-9 items-center justify-center rounded-lg bg-card shadow-sm ring-1 ring-border/50 disabled:opacity-35"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-muted-foreground">第 {state.pageInfo.number} / {state.pageInfo.pages} 页</span>
              <button
                type="button"
                disabled={state.pageInfo.number >= state.pageInfo.pages}
                onClick={() => setSearchParams(writeMarketplaceCatalogRoute({ ...route, page: Math.min(route.page + 1, state.pageInfo.pages) }))}
                className="flex size-9 items-center justify-center rounded-lg bg-card shadow-sm ring-1 ring-border/50 disabled:opacity-35"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
