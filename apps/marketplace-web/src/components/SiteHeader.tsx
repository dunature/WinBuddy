import { Download } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { BrandMark } from './BrandMark.tsx'

export function SiteHeader(): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-16">
        <Link to="/" aria-label="Proma 技能市场首页"><BrandMark /></Link>
        <nav className="flex items-center gap-2 text-sm" aria-label="主要导航">
          <NavLink className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'} to="/">技能市场</NavLink>
          <a className="nav-link hidden sm:inline-flex" href="https://github.com/dunature/WinBuddy" target="_blank" rel="noreferrer">开发文档</a>
          <a className="ml-1 inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 font-medium text-white transition hover:-translate-y-0.5 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2" href="https://github.com/dunature/WinBuddy/releases/latest">
            <Download size={15} aria-hidden="true" />
            <span className="hidden sm:inline">下载 Proma</span>
          </a>
        </nav>
      </div>
    </header>
  )
}
