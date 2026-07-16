import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Blocks, CheckCircle2, ChevronRight, File, Folder, Loader2, Search, Store, Wrench } from 'lucide-react'
import { formatMarketplaceLog, type MarketplaceCategory, type MarketplaceExample, type MarketplaceFileContent, type MarketplaceFileNode, type MarketplaceSkillDetail, type MarketplaceSkillSummary } from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  marketplaceCategoryAtom,
  marketplaceAvailableUpdatesAtom,
  marketplaceDetailTabAtom,
  marketplaceQueryAtom,
  marketplacePendingInstallSlugAtom,
  marketplaceScopeAtom,
  marketplaceSelectedExampleAtom,
  marketplaceSelectedFileAtom,
  marketplaceSelectedSlugAtom,
  marketplaceSortAtom,
} from '@/atoms/marketplace'
import { ElectronMarketplaceApi } from '@/lib/marketplace-api'
import { MarketplaceInstallDialog } from './MarketplaceInstallDialog'

interface MarketplaceBrowserProps {
  apiUrl?: string
  workspaceSlug: string
  installEnabled: boolean
  communityEnabled: boolean
  onBack: () => void
}

export function MarketplaceBrowser({ apiUrl, workspaceSlug, installEnabled, communityEnabled, onBack }: MarketplaceBrowserProps): React.ReactElement {
  const api = React.useMemo(() => new ElectronMarketplaceApi(apiUrl), [apiUrl])
  const [selectedSlug, setSelectedSlug] = useAtom(marketplaceSelectedSlugAtom)
  const setUpdates = useSetAtom(marketplaceAvailableUpdatesAtom)

  React.useEffect(() => {
    let active = true
    if (!installEnabled) return
    window.electronAPI.checkMarketplaceUpdates({ workspaceSlug }).then((updates) => { if (active) setUpdates(updates) }).catch(() => console.warn(formatMarketplaceLog('更新检查失败', { errorCode: 'UPDATE_CHECK_FAILED', result: 'failed' })))
    return () => { active = false }
  }, [installEnabled, setUpdates, workspaceSlug])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center gap-3 px-8 pt-14 pb-5">
        <button type="button" onClick={selectedSlug ? () => setSelectedSlug(null) : onBack} className="grid size-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={selectedSlug ? '返回市场列表' : '返回本地 Skills'}>
          <ArrowLeft size={18} />
        </button>
        <div className="grid size-10 place-items-center rounded-xl bg-orange-500/10 text-orange-600"><Store size={20} /></div>
        <div><h1 className="text-2xl font-semibold">社区市场</h1><p className="mt-0.5 text-xs text-muted-foreground">浏览经过审核的 Proma Skills</p></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {selectedSlug
          ? <MarketplaceDetail api={api} slug={selectedSlug} installEnabled={installEnabled} />
          : <MarketplaceList api={api} communityEnabled={communityEnabled} onSelect={setSelectedSlug} />}
      </div>
      {installEnabled && <MarketplaceInstallDialog api={api} workspaceSlug={workspaceSlug} />}
    </div>
  )
}

