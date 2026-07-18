import * as React from 'react'
import { useAtom } from 'jotai'
import { useNavigate } from 'react-router'
import { Activity, LogOut, PackageCheck, ShieldCheck } from 'lucide-react'
import { logoutAdmin } from '../../admin-api'
import { adminAuthAtom } from '../../admin-state'

export function AdminDashboardPage(): React.ReactElement {
  const [auth, setAuth] = useAtom(adminAuthAtom)
  const navigate = useNavigate()
  const [error, setError] = React.useState<string | null>(null)

  const logout = async (): Promise<void> => {
    if (!auth.session) return
    try {
      await logoutAdmin(auth.session.csrfToken)
      setAuth({ status: 'unauthenticated', session: null })
      navigate('/admin/login', { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '退出失败，请重试')
    }
  }

  return (
    <main className="admin-canvas min-h-screen px-5 py-6 text-[var(--paper)] sm:px-8 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-emerald-300 text-emerald-950"><ShieldCheck size={19} /></span>
            <div><div className="font-display text-lg font-semibold">Proma Authority</div><div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Marketplace Admin</div></div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/[0.65]">{auth.session?.admin.username}</span>
            <button type="button" onClick={() => { void logout() }} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white/[0.65] transition hover:bg-white/[0.08] hover:text-white">
              <LogOut size={14} /> 退出
            </button>
          </div>
        </header>

        {error && <div role="alert" className="mt-6 rounded-2xl bg-red-400/12 px-4 py-3 text-sm text-red-200">{error}</div>}

        <section className="pb-10 pt-14 sm:pt-20">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300">Authenticated workspace</div>
          <h1 className="mt-4 max-w-4xl font-display text-[clamp(3rem,7vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.055em]">发布控制台</h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-white/[0.52]">安全会话已经建立。Skill、版本和审核操作将在后续治理切片中接入同一服务端门禁。</p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { icon: ShieldCheck, title: '身份已验证', text: 'HttpOnly 会话与 CSRF token 均由服务端校验。' },
            { icon: PackageCheck, title: '发布门禁就绪', text: '首次密码轮换完成，管理写操作已解锁。' },
            { icon: Activity, title: '审计已启用', text: '登录、改密与退出均保留 request ID。' },
          ].map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-[26px] bg-white/[0.055] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <Icon className="text-emerald-300" size={22} />
              <h2 className="mt-8 font-display text-xl font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/[0.45]">{text}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
