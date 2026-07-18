import * as React from 'react'
import { Link, Outlet } from 'react-router'
import { ArrowUpRight, Blocks } from 'lucide-react'

export function MarketplaceLayout(): React.ReactElement {
  return (
    <div className="marketplace-canvas min-h-screen text-[var(--ink)]">
      <header className="sticky top-0 z-40 border-b border-[color:var(--ink)]/10 bg-[color:var(--paper)]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center justify-between px-5 sm:px-8">
          <Link to="/" className="group flex items-center gap-3" aria-label="Proma 技能市场首页">
            <span className="grid size-9 place-items-center rounded-[13px] bg-[var(--ink)] text-[var(--paper)] shadow-[0_8px_24px_rgba(18,35,61,0.22)] transition-transform group-hover:-rotate-3">
              <Blocks size={18} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block font-display text-[17px] font-semibold leading-none tracking-[-0.02em]">Proma</span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Skill Archive</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden rounded-full bg-[var(--ink)]/[0.055] px-3 py-1.5 text-[var(--muted)] sm:inline">公开目录</span>
            <a
              href="https://www.feiyangclaw.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition hover:bg-white/65"
            >
              访问 Proma <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </header>

      <main><Outlet /></main>

      <footer className="border-t border-[color:var(--ink)]/10 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-2 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <span>Proma 技能市场 · 每一项能力都附带可追溯版本</span>
          <span>公开浏览无需登录</span>
        </div>
      </footer>
    </div>
  )
}
