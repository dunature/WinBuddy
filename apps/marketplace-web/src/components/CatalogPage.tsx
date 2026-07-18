import * as React from 'react'
import { useAtom } from 'jotai'
import { Link, useLocation, useSearchParams } from 'react-router'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  RefreshCw,
  Search,
  Sparkles,
  WifiOff,
} from 'lucide-react'
import type { MarketplaceListQuery } from '@proma/shared'
import {
  listMarketplaceCategories,
  listMarketplaceSkills,
  MarketplaceRequestError,
} from '../api'
import { readCatalogRoute, writeCatalogRoute, type CatalogRoute } from '../route-state'
import { catalogStateAtom } from '../state'

function requestError(error: unknown): MarketplaceRequestError {
  return error instanceof MarketplaceRequestError
    ? error
    : new MarketplaceRequestError('技能市场暂时无法访问', 'UNKNOWN', 0)
}

function CatalogSkeleton(): React.ReactElement {
  return (
    <div className="catalog-grid" aria-label="正在加载技能">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-[250px] animate-pulse rounded-[26px] bg-white/55 shadow-sm" />
      ))}
    </div>
  )
}

function skillInitial(name: string): string {
  return [...name][0] ?? '技'
}

function updateRoute(
  route: CatalogRoute,
  patch: Partial<CatalogRoute>,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
): void {
  setSearchParams(writeCatalogRoute({ ...route, ...patch }))
}

