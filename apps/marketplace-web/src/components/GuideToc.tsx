import type { MarketplaceGuideHeading } from '../lib/markdown-headings.ts'

export function GuideToc({ headings }: { headings: MarketplaceGuideHeading[] }): React.ReactElement | null {
  if (headings.length === 0) return null
  return (
    <nav className="sticky top-28 hidden self-start lg:block" aria-label="本页目录">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">本页目录</p>
      <ul className="mt-4 space-y-2.5 border-l border-line pl-4 text-sm">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.depth === 3 ? 'pl-3' : ''}>
            <a className="text-muted transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