function MarketplaceList({ api, communityEnabled, onSelect }: { api: ElectronMarketplaceApi; communityEnabled: boolean; onSelect: (slug: string) => void }): React.ReactElement {
  const [query, setQuery] = useAtom(marketplaceQueryAtom)
  const [scope, setScope] = useAtom(marketplaceScopeAtom)
  const [category, setCategory] = useAtom(marketplaceCategoryAtom)
  const [sort, setSort] = useAtom(marketplaceSortAtom)
  const updates = useAtomValue(marketplaceAvailableUpdatesAtom)
  const [categories, setCategories] = React.useState<MarketplaceCategory[]>([])
  const [skills, setSkills] = React.useState<MarketplaceSkillSummary[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const deferredQuery = React.useDeferredValue(query.trim())

  React.useEffect(() => {
    if (!communityEnabled && scope !== 'official') setScope('official')
  }, [communityEnabled, scope, setScope])

  React.useEffect(() => {
    const controller = new AbortController()
    api.listCategories(controller.signal).then(setCategories).catch(() => undefined)
    return () => controller.abort()
  }, [api])

  React.useEffect(() => {
    const controller = new AbortController()
    setSkills(null)
    setError(null)
    api.listSkills({ query: deferredQuery || undefined, scope, category, sort, pageSize: 24 }, controller.signal)
      .then((result) => setSkills(result.items))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '市场加载失败')
      })
    return () => controller.abort()
  }, [api, category, deferredQuery, scope, sort])

  return (
    <div className="mx-auto w-full max-w-6xl px-8 pb-10">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-64 flex-1 items-center gap-2 rounded-xl bg-muted px-3 focus-within:ring-2 focus-within:ring-primary/30"><Search size={15} className="text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder="搜索 Skills、用途或作者..." /></label>
        {communityEnabled && <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="h-9 rounded-xl border border-border bg-background px-3 text-sm"><option value="all">全部来源</option><option value="official">官方</option><option value="community">社区</option></select>}
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-xl border border-border bg-background px-3 text-sm"><option value="popular">最受欢迎</option><option value="recent">最近更新</option></select>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <FilterButton active={!category} onClick={() => setCategory(undefined)}>全部</FilterButton>
        {categories.map((item) => <FilterButton key={item.slug} active={category === item.slug} onClick={() => setCategory(item.slug)}>{item.name}</FilterButton>)}
      </div>
      {error ? <MarketplaceState icon={<Store />} title="无法连接社区市场" description={`${error}。本地 Skills 不受影响。`} />
        : !skills ? <MarketplaceState icon={<Loader2 className="animate-spin" />} title="正在加载" description="正在获取最新的已发布 Skills。" />
          : skills.length === 0 ? <MarketplaceState icon={<Search />} title="没有找到匹配的 Skill" description="请尝试减少筛选条件或更换关键词。" />
            : <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{skills.map((skill) => <SkillMarketCard key={skill.id} skill={skill} hasUpdate={updates.some((update) => update.slug === skill.slug)} onClick={() => onSelect(skill.slug)} />)}</div>}
    </div>
  )
}

function FilterButton({ active, onClick, children }: React.PropsWithChildren<{ active: boolean; onClick: () => void }>): React.ReactElement {
  return <button type="button" onClick={onClick} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs transition', active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground')}>{children}</button>
}

function SkillMarketCard({ skill, hasUpdate, onClick }: { skill: MarketplaceSkillSummary; hasUpdate: boolean; onClick: () => void }): React.ReactElement {
  return <button type="button" onClick={onClick} className="group rounded-2xl bg-card p-5 text-left shadow-sm ring-1 ring-border/50 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><div className="flex items-start justify-between gap-3"><div className="grid size-11 place-items-center rounded-xl bg-orange-500/10 text-orange-600"><Blocks size={21} /></div><div className="flex gap-1">{hasUpdate && <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-700">可更新</span>}{skill.author.official && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700">官方</span>}</div></div><h2 className="mt-4 font-semibold">{skill.displayName}</h2><p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{skill.description}</p><div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground"><span>@{skill.author.handle} · v{skill.version}</span><span>{skill.installCount.toLocaleString()} 次安装</span></div></button>
}

