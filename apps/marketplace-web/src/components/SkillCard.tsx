import { ArrowUpRight, Download, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MarketplaceSkillSummary } from '@proma/shared'

function formatInstallCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace('.0', '')}K`
  return String(value)
}

export function SkillCard({ skill }: { skill: MarketplaceSkillSummary }): React.ReactElement {
  return (
    <Link className="skill-card group" to={`/skills/${encodeURIComponent(skill.slug)}`} aria-label={`查看 ${skill.displayName}`}>
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-10 place-items-center rounded-lg bg-[#fff0e9] text-accent" aria-hidden="true">
          <Sparkles size={21} strokeWidth={1.8} />
        </span>
        <ArrowUpRight className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" size={17} aria-hidden="true" />
      </div>
      <div className="mt-5 flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">{skill.displayName}</h2>
        {skill.author.official && <span className="rounded-md bg-[#f8ecd2] px-2 py-0.5 text-[11px] font-medium text-[#8d6106]">官方</span>}
      </div>
      <p className="mt-3 line-clamp-2 min-h-12 text-sm leading-6 text-muted">{skill.description}</p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-6 font-mono text-xs text-muted">
        <span className="truncate">@{skill.author.handle}</span>
        <span className="flex shrink-0 items-center gap-1.5"><Download size={13} aria-hidden="true" />{formatInstallCount(skill.installCount)}</span>
      </div>
    </Link>
  )
}