export function CatalogPage(): React.ReactElement {
  const [state, setState] = useAtom(catalogStateAtom)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const route = React.useMemo(() => readCatalogRoute(searchParams), [searchParams])

  React.useEffect(() => {
    setState((current) => current.searchInput === route.query
      ? current
      : { ...current, searchInput: route.query })
  }, [route.query, setState])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = state.searchInput.trim()
      if (query !== route.query) updateRoute(route, { query, page: 1 }, setSearchParams)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [route, setSearchParams, state.searchInput])

  React.useEffect(() => {
    const controller = new AbortController()
    const query: MarketplaceListQuery = {
      ...(route.query ? { query: route.query } : {}),
      ...(route.category ? { category: route.category } : {}),
      ...(route.featured ? { featured: true } : {}),
      sort: route.sort,
      page: route.page,
      pageSize: 16,
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    Promise.all([
      state.categories.length > 0
        ? Promise.resolve(state.categories)
        : listMarketplaceCategories(controller.signal),
      listMarketplaceSkills(query, controller.signal),
    ])
      .then(([categories, result]) => {
        setState((current) => ({
          ...current,
          categories,
          skills: result.items,
          page: result.page,
          loading: false,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, loading: false, error: requestError(error) }))
      })
    return () => controller.abort()
  }, [route.category, route.featured, route.page, route.query, route.sort, state.revision, setState])

  return (
    <>
      <section className="relative overflow-hidden px-5 pb-10 pt-14 sm:px-8 sm:pb-14 sm:pt-20">
        <div className="hero-orbit hero-orbit-one" aria-hidden="true" />
        <div className="hero-orbit hero-orbit-two" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1480px]">
          <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="max-w-4xl">
              <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                <span className="h-px w-9 bg-[var(--accent)]" /> 经发布验证的 Agent 能力
              </div>
              <h1 aria-label="把可信能力，装进每一次工作" className="font-display text-[clamp(2.75rem,6vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.055em]">
                把可信能力，<br />装进每一次工作
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                浏览 Proma 社区公开发布的技能。先读清楚方法、文件和版本，再决定让 Agent 获得什么能力。
              </p>
            </div>
            <div className="relative hidden min-h-52 lg:block">
              <div className="archive-card archive-card-back">VERSION / TRACE / TRUST</div>
              <div className="archive-card archive-card-front">
                <Compass size={30} strokeWidth={1.5} />
                <span className="mt-auto font-display text-2xl font-semibold">能力档案</span>
                <span className="text-xs text-white/65">公开 · 可读 · 可追溯</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-5 pb-20 sm:px-8">
        <div className="mx-auto max-w-[1480px]">
          <div className="filter-panel">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">搜索技能</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={19} />
                <input
                  type="search"
                  aria-label="搜索技能"
                  value={state.searchInput}
                  onChange={(event) => setState((current) => ({ ...current, searchInput: event.target.value }))}
                  placeholder="搜索名称、identifier 或用途"
                  className="h-12 w-full rounded-2xl bg-white/75 pl-12 pr-4 text-sm outline-none ring-1 ring-[color:var(--ink)]/10 transition placeholder:text-[var(--muted)]/70 focus:bg-white focus:ring-2 focus:ring-[var(--blue)]/35"
                />
              </label>
              <button
                type="button"
                aria-pressed={route.featured}
                onClick={() => updateRoute(route, { featured: !route.featured, page: 1 }, setSearchParams)}
                className={`filter-button ${route.featured ? 'filter-button-active' : ''}`}
              >
                <Sparkles size={16} /> 精选
              </button>
              <label className="relative">
                <span className="sr-only">技能排序</span>
                <select
                  aria-label="技能排序"
                  value={route.sort}
                  onChange={(event) => updateRoute(route, {
                    sort: event.target.value === 'latest' ? 'latest' : 'hot',
                    page: 1,
                  }, setSearchParams)}
                  className="h-12 min-w-36 appearance-none rounded-2xl bg-white/75 px-4 pr-9 text-sm font-medium outline-none ring-1 ring-[color:var(--ink)]/10 focus:ring-2 focus:ring-[var(--blue)]/35"
                >
                  <option value="hot">最受欢迎</option>
                  <option value="latest">最近更新</option>
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs">↓</span>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {[{ id: '', name: '全部' }, ...state.categories].map((category) => (
                <button
                  key={category.id || 'all'}
                  type="button"
                  onClick={() => updateRoute(route, { category: category.id, page: 1 }, setSearchParams)}
                  className={`category-chip ${route.category === category.id ? 'category-chip-active' : ''}`}
                >
                  {category.name}
                </button>
              ))}
              <span className="ml-auto hidden text-xs tabular-nums text-[var(--muted)] sm:inline">
                {state.page.total} 项公开技能
              </span>
            </div>
          </div>

          {state.error && (
            <div className={`status-banner ${state.error.offline ? 'status-banner-offline' : 'status-banner-error'}`} role="alert">
              {state.error.offline ? <WifiOff size={19} /> : <RefreshCw size={19} />}
              <div>
                <div className="font-semibold">{state.error.offline ? '当前处于离线状态' : '目录加载失败'}</div>
                <div className="mt-0.5 text-xs opacity-75">{state.error.message}</div>
              </div>
              <button
                type="button"
                onClick={() => setState((current) => ({ ...current, revision: current.revision + 1 }))}
                className="ml-auto rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold"
              >
                重试
              </button>
            </div>
          )}

          <div className="mt-7">
            {state.loading ? (
              <CatalogSkeleton />
            ) : state.skills.length === 0 ? (
              <div className="empty-state">
                <span className="grid size-14 place-items-center rounded-2xl bg-[var(--ink)] text-[var(--paper)]"><Search size={23} /></span>
                <h2 className="mt-5 font-display text-2xl font-semibold">没有找到匹配的技能</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">减少筛选条件，或换一个更短的关键词试试。</p>
                <button
                  type="button"
                  className="mt-5 text-sm font-semibold text-[var(--blue)] underline underline-offset-4"
                  onClick={() => setSearchParams(new URLSearchParams())}
                >
                  清除全部筛选
                </button>
              </div>
            ) : (
              <div className="catalog-grid">
                {state.skills.map((skill, index) => (
                  <Link
                    key={skill.id}
                    to={`/skills/${encodeURIComponent(skill.identifier)}`}
                    state={{ catalogUrl: `${location.pathname}${location.search}` }}
                    aria-label={`${skill.name}，${skill.tagline}`}
                    className="skill-card group"
                    style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="skill-monogram">{skillInitial(skill.name)}</span>
                      <span className="flex items-center gap-1.5">
                        {skill.featured && <span className="featured-mark">精选</span>}
                        <ArrowRight className="text-[var(--muted)] transition-transform group-hover:translate-x-1" size={17} />
                      </span>
                    </div>
                    <div className="mt-7">
                      <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-[var(--accent)]">{skill.identifier}</div>
                      <h2 className="mt-2 font-display text-[23px] font-semibold leading-tight tracking-[-0.025em]">{skill.name}</h2>
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{skill.tagline}</p>
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-3 pt-8 text-[11px] text-[var(--muted)]">
                      <span>{skill.authorName}</span>
                      <span className="text-right tabular-nums">{skill.installs.toLocaleString('zh-CN')} 次使用<br />v{skill.latestVersion}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {!state.loading && state.page.total > 0 && (
            <nav className="mt-10 flex items-center justify-center gap-4" aria-label="目录分页">
              <button
                type="button"
                aria-label="上一页"
                disabled={state.page.number <= 1}
                onClick={() => updateRoute(route, { page: Math.max(1, route.page - 1) }, setSearchParams)}
                className="page-button"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-24 text-center text-xs font-semibold tabular-nums text-[var(--muted)]">
                第 {state.page.number} / {state.page.pages} 页
              </span>
              <button
                type="button"
                aria-label="下一页"
                disabled={state.page.number >= state.page.pages}
                onClick={() => updateRoute(route, { page: Math.min(route.page + 1, state.page.pages) }, setSearchParams)}
                className="page-button"
              >
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
        </div>
      </section>
    </>
  )
}
