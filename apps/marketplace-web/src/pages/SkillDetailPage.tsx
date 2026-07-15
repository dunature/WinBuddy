import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

export function SkillDetailPage(): React.ReactElement {
  const { slug } = useParams()
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-12 sm:px-8 lg:px-16">
      <Link className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink" to="/"><ArrowLeft size={15} />返回技能市场</Link>
      <div className="mt-10 rounded-xl bg-panel p-8 shadow-card">
        <p className="font-mono text-sm text-muted">{slug}</p>
        <div className="mt-4 h-10 w-56 animate-pulse rounded bg-canvas" />
        <div className="mt-8 h-64 animate-pulse rounded-lg bg-canvas" />
      </div>
    </section>
  )
}