function MarketplaceDetail({ api, slug, installEnabled }: { api: ElectronMarketplaceApi; slug: string; installEnabled: boolean }): React.ReactElement {
  const [detail, setDetail] = React.useState<MarketplaceSkillDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = useAtom(marketplaceDetailTabAtom)
  const setPendingInstall = useSetAtom(marketplacePendingInstallSlugAtom)
  const update = useAtomValue(marketplaceAvailableUpdatesAtom).find((item) => item.slug === slug)

  React.useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    api.getSkill(slug, controller.signal).then(setDetail).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '详情加载失败')
    })
    return () => controller.abort()
  }, [api, slug])

  if (error) return <MarketplaceState icon={<Store />} title="无法加载 Skill" description={error} />
  if (!detail) return <MarketplaceState icon={<Loader2 className="animate-spin" />} title="正在加载详情" description="正在读取指南与权限信息。" />

  return <div className="mx-auto w-full max-w-6xl px-8 pb-10"><div className="flex flex-wrap items-start justify-between gap-5 rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border/50"><div><div className="flex items-center gap-3"><div className="grid size-12 place-items-center rounded-xl bg-orange-500/10 text-orange-600"><Blocks size={24} /></div><div><h2 className="text-2xl font-semibold">{detail.displayName}</h2><p className="mt-1 text-xs text-muted-foreground">@{detail.author.handle} · v{detail.version} · {detail.installCount.toLocaleString()} 次安装</p></div></div><p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{detail.description}</p></div><button type="button" disabled={!installEnabled} onClick={() => setPendingInstall(detail.slug)} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{installEnabled ? (update ? `更新到 v${update.latestVersion.version}` : '安装到当前工作区') : '安装功能暂未开放'}</button></div>{update?.latestVersion.changelog && <div className="mt-4 rounded-xl bg-blue-500/10 p-4 text-sm"><p className="font-medium text-blue-800">v{update.currentVersion} → v{update.latestVersion.version}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-blue-800/75">{update.latestVersion.changelog}</p></div>}<div className="mt-5 flex rounded-xl bg-muted p-1">{(['guide', 'files', 'examples'] as const).map((value) => <button type="button" key={value} onClick={() => setTab(value)} className={cn('flex-1 rounded-lg py-2 text-sm transition', tab === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>{value === 'guide' ? '指南' : value === 'files' ? '文件' : '运行案例'}</button>)}</div>{tab === 'guide' ? <Guide detail={detail} /> : tab === 'files' ? <MarketplaceFiles api={api} detail={detail} /> : <MarketplaceExamples api={api} detail={detail} />}</div>
}

function Guide({ detail }: { detail: MarketplaceSkillDetail }): React.ReactElement {
  return <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]"><article className="prose prose-sm max-w-none rounded-2xl bg-card p-7 shadow-sm ring-1 ring-border/50 dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{detail.guideMarkdown}</ReactMarkdown></article><aside className="h-fit rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border/50"><h3 className="font-semibold">权限摘要</h3><div className="mt-4 space-y-3 text-xs text-muted-foreground"><PermissionRow value={detail.currentVersion.permissions.network}>网络访问</PermissionRow><PermissionRow value={detail.currentVersion.permissions.filesystem.read}>读取工作区</PermissionRow><PermissionRow value={detail.currentVersion.permissions.shell}>Shell</PermissionRow><p>文件写入：{detail.currentVersion.permissions.filesystem.write}</p></div></aside></div>
}

function PermissionRow({ value, children }: React.PropsWithChildren<{ value: boolean }>): React.ReactElement {
  return <p className="flex items-center gap-2"><CheckCircle2 size={14} className={value ? 'text-emerald-600' : 'text-muted-foreground'} />{children}：{value ? '需要' : '不需要'}</p>
}

function MarketplaceFiles({ api, detail }: { api: ElectronMarketplaceApi; detail: MarketplaceSkillDetail }): React.ReactElement {
  const [nodes, setNodes] = React.useState<MarketplaceFileNode[] | null>(null)
  const [selected, setSelected] = useAtom(marketplaceSelectedFileAtom)
  const [content, setContent] = React.useState<MarketplaceFileContent | null>(null)
  React.useEffect(() => { const controller = new AbortController(); api.listFiles(detail.slug, detail.version, controller.signal).then((items) => { setNodes(items); setSelected((current) => current ?? firstFile(items)) }).catch(() => setNodes([])); return () => controller.abort() }, [api, detail.slug, detail.version, setSelected])
  React.useEffect(() => { if (!selected) return; const controller = new AbortController(); setContent(null); api.getFile(detail.slug, detail.version, selected, controller.signal).then(setContent).catch(() => setContent(null)); return () => controller.abort() }, [api, detail.slug, detail.version, selected])
  if (!nodes) return <MarketplaceState icon={<Loader2 className="animate-spin" />} title="正在读取文件" description="文件仅安全预览，不会执行。" />
  return <div className="mt-5 grid min-h-[420px] overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/50 md:grid-cols-[240px_minmax(0,1fr)]"><nav className="border-b border-border bg-muted/40 p-3 md:border-b-0 md:border-r"><FileTree nodes={nodes} selected={selected} onSelect={setSelected} /></nav><div className="min-w-0 p-6">{content?.content ? (content.kind === 'markdown' ? <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{content.content}</ReactMarkdown></div> : <pre className="overflow-auto whitespace-pre-wrap text-xs leading-6"><code>{content.content}</code></pre>) : <MarketplaceState icon={<File />} title={selected ? '正在加载文件' : '没有可预览文件'} description="二进制和超大文件不展示正文。" />}</div></div>
}

