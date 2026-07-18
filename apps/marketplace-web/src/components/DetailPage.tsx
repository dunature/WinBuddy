import * as React from 'react'
import { useAtom } from 'jotai'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  History,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react'
import type { MarketplaceVersionSummary } from '@proma/shared'
import { getMarketplaceSkill, getMarketplaceSkillFile, MarketplaceRequestError } from '../api'
import {
  readDetailRoute,
  writeDetailRoute,
  type DetailRoute,
  type MarketplaceDetailTab,
} from '../route-state'
import { detailStateAtom, type DetailState } from '../state'
import { MarketplaceMarkdown } from './MarketplaceMarkdown'
import { SkillFileTree, formatBytes } from './SkillFileTree'

const tabs: Array<{ id: MarketplaceDetailTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'skill-md', label: 'SKILL.md' },
  { id: 'files', label: '文件' },
  { id: 'versions', label: '版本历史' },
]

function requestError(error: unknown): MarketplaceRequestError {
  return error instanceof MarketplaceRequestError
    ? error
    : new MarketplaceRequestError('技能详情暂时无法访问', 'UNKNOWN', 0)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(value))
}

function DetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-5" aria-label="正在加载技能详情">
      <div className="h-64 animate-pulse rounded-[32px] bg-white/55" />
      <div className="h-96 animate-pulse rounded-[28px] bg-white/55" />
    </div>
  )
}

