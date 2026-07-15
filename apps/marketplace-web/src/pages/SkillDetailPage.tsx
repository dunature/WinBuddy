import * as React from 'react'
import { ArrowLeft, CheckCircle2, Copy, Download, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { MarketplaceSkillDetail } from '@proma/shared'
import { GuideToc } from '../components/GuideToc.tsx'
import { MarkdownGuide } from '../components/MarkdownGuide.tsx'
import { RemoteFileBrowser } from '../components/RemoteFileBrowser.tsx'
import { ExampleBrowser } from '../components/ExampleBrowser.tsx'
import { marketplaceApi, MarketplaceRequestError } from '../lib/api-client.ts'
import { extractGuideHeadings } from '../lib/markdown-headings.ts'

type DetailTab = 'guide' | 'files' | 'examples'

export function SkillDetailPage(): React.ReactElement {
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [skill, setSkill] = React.useState<MarketplaceSkillDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const tab = parseTab(searchParams.get('tab'))

  React.useEffect(() => {
    const controller = new AbortController()
    setError(null)
    setSkill(null)
    marketplaceApi.getSkill(slug, controller.signal)
      .then(setSkill)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof MarketplaceRequestError ? reason.message : '加载 Skill 详情失败')
      })
    return () => controller.abort()
  }, [slug])

  if (error) return <DetailError message={error} />
  if (!skill) return <DetailSkeleton />

  const headings = extractGuideHeadings(skill.guideMarkdown)
  const installUrl = `proma://marketplace/install?slug=${encodeURIComponent(skill.slug)}&version=${encodeURIComponent(skill.version)}`

  return (
    <section className="mx-auto max-w-[1360px] px-5 pb-16 pt-10 sm:px-8 lg:px-16">
      <Link className="inline-flex h-10 items-center gap-2 rounded-lg text-sm text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to="/"><ArrowLeft size={15} />返回技能市场</Link>

      <header className="mt-7 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div className="flex min-w-0 items-start gap-5">
          <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-[#fff0e9] text-accent"><Sparkles size={31} strokeWidth={1.7} /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-medium tracking-[-0.04em] sm:text-5xl">{skill.displayName}</h1>
              {skill.author.official && <span className="rounded-md bg-[#fff0e9] px-2 py-1 text-xs font-medium text-accent">官方</span>}
            </div>
            <p className="mt-2 font-mono text-sm text-muted">{skill.slug}</p>
            <p className="mt-2 text-sm text-muted">@{skill.author.handle} · v{skill.version} · {skill.installCount.toLocaleString()} 次安装</p>
          </div>
        </div>
        <a className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-6 font-medium text-white shadow-card transition hover:-translate-y-0.5 hover:bg-[#dc4600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2" href={installUrl}><Download size={18} />安装到 Proma</a>
      </header>

      <p className="mt-8 max-w-4xl font-serif text-xl leading-8 text-[#656156]">{skill.description}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex rounded-xl border border-line bg-panel p-1" role="tablist" aria-label="Skill 详情内容">
            {([['guide', '指南'], ['files', '文件'], ['examples', '运行案例']] as const).map(([value, label]) => (
              <button key={value} className={tab === value ? 'detail-tab detail-tab-active' : 'detail-tab'} type="button" role="tab" aria-selected={tab === value} onClick={() => setSearchParams(value === 'guide' ? {} : { tab: value })}>{label}</button>
            ))}
          </div>

          {tab === 'guide' && (
            <div className="mt-6 grid gap-8 rounded-xl border border-line bg-panel p-6 shadow-card sm:p-8 lg:grid-cols-[160px_minmax(0,1fr)]">
              <GuideToc headings={headings} />
              <MarkdownGuide markdown={skill.guideMarkdown} />
            </div>
          )}
          {tab === 'files' && <RemoteFileBrowser slug={skill.slug} version={skill.version} />}
          {tab === 'examples' && <ExampleBrowser slug={skill.slug} version={skill.version} />}
        </div>

        <UsageSidebar skill={skill} />
      </div>
    </section>
  )
}

function UsageSidebar({ skill }: { skill: MarketplaceSkillDetail }): React.ReactElement {
  const prompt = `请安装并使用 ${skill.slug} Skill，帮我完成任务。`
  return (
    <aside className="self-start rounded-xl border border-line bg-panel p-6 shadow-panel lg:sticky lg:top-24">
      <h2 className="text-xl font-semibold tracking-[-0.02em]">安装与使用</h2>
      <div className="mt-5 flex items-start gap-2.5 rounded-lg bg-[#e8f5ef] px-3 py-3 text-sm text-[#157052]"><ShieldCheck className="mt-0.5 shrink-0" size={16} /><span>已通过文件与完整性检查</span></div>
      <div className="mt-5 border-t border-line pt-5">
        <p className="text-xs font-medium text-muted">权限摘要</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center gap-2"><CheckCircle2 size={15} className="text-[#1e8d67]" />网络：{skill.currentVersion.permissions.network ? '需要' : '不需要'}</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={15} className="text-[#1e8d67]" />文件写入：{skill.currentVersion.permissions.filesystem.write}</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={15} className="text-[#1e8d67]" />Shell：{skill.currentVersion.permissions.shell ? '需要' : '不需要'}</li>
        </ul>
      </div>
      <div className="mt-5 rounded-lg bg-ink p-4 font-mono text-xs leading-6 text-[#f5f2e9]">{prompt}</div>
      <button className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-line bg-white text-sm transition hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" type="button" onClick={() => void navigator.clipboard.writeText(prompt)}><Copy size={15} />复制提示词</button>
      {skill.repository && <a className="mt-4 flex items-center justify-center gap-2 text-sm text-muted hover:text-accent" href={skill.repository} target="_blank" rel="noreferrer"><ExternalLink size={14} />查看来源</a>}
    </aside>
  )
}

function DetailSkeleton(): React.ReactElement {
  return <section className="mx-auto max-w-[1280px] px-5 py-12 sm:px-8 lg:px-16" aria-label="正在加载 Skill 详情"><div className="h-10 w-32 animate-pulse rounded bg-panel" /><div className="mt-10 h-40 animate-pulse rounded-xl bg-panel" /><div className="mt-8 h-96 animate-pulse rounded-xl bg-panel" /></section>
}

function DetailError({ message }: { message: string }): React.ReactElement {
  return <section className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-6 text-center"><div><h1 className="text-2xl font-semibold">无法打开 Skill</h1><p className="mt-3 text-muted">{message}</p><Link className="market-action inline-flex items-center" to="/">返回技能市场</Link></div></section>
}

function parseTab(value: string | null): DetailTab {
  return value === 'files' || value === 'examples' ? value : 'guide'
}