function FileTree({ nodes, selected, onSelect }: { nodes: MarketplaceFileNode[]; selected: string | null; onSelect: (path: string) => void }): React.ReactElement {
  return <ul className="space-y-1">{nodes.map((node) => <li key={node.path}>{node.kind === 'directory' ? <><div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium"><Folder size={14} />{node.name}</div><div className="ml-3"><FileTree nodes={node.children ?? []} selected={selected} onSelect={onSelect} /></div></> : <button type="button" onClick={() => onSelect(node.path)} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs', selected === node.path ? 'bg-orange-500/10 text-orange-700' : 'text-muted-foreground hover:bg-muted')}><File size={14} /><span className="truncate">{node.name}</span></button>}</li>)}</ul>
}

function MarketplaceExamples({ api, detail }: { api: ElectronMarketplaceApi; detail: MarketplaceSkillDetail }): React.ReactElement {
  const [examples, setExamples] = React.useState<MarketplaceExample[] | null>(null)
  const [selectedId, setSelectedId] = useAtom(marketplaceSelectedExampleAtom)
  React.useEffect(() => { const controller = new AbortController(); api.listExamples(detail.slug, detail.version, controller.signal).then((items) => { setExamples(items); setSelectedId((current) => current ?? items[0]?.id ?? null) }).catch(() => setExamples([])); return () => controller.abort() }, [api, detail.slug, detail.version, setSelectedId])
  if (!examples) return <MarketplaceState icon={<Loader2 className="animate-spin" />} title="正在加载案例" description="仅展示可审计步骤和最终结果。" />
  const selected = examples.find((example) => example.id === selectedId) ?? examples[0]
  if (!selected) return <MarketplaceState icon={<Wrench />} title="暂无运行案例" description="你仍可以查看指南和文件。" />
  return <div className="mt-5 grid min-h-[420px] overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/50 md:grid-cols-[240px_minmax(0,1fr)]"><nav className="border-b border-border bg-muted/40 p-3 md:border-b-0 md:border-r">{examples.map((example) => <button key={example.id} type="button" onClick={() => setSelectedId(example.id)} className={cn('mb-2 w-full rounded-xl p-3 text-left', selected.id === example.id ? 'bg-orange-500/10' : 'hover:bg-muted')}><p className="text-sm font-medium">{example.title}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{example.summary}</p></button>)}</nav><article className="p-6"><p className="text-[10px] font-medium uppercase tracking-wider text-orange-600">用户请求</p><blockquote className="mt-2 rounded-xl bg-muted p-4 text-sm">{selected.userRequest}</blockquote><h3 className="mt-6 font-semibold">执行步骤</h3><ol className="mt-3 space-y-3">{selected.steps.map((step, index) => <li key={`${step.title}-${index}`} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-orange-500/10 text-[10px] text-orange-700">{index + 1}</span><div><p className="text-sm font-medium">{step.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{step.summary}</p></div></li>)}</ol><h3 className="mt-6 font-semibold">最终输出</h3><div className="prose prose-sm mt-3 max-w-none rounded-xl border border-border p-4 dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{selected.finalOutputMarkdown}</ReactMarkdown></div></article></div>
}

function MarketplaceState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }): React.ReactElement {
  return <div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div><h2 className="mt-4 font-medium">{title}</h2><p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{description}</p></div></div>
}

function firstFile(nodes: MarketplaceFileNode[]): string | null {
  for (const node of nodes) {
    if (node.kind !== 'directory') return node.path
    const child = firstFile(node.children ?? [])
    if (child) return child
  }
  return null
}
