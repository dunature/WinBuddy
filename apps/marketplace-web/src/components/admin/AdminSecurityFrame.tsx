import * as React from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Fingerprint, ShieldCheck } from 'lucide-react'

export interface AdminSecurityFrameProps {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}

export function AdminSecurityFrame({
  eyebrow,
  title,
  description,
  children,
}: AdminSecurityFrameProps): React.ReactElement {
  return (
    <main className="admin-canvas min-h-screen px-5 py-6 text-[var(--paper)] sm:px-8 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col overflow-hidden rounded-[30px] bg-[var(--ink)] shadow-[0_35px_100px_rgba(16,35,61,0.32)] sm:min-h-[calc(100vh-4rem)] lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(460px,0.58fr)]">
        <section className="relative flex min-h-[320px] flex-col overflow-hidden p-7 sm:p-11 lg:min-h-0 lg:p-14">
          <div className="admin-grid" aria-hidden="true" />
          <Link to="/" className="relative z-10 inline-flex w-fit items-center gap-2 text-xs font-semibold text-white/[0.58] transition hover:text-white">
            <ArrowLeft size={15} /> 返回公开市场
          </Link>
          <div className="relative z-10 my-auto max-w-xl py-14 lg:py-20">
            <div className="mb-6 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">
              <span className="grid size-8 place-items-center rounded-full bg-emerald-300/12"><ShieldCheck size={16} /></span>
              {eyebrow}
            </div>
            <h1 className="font-display text-[clamp(2.7rem,6vw,5.7rem)] font-semibold leading-[0.92] tracking-[-0.05em]">{title}</h1>
            <p className="mt-7 max-w-lg text-sm leading-7 text-white/[0.58] sm:text-base sm:leading-8">{description}</p>
          </div>
          <div className="relative z-10 flex items-center gap-3 border-t border-white/10 pt-6 text-[11px] text-white/40">
            <Fingerprint size={17} /> 单管理员 · 8 小时会话 · 可审计
          </div>
        </section>
        <section className="flex items-center bg-[#e8e3d7] p-5 text-[var(--ink)] sm:p-9 lg:p-12">
          <div className="mx-auto w-full max-w-md">{children}</div>
        </section>
      </div>
    </main>
  )
}
