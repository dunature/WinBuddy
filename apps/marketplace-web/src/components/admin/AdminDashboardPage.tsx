import * as React from 'react'
import { useAtom } from 'jotai'
import { useNavigate } from 'react-router'
import { FilePlus2, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import type { MarketplaceAdminSkillDetail, MarketplaceAdminSkillSummary, MarketplaceAdminVersion } from '@proma/shared'
import { getAdminSkill, listAdminSkills, logoutAdmin } from '../../admin-api'
import { adminDraftWorkspaceAtom } from '../../admin-draft-state'
import { adminAuthAtom } from '../../admin-state'
import { listMarketplaceCategories } from '../../api'
import { AdminSkillEditor } from './AdminSkillEditor'
import { AdminVersionPanel } from './AdminVersionPanel'

function upsertSkill(
  items: MarketplaceAdminSkillSummary[],
  skill: MarketplaceAdminSkillDetail,
): MarketplaceAdminSkillSummary[] {
  const next = items.filter((item) => item.id !== skill.id)
  return [skill, ...next]
}

export function AdminDashboardPage(): React.ReactElement {
  const [auth, setAuth] = useAtom(adminAuthAtom)
  const [workspace, setWorkspace] = useAtom(adminDraftWorkspaceAtom)
  const navigate = useNavigate()
  const [logoutError, setLogoutError] = React.useState<string | null>(null)

  const loadWorkspace = React.useCallback(async (): Promise<void> => {
    setWorkspace((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const [skills, categories] = await Promise.all([listAdminSkills(), listMarketplaceCategories()])
      const selectedSkill = skills.items[0] ? await getAdminSkill(skills.items[0].id) : null
      setWorkspace({
        status: 'ready',
        items: skills.items,
        categories,
        selectedSkill,
        creating: false,
        error: null,
      })
    } catch (requestError) {
      setWorkspace((current) => ({
        ...current,
        status: 'error',
        error: requestError instanceof Error ? requestError.message : '草稿工作台加载失败',
      }))
    }
  }, [setWorkspace])

  React.useEffect(() => {
    if (workspace.status === 'idle') void loadWorkspace()
  }, [loadWorkspace, workspace.status])

  const selectSkill = async (skillId: string): Promise<void> => {
    setWorkspace((current) => ({ ...current, status: 'loading', creating: false, error: null }))
    try {
      const selectedSkill = await getAdminSkill(skillId)
      setWorkspace((current) => ({ ...current, status: 'ready', selectedSkill }))
    } catch (requestError) {
      setWorkspace((current) => ({
        ...current,
        status: 'error',
        error: requestError instanceof Error ? requestError.message : 'Skill 草稿加载失败',
      }))
    }
  }

  const saved = (skill: MarketplaceAdminSkillDetail): void => {
    setWorkspace((current) => ({
      ...current,
      status: 'ready',
      items: upsertSkill(current.items, skill),
      selectedSkill: skill,
      creating: false,
      error: null,
    }))
  }

  const deleted = (skillId: string): void => {
    setWorkspace((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== skillId),
      selectedSkill: current.selectedSkill?.id === skillId ? null : current.selectedSkill,
      creating: false,
    }))
  }

  const versionCreated = (version: MarketplaceAdminVersion): void => {
    setWorkspace((current) => current.selectedSkill
      ? { ...current, selectedSkill: { ...current.selectedSkill, versions: [version, ...current.selectedSkill.versions] } }
      : current)
  }

  const logout = async (): Promise<void> => {
    if (!auth.session) return
    try {
      await logoutAdmin(auth.session.csrfToken)
      setAuth({ status: 'unauthenticated', session: null })
      setWorkspace({ status: 'idle', items: [], categories: [], selectedSkill: null, creating: false, error: null })
      navigate('/admin/login', { replace: true })
    } catch (requestError) {
      setLogoutError(requestError instanceof Error ? requestError.message : '退出失败，请重试')
    }
  }

  const csrfToken = auth.session?.csrfToken ?? ''

  return (
    <main className="admin-canvas min-h-screen px-4 py-5 text-[var(--paper)] sm:px-7 sm:py-7">
      <div className="mx-auto max-w-[1480px]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-emerald-300 text-emerald-950"><ShieldCheck size={19} /></span>
            <div><div className="font-display text-lg font-semibold">Proma Authority</div><div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Draft Registry</div></div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/[0.65]">{auth.session?.admin.username}</span>
            <button type="button" onClick={() => { void logout() }} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white/[0.65] transition hover:bg-white/[0.08] hover:text-white">
              <LogOut size={14} /> 退出
            </button>
          </div>
        </header>

        {(logoutError || workspace.error) && (
          <div role="alert" className="mt-5 rounded-2xl bg-red-400/12 px-4 py-3 text-sm text-red-200">{logoutError ?? workspace.error}</div>
        )}

        <section className="flex flex-wrap items-end justify-between gap-6 py-9 sm:py-12">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">Authenticated editorial desk</div>
            <h1 className="mt-3 font-display text-[clamp(2.8rem,6vw,5.8rem)] font-semibold leading-[0.9] tracking-[-0.05em]">Skill 草稿</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/[0.5]">把名称、分类与候选版本组织成可审核的服务端对象；线上版本指针在发布前始终保持不变。</p>
          </div>
          <button
            type="button"
            onClick={() => setWorkspace((current) => ({ ...current, creating: true, selectedSkill: null, status: 'ready', error: null }))}
            className="inline-flex h-12 items-center gap-2 rounded-2xl bg-emerald-300 px-5 text-sm font-bold text-emerald-950 shadow-[0_16px_36px_rgba(52,211,153,0.2)] transition hover:-translate-y-0.5"
          >
            <FilePlus2 size={18} /> 新建 Skill
          </button>
        </section>

        {workspace.status === 'loading' && workspace.items.length === 0 ? (
          <div className="grid min-h-[420px] place-items-center rounded-[28px] bg-white/[0.05]">
            <div className="flex items-center gap-3 text-sm text-white/55"><LoaderCircle className="animate-spin" size={18} /> 正在读取草稿档案</div>
          </div>
        ) : workspace.status === 'error' && workspace.items.length === 0 ? (
          <div className="grid min-h-[420px] place-items-center rounded-[28px] bg-white/[0.05] text-center">
            <div><p className="text-sm text-white/55">草稿档案暂时无法读取</p><button type="button" onClick={() => { void loadWorkspace() }} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-emerald-300"><RefreshCw size={16} /> 重新加载</button></div>
          </div>
        ) : (
          <section className="grid gap-4 pb-10 lg:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="rounded-[26px] bg-white/[0.055] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="flex items-center justify-between px-3 py-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Draft index</span>
                <span className="font-mono text-xs text-emerald-300">{workspace.items.length}</span>
              </div>
              <div className="space-y-2">
                {workspace.items.length === 0 ? (
                  <div className="rounded-[20px] bg-white/[0.045] px-4 py-12 text-center text-xs leading-6 text-white/40">还没有 Skill 草稿</div>
                ) : workspace.items.map((item, index) => {
                  const selected = workspace.selectedSkill?.id === item.id && !workspace.creating
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { void selectSkill(item.id) }}
                      className={`group w-full rounded-[20px] px-4 py-4 text-left transition ${selected ? 'bg-emerald-300 text-emerald-950' : 'bg-white/[0.045] hover:bg-white/[0.08]'}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`font-mono text-[10px] font-bold ${selected ? 'text-emerald-800' : 'text-white/25'}`}>{String(index + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{item.name}</span><span className={`mt-1 block truncate font-mono text-[10px] ${selected ? 'text-emerald-800' : 'text-white/35'}`}>{item.identifier}</span></span>
                        <span className={`text-[9px] font-bold uppercase ${selected ? 'text-emerald-800' : 'text-emerald-300'}`}>{item.status}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </aside>

            <div className="min-h-[560px] rounded-[28px] bg-[#e8e3d7] p-5 text-[var(--ink)] shadow-[0_28px_80px_rgba(0,0,0,0.18)] sm:p-8 lg:p-10">
              {workspace.creating || workspace.selectedSkill ? (
                <>
                  <AdminSkillEditor
                    key={workspace.creating ? 'new' : workspace.selectedSkill?.id}
                    skill={workspace.creating ? null : workspace.selectedSkill}
                    categories={workspace.categories}
                    csrfToken={csrfToken}
                    onSaved={saved}
                    onDeleted={deleted}
                  />
                  {!workspace.creating && workspace.selectedSkill && (
                    <AdminVersionPanel skill={workspace.selectedSkill} csrfToken={csrfToken} onCreated={versionCreated} />
                  )}
                </>
              ) : (
                <div className="grid min-h-[480px] place-items-center text-center">
                  <div className="max-w-md"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--ink)] text-emerald-300"><FilePlus2 size={23} /></div><h2 className="mt-6 font-display text-3xl font-semibold">从一份空白档案开始</h2><p className="mt-3 text-sm leading-7 text-[var(--muted)]">创建 Skill 草稿后，可继续建立候选版本；这些动作不会触碰当前线上版本。</p></div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
