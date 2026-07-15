import * as React from 'react'
import { CheckCircle2, Clock3, Image as ImageIcon, Wrench } from 'lucide-react'
import type { MarketplaceExample } from '@proma/shared'
import { marketplaceApi } from '../lib/api-client.ts'
import { MarkdownGuide } from './MarkdownGuide.tsx'

export function ExampleBrowser({ slug, version }: { slug: string; version: string }): React.ReactElement {
  const [examples, setExamples] = React.useState<MarketplaceExample[] | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    marketplaceApi.listExamples(slug, version, controller.signal).then((items) => {
      setExamples(items)
      setSelectedId(items[0]?.id ?? null)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [slug, version])

  if (error) return <ExampleState title="运行案例加载失败" description="请稍后重试，或返回指南了解 Skill。" />
  if (!examples) return <ExampleState title="正在加载运行案例" description="案例仅展示可审计步骤和最终结果，不展示隐藏思维过程。" loading />
  if (examples.length === 0) return <ExampleState title="暂时没有运行案例" description="该 Skill 的指南和文件仍可正常查看。" />

  const selected = examples.find((example) => example.id === selectedId) ?? examples[0]
  if (!selected) return <ExampleState title="暂时没有运行案例" description="该 Skill 的指南和文件仍可正常查看。" />

  return (
    <div className="mt-6 grid min-h-[560px] overflow-hidden rounded-xl border border-line bg-panel shadow-card md:grid-cols-[250px_minmax(0,1fr)]">
      <nav className="border-b border-line bg-[#f8f7f3] p-3 md:border-b-0 md:border-r" aria-label="运行案例">
        <ul className="space-y-2">
          {examples.map((example) => <li key={example.id}><button className={example.id === selected.id ? 'example-item example-item-active' : 'example-item'} type="button" onClick={() => setSelectedId(example.id)}><span className="flex items-center gap-2 font-medium">{example.title}{example.featured && <span className="rounded bg-[#f8ecd2] px-1.5 py-0.5 text-[10px] text-[#8d6106]">精选</span>}</span><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{example.summary}</span></button></li>)}
        </ul>
      </nav>
      <article className="min-w-0 p-5 sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">用户请求</p>
        <blockquote className="mt-3 rounded-lg bg-[#f8f7f3] p-4 font-serif text-lg leading-8">{selected.userRequest}</blockquote>
        <h3 className="mt-8 text-xl font-semibold">执行步骤</h3>
        <ol className="mt-5 space-y-4">
          {selected.steps.map((step, index) => <li key={`${step.title}-${index}`} className="flex gap-4"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#fff0e9] font-mono text-xs text-accent">{String(index + 1).padStart(2, '0')}</span><div><p className="font-medium">{step.title}</p><p className="mt-1 text-sm leading-6 text-muted">{step.summary}</p><div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-muted">{step.toolName && <span className="inline-flex items-center gap-1"><Wrench size={12} />{step.toolName}</span>}{step.durationMs !== undefined && <span className="inline-flex items-center gap-1"><Clock3 size={12} />{step.durationMs} ms</span>}</div></div></li>)}
        </ol>
        <div className="mt-8 flex items-center gap-2"><CheckCircle2 size={19} className="text-[#1e8d67]" /><h3 className="text-xl font-semibold">最终输出</h3></div>
        <div className="mt-4 rounded-lg border border-line p-5"><MarkdownGuide markdown={selected.finalOutputMarkdown} /></div>
        {selected.assetUrls.length > 0 && <div className="mt-8"><h3 className="flex items-center gap-2 text-lg font-semibold"><ImageIcon size={18} />案例产物</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{selected.assetUrls.map((url) => <img key={url} className="w-full rounded-lg border border-line" src={url} alt={`${selected.title} 案例产物`} loading="lazy" />)}</div></div>}
      </article>
    </div>
  )
}

function ExampleState({ title, description, loading = false }: { title: string; description: string; loading?: boolean }): React.ReactElement {
  return <div className="mt-6 grid min-h-80 place-items-center rounded-xl border border-dashed border-line bg-panel p-8 text-center"><div>{loading && <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-line border-t-accent" />}<h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted">{description}</p></div></div>
}
