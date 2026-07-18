import * as React from 'react'
import { useAtom } from 'jotai'
import { ArrowLeft, File, Folder, ShieldCheck, Star } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { MarketplaceFileNode } from '@proma/shared'
import { marketplaceStateAtom } from '@/atoms/marketplace-atoms'
import {
  createMarketplaceMemoryEntries,
  readMarketplaceDetailRoute,
  writeMarketplaceDetailRoute,
  type MarketplaceDetailTab,
} from '@/atoms/marketplace-route'
import { cn } from '@/lib/utils'
import { MarketplaceMarkdown } from './MarketplaceMarkdown'
import { MarketplaceVersionHistory } from './MarketplaceVersionHistory'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '技能详情暂时无法访问'
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  return `${(size / 1024).toFixed(1)} KB`
}

interface FileTreeProps {
  nodes: MarketplaceFileNode[]
  onOpen: (path: string) => void
}

function FileTree({ nodes, onOpen }: FileTreeProps): React.ReactElement {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div key={node.path}>
          {node.type === 'directory' ? (
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/65">
                <Folder size={15} className="text-amber-500" /> {node.name}
              </summary>
              <div className="ml-4 border-l border-border/60 pl-2">
                <FileTree nodes={node.children ?? []} onOpen={onOpen} />
              </div>
            </details>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(node.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/65"
            >
              <File size={15} className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="text-[11px] text-muted-foreground">{formatBytes(node.size)}</span>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const tabs: Array<{ id: MarketplaceDetailTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'skill-md', label: 'SKILL.md' },
  { id: 'files', label: '文件' },
  { id: 'versions', label: '版本历史' },
]

export function MarketplaceSkillDetailPage(): React.ReactElement {
  const { identifier = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useAtom(marketplaceStateAtom)
  const route = React.useMemo(() => readMarketplaceDetailRoute(searchParams), [searchParams])
  const detail = state.selectedIdentifier === identifier ? state.selectedSkill : null
  const latest = detail?.versions.find((version) => version.version === detail.latestVersion)
  const activeVersion = detail?.versions.find((version) => version.version === (route.version ?? detail.latestVersion)) ?? latest
  const catalogEntry = createMarketplaceMemoryEntries({
    query: state.query,
    category: state.category,
    featured: state.featured,
    sort: state.sort,
    page: state.page,
  })[0]

  React.useEffect(() => {
    let cancelled = false
    setState((current) => ({
      ...current,
      selectedIdentifier: identifier,
      selectedSkill: null,
      selectedFile: null,
      selectedTab: route.tab,
      selectedVersion: route.version,
      detailLoading: true,
      detailError: null,
    }))
    window.electronAPI.getMarketplaceSkill(identifier)
      .then((skill) => {
        if (!cancelled) setState((current) => ({ ...current, selectedSkill: skill, detailLoading: false }))
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((current) => ({ ...current, detailLoading: false, detailError: errorMessage(error) }))
      })
    return () => { cancelled = true }
  }, [identifier, setState])

  const openFile = React.useCallback((path: string, version: string) => {
    if (!detail) return
    setState((current) => ({ ...current, detailLoading: true, detailError: null }))
    window.electronAPI.getMarketplaceSkillFile(detail.identifier, version, path)
      .then((file) => setState((current) => ({ ...current, selectedFile: file, detailLoading: false })))
      .catch((error: unknown) => setState((current) => ({ ...current, detailLoading: false, detailError: errorMessage(error) })))
  }, [detail, setState])

  React.useEffect(() => {
    if (!detail || !activeVersion) return
    const shouldLoadFile = route.tab === 'skill-md' || route.tab === 'files'
    setState((current) => ({
      ...current,
      selectedTab: route.tab,
      selectedVersion: activeVersion.version,
      selectedFile: null,
    }))
    if (shouldLoadFile && route.file) {
      openFile(route.file, activeVersion.version)
    }
  }, [activeVersion, detail, openFile, route.file, route.tab, setState])

  const selectTab = React.useCallback((tab: MarketplaceDetailTab) => {
    setSearchParams(writeMarketplaceDetailRoute({
      tab,
      file: tab === 'skill-md' || tab === 'files' ? route.file ?? 'SKILL.md' : null,
      version: route.version,
    }))
  }, [route.file, route.version, setSearchParams])

  const selectFile = React.useCallback((path: string) => {
    setSearchParams(writeMarketplaceDetailRoute({ ...route, tab: 'files', file: path }))
  }, [route, setSearchParams])

  const selectVersion = React.useCallback((version: string) => {
    setSearchParams(writeMarketplaceDetailRoute({
      tab: 'files',
      file: 'SKILL.md',
      version: version === detail?.latestVersion ? null : version,
    }))
  }, [detail?.latestVersion, setSearchParams])

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-primary/[0.045] via-background to-background titlebar-no-drag">
      <div className="mx-auto max-w-6xl px-7 pb-12 pt-7">
        <button type="button" onClick={() => navigate(catalogEntry)} className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> 返回技能市场
        </button>

        {state.detailError && (
          <div className="mb-5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{state.detailError}</div>
        )}

        {state.detailLoading && !detail ? (
          <div className="h-72 animate-pulse rounded-3xl bg-muted/55" />
        ) : detail ? (
          <>
            <section className="rounded-3xl bg-card p-7 shadow-lg shadow-black/[0.035] ring-1 ring-border/45">
              <div className="flex flex-col gap-5 md:flex-row md:items-start">
                <div className="flex size-16 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-semibold text-primary">
                  {detail.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
                    {detail.featured && <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"><Star size={12} /> 精选</span>}
                  </div>
                  <p className="mt-2 text-muted-foreground">{detail.tagline}</p>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <span>{detail.authorName}</span>
                    <span>{detail.installs.toLocaleString('zh-CN')} 次使用</span>
                    <span>最新版本 v{detail.latestVersion}</span>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ShieldCheck size={13} /> 已发布</span>
                  </div>
                </div>
                <button type="button" disabled className="rounded-xl bg-muted px-5 py-2.5 text-sm font-medium text-muted-foreground opacity-70">
                  安装即将开放
                </button>
              </div>
            </section>

            <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl bg-muted/45 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-medium transition',
                    route.tab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <section className="mt-4 min-h-[360px] rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border/45">
              {route.tab === 'overview' && (
                <div className="grid gap-7 md:grid-cols-[1fr_260px]">
                  <div>
                    <h2 className="font-semibold">关于此技能</h2>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{detail.description}</p>
                    <h3 className="mt-7 text-sm font-semibold">标签</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {detail.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{tag}</span>)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-muted/45 p-4 text-sm">
                    <div className="font-medium">当前版本</div>
                    <div className="mt-2 text-2xl font-semibold">v{detail.latestVersion}</div>
                    <div className="mt-3 text-xs leading-5 text-muted-foreground">{latest?.changelog}</div>
                    <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">{latest?.fileCount ?? 0} 个文件 · {formatBytes(latest?.size ?? 0)}</div>
                  </div>
                </div>
              )}

              {route.tab === 'skill-md' && (
                state.detailLoading && !state.selectedFile ? (
                  <div className="h-48 animate-pulse rounded-xl bg-muted/55" />
                ) : state.selectedFile?.content ? (
                  <MarketplaceMarkdown content={state.selectedFile.content} />
                ) : (
                  <div className="text-sm text-muted-foreground">SKILL.md 暂不可预览。</div>
                )
              )}

              {route.tab === 'files' && activeVersion && (
                <div className="grid min-h-[320px] gap-5 md:grid-cols-[280px_1fr]">
                  <div className="border-r border-border/55 pr-4">
                    <h2 className="mb-3 text-sm font-semibold">v{activeVersion.version} 文件</h2>
                    <FileTree nodes={activeVersion.files} onOpen={selectFile} />
                  </div>
                  <div className="min-w-0">
                    {state.selectedFile?.content ? (
                      <>
                        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{state.selectedFile.path}</span><span>{formatBytes(state.selectedFile.size)}</span>
                        </div>
                        <MarketplaceMarkdown content={state.selectedFile.content} />
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个文本文件进行预览（最大 1 MB）</div>
                    )}
                  </div>
                </div>
              )}

              {route.tab === 'versions' && (
                <MarketplaceVersionHistory
                  versions={detail.versions}
                  latestVersion={detail.latestVersion}
                  onSelect={selectVersion}
                />
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