function VersionHistory({
  versions,
  latestVersion,
  onSelect,
}: {
  versions: MarketplaceVersionSummary[]
  latestVersion: string
  onSelect: (version: string) => void
}): React.ReactElement {
  return (
    <div className="space-y-3">
      {versions.map((version) => {
        const current = version.version === latestVersion
        return (
          <button
            key={version.version}
            type="button"
            onClick={() => onSelect(version.version)}
            className="version-row group"
          >
            <span className={`grid size-11 flex-none place-items-center rounded-2xl ${current ? 'bg-[var(--blue)] text-white' : 'bg-[var(--ink)]/[0.06]'}`}>
              {current ? <CheckCircle2 size={18} /> : <History size={18} />}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-semibold">v{version.version}</span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
                  current ? 'bg-[var(--blue)]/10 text-[var(--blue)]' : 'bg-[var(--accent)]/10 text-[var(--accent)]'
                }`}>
                  {current ? '当前版本' : '非最新版本'}
                </span>
              </span>
              <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{version.changelog}</span>
            </span>
            <span className="hidden text-right text-xs text-[var(--muted)] sm:block">
              {formatDate(version.publishedAt)}<br />{version.fileCount} 个文件
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function DetailPage(): React.ReactElement {
  const { identifier = '' } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useAtom(detailStateAtom)
  const route = React.useMemo(() => readDetailRoute(searchParams), [searchParams])
  const catalogUrl = typeof (location.state as { catalogUrl?: unknown } | null)?.catalogUrl === 'string'
    ? (location.state as { catalogUrl: string }).catalogUrl
    : '/'

  React.useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({
      ...current,
      skill: null,
      file: null,
      loading: true,
      loadingFile: false,
      error: null,
      fileError: null,
    }))
    getMarketplaceSkill(identifier, controller.signal)
      .then((skill) => setState((current) => ({ ...current, skill, loading: false })))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, loading: false, error: requestError(error) }))
      })
    return () => controller.abort()
  }, [identifier, state.revision, setState])

  const latestVersion = state.skill?.versions.find((version) => version.version === state.skill?.latestVersion) ?? null
  const activeVersion = state.skill?.versions.find((version) => version.version === route.version) ?? latestVersion
  const activeFilePath = route.tab === 'skill-md' ? 'SKILL.md' : route.file

  React.useEffect(() => {
    if (!state.skill || !activeVersion || !activeFilePath || (route.tab !== 'skill-md' && route.tab !== 'files')) return
    const controller = new AbortController()
    setState((current) => ({ ...current, file: null, loadingFile: true, fileError: null }))
    getMarketplaceSkillFile(state.skill.identifier, activeVersion.version, activeFilePath, controller.signal)
      .then((file) => setState((current) => ({ ...current, file, loadingFile: false })))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ ...current, loadingFile: false, fileError: requestError(error) }))
      })
    return () => controller.abort()
  }, [activeFilePath, activeVersion?.version, route.tab, state.skill?.identifier, setState])

  const setRoute = React.useCallback((next: DetailRoute): void => {
    setSearchParams(writeDetailRoute(next))
  }, [setSearchParams])

  const selectTab = React.useCallback((tab: MarketplaceDetailTab): void => {
    setRoute({
      tab,
      file: tab === 'skill-md' || tab === 'files' ? route.file ?? 'SKILL.md' : null,
      version: route.version,
    })
  }, [route.file, route.version, setRoute])

  if (state.loading) {
    return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><DetailSkeleton /></div>
  }

  if (state.error?.status === 404) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-5 text-center">
        <div className="error-code">404</div>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">找不到这个技能</h1>
        <p className="mt-3 max-w-md text-sm leading-7 text-[var(--muted)]">它可能已经下架、归档，或者链接中的 identifier 不正确。</p>
        <a href="/agent/marketplace/" className="primary-link mt-7">返回技能市场 <ArrowLeft size={16} /></a>
      </div>
    )
  }

  if (state.error || !state.skill) {
    const offline = state.error?.offline === true
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-5 text-center">
        <span className="grid size-16 place-items-center rounded-3xl bg-[var(--ink)] text-[var(--paper)]">
          {offline ? <WifiOff size={26} /> : <RefreshCw size={26} />}
        </span>
        <h1 className="mt-5 font-display text-3xl font-semibold">{offline ? '详情暂时离线' : '详情加载失败'}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{state.error?.message}</p>
        <button type="button" className="primary-link mt-6" onClick={() => setState((current) => ({ ...current, revision: current.revision + 1 }))}>
          重试 <RefreshCw size={15} />
        </button>
      </div>
    )
  }

  const skill = state.skill
  const isHistorical = activeVersion?.version !== skill.latestVersion

  return (
    <div className="px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-6xl">
        <Link to={catalogUrl} className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]">
          <ArrowLeft size={16} /> 返回技能市场
        </Link>

        <section className="detail-hero">
          <div className="detail-stamp" aria-hidden="true">{[...skill.name][0]}</div>
          <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="detail-identifier">{skill.identifier}</span>
                {skill.featured && <span className="featured-mark featured-mark-light"><Sparkles size={11} /> 精选</span>}
              </div>
              <h1 className="mt-5 font-display text-[clamp(2.5rem,6vw,5.5rem)] font-semibold leading-[0.95] tracking-[-0.05em]">{skill.name}</h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-white/70">{skill.tagline}</p>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/58">
                <span>{skill.authorName}</span>
                <span>{skill.installs.toLocaleString('zh-CN')} 次使用</span>
                <span>最新 v{skill.latestVersion}</span>
                <span className="flex items-center gap-1.5 text-emerald-300"><ShieldCheck size={14} /> 已发布</span>
              </div>
            </div>
            <button type="button" disabled className="install-button">
              <PackageCheck size={17} /> 安装即将开放
            </button>
          </div>
        </section>

        {isHistorical && activeVersion && (
          <div className="historical-banner" role="status">
            <Clock3 size={18} />
            <span>正在查看历史版本 {activeVersion.version}</span>
            <button type="button" onClick={() => setRoute({ ...route, version: null })}>回到最新版</button>
          </div>
        )}

        <div className="mt-7 flex gap-1 overflow-x-auto rounded-2xl bg-[var(--ink)]/[0.055] p-1.5" role="tablist" aria-label="技能详情">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={route.tab === tab.id}
              onClick={() => selectTab(tab.id)}
              className={`detail-tab ${route.tab === tab.id ? 'detail-tab-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="detail-panel" role="tabpanel">
          {route.tab === 'overview' && latestVersion && (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_290px]">
              <div>
                <div className="section-kicker">About this skill</div>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">关于此技能</h2>
                <p className="mt-5 max-w-3xl text-[15px] leading-8 text-[var(--muted)]">{skill.description}</p>
                <h3 className="mt-9 text-sm font-bold">能力标签</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {skill.tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>)}
                </div>
              </div>
              <aside className="version-summary">
                <div className="flex items-center justify-between text-xs text-white/55"><span>当前版本</span><CheckCircle2 size={16} /></div>
                <div className="mt-4 font-display text-4xl font-semibold">v{latestVersion.version}</div>
                <p className="mt-4 text-sm leading-6 text-white/65">{latestVersion.changelog}</p>
                <dl className="mt-8 space-y-3 border-t border-white/12 pt-5 text-xs">
                  <div className="flex justify-between"><dt className="text-white/50">文件</dt><dd>{latestVersion.fileCount} 个</dd></div>
                  <div className="flex justify-between"><dt className="text-white/50">包大小</dt><dd>{formatBytes(latestVersion.size)}</dd></div>
                  <div className="flex justify-between"><dt className="text-white/50">发布时间</dt><dd>{formatDate(latestVersion.publishedAt)}</dd></div>
                </dl>
              </aside>
            </div>
          )}

          {route.tab === 'skill-md' && (
            <FilePreview state={state} />
          )}

          {route.tab === 'files' && activeVersion && (
            <div className="grid min-h-[420px] gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="file-sidebar">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-bold">v{activeVersion.version} 文件</h2>
                  <span className="text-[10px] text-[var(--muted)]">{activeVersion.fileCount} ITEMS</span>
                </div>
                <SkillFileTree
                  nodes={activeVersion.files}
                  selectedPath={activeFilePath}
                  onSelect={(path) => setRoute({ ...route, tab: 'files', file: path })}
                />
              </aside>
              <div className="min-w-0 lg:pl-2">
                <FilePreview state={state} />
              </div>
            </div>
          )}

          {route.tab === 'versions' && (
            <div>
              <div className="section-kicker">Release archive</div>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">版本历史</h2>
              <p className="mb-7 mt-3 text-sm text-[var(--muted)]">每次公开发布都有独立内容摘要与文件快照。</p>
              <VersionHistory
                versions={skill.versions}
                latestVersion={skill.latestVersion}
                onSelect={(version) => setRoute({ tab: 'files', file: 'SKILL.md', version: version === skill.latestVersion ? null : version })}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FilePreview({ state }: { state: DetailState }): React.ReactElement {
  if (state.loadingFile) return <div className="h-64 animate-pulse rounded-2xl bg-[var(--ink)]/[0.055]" />
  if (state.fileError) {
    return (
      <div className="empty-state min-h-72">
        <RefreshCw size={22} />
        <h2 className="mt-4 font-display text-xl font-semibold">文件暂不可预览</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{state.fileError.message}</p>
      </div>
    )
  }
  if (state.file?.content === undefined) {
    return (
      <div className="empty-state min-h-72">
        <PackageCheck size={22} />
        <p className="mt-3 text-sm text-[var(--muted)]">选择一个文本文件进行预览（最大 1 MB）</p>
      </div>
    )
  }
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--ink)]/10 pb-4 text-xs text-[var(--muted)]">
        <span className="font-mono">{state.file.path}</span>
        <span>{formatBytes(state.file.size)}</span>
      </div>
      <MarketplaceMarkdown content={state.file.content} />
    </div>
  )
}
