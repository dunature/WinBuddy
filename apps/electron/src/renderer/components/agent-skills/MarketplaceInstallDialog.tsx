import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangle, Check, CheckCircle2, Download, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import type { MarketplaceInstallState, MarketplaceSkillDetail } from '@proma/shared'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { marketplaceActiveInstallIdAtom, marketplaceAvailableUpdatesAtom, marketplaceInstallStatesAtom, marketplacePendingInstallSlugAtom } from '@/atoms/marketplace'
import { ElectronMarketplaceApi } from '@/lib/marketplace-api'
import { cn } from '@/lib/utils'

export function MarketplaceInstallDialog({ api, workspaceSlug }: { api: ElectronMarketplaceApi; workspaceSlug: string }): React.ReactElement {
  const [pendingSlug, setPendingSlug] = useAtom(marketplacePendingInstallSlugAtom)
  const [activeId, setActiveId] = useAtom(marketplaceActiveInstallIdAtom)
  const states = useAtomValue(marketplaceInstallStatesAtom)
  const availableUpdates = useAtomValue(marketplaceAvailableUpdatesAtom)
  const setStates = useSetAtom(marketplaceInstallStatesAtom)
  const [detail, setDetail] = React.useState<MarketplaceSkillDetail | null>(null)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const state = activeId ? states.get(activeId) : undefined
  const update = pendingSlug ? availableUpdates.find((item) => item.slug === pendingSlug) : undefined
  const open = Boolean(pendingSlug || activeId)

  React.useEffect(() => {
    if (!pendingSlug || activeId) return
    const controller = new AbortController()
    api.getSkill(pendingSlug, controller.signal).then(setDetail).catch(() => setCreateError('无法加载安装信息'))
    return () => controller.abort()
  }, [activeId, api, pendingSlug])

  const close = (): void => {
    if (state && !isTerminal(state)) return
    setPendingSlug(null)
    setActiveId(null)
    setDetail(null)
    setCreateError(null)
  }

  const start = async (): Promise<void> => {
    if (!detail) return
    setCreateError(null)
    try {
      const session = await window.electronAPI.createMarketplaceInstall({ skillId: detail.id, slug: detail.slug, version: detail.version, workspaceSlug })
      setStates((current) => new Map(current).set(session.installId, { status: 'idle', installId: session.installId }))
      setActiveId(session.installId)
      void window.electronAPI.startMarketplaceInstall({ installId: session.installId }).catch(() => undefined)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '无法创建安装任务')
    }
  }

  const cancel = (): void => {
    if (activeId) void window.electronAPI.cancelMarketplaceInstall({ installId: activeId })
  }

  const resolve = (resolution: 'cancel' | 'backup-and-replace'): void => {
    if (activeId) void window.electronAPI.resolveMarketplaceInstallConflict({ installId: activeId, resolution })
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}><DialogContent className="sm:max-w-xl" hideClose={Boolean(state && !isTerminal(state))}>{state ? <InstallStateContent state={state} onCancel={cancel} onResolve={resolve} onClose={close} /> : <><DialogHeader><DialogTitle>{update ? '确认更新 Skill' : '安装到当前工作区'}</DialogTitle><DialogDescription>安装前请确认版本、权限与目标工作区。Proma 会先在临时目录完成安全检查。</DialogDescription></DialogHeader>{detail ? <div className="rounded-xl bg-muted/60 p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{detail.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{detail.slug} · v{detail.version}</p></div><span className="rounded-full bg-orange-500/10 px-2 py-1 text-[10px] text-orange-700">{detail.author.official ? '官方' : '社区'}</span></div><div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"><p>工作区：{workspaceSlug}</p><p>网络：{detail.currentVersion.permissions.network ? '需要' : '不需要'}</p><p>读取文件：{detail.currentVersion.permissions.filesystem.read ? '需要' : '不需要'}</p><p>写入：{detail.currentVersion.permissions.filesystem.write}</p><p>Shell：{detail.currentVersion.permissions.shell ? '需要' : '不需要'}</p><p>包大小：{formatBytes(detail.currentVersion.packageSize)}</p></div></div> : <div className="grid min-h-32 place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>}{update && update.permissionsAdded.length > 0 && <div className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800"><p className="font-medium">此更新新增权限，需要重新确认</p><p className="mt-1">{update.permissionsAdded.map(permissionLabel).join('、')}</p></div>}{createError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{createError}</p>}<DialogFooter><button type="button" onClick={close} className="rounded-lg border border-border px-4 py-2 text-sm">取消</button><button type="button" onClick={() => void start()} disabled={!detail} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{update ? '确认权限并更新' : '确认安装'}</button></DialogFooter></>}</DialogContent></Dialog>
}

function InstallStateContent({ state, onCancel, onResolve, onClose }: { state: MarketplaceInstallState; onCancel: () => void; onResolve: (resolution: 'cancel' | 'backup-and-replace') => void; onClose: () => void }): React.ReactElement {
  if (state.status === 'conflict') return <><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-amber-600" />发现本地冲突</DialogTitle><DialogDescription>Proma 不会逐文件合并或静默覆盖。你可以取消，或备份现有 Skill 后整体替换。</DialogDescription></DialogHeader><div className="rounded-xl bg-amber-500/10 p-4 text-sm"><p>冲突类型：{conflictLabel(state.conflict.kind)}</p>{state.conflict.localVersion && <p className="mt-2 text-xs text-muted-foreground">本地 v{state.conflict.localVersion} → 市场 v{state.conflict.marketplaceVersion}</p>}{state.conflict.changedFiles.length > 0 && <div className="mt-3"><p className="text-xs font-medium">本地变更</p><ul className="mt-1 max-h-28 overflow-auto font-mono text-[11px] text-muted-foreground">{state.conflict.changedFiles.map((path) => <li key={path}>{path}</li>)}</ul></div>}</div><DialogFooter><button type="button" onClick={() => onResolve('cancel')} className="rounded-lg border border-border px-4 py-2 text-sm">取消安装</button><button type="button" onClick={() => onResolve('backup-and-replace')} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white">备份后整体替换</button></DialogFooter></>
  if (state.status === 'success') return <Terminal icon={<CheckCircle2 className="size-12 text-emerald-600" />} title="安装成功" description={`${state.slug} v${state.version} 已安装到 ${state.workspaceSlug}。`} onClose={onClose} />
  if (state.status === 'error') return <Terminal icon={<XCircle className="size-12 text-destructive" />} title="安装失败" description={state.error.message} onClose={onClose} />
  if (state.status === 'cancelled') return <Terminal icon={<XCircle className="size-12 text-muted-foreground" />} title="安装已取消" description="临时下载和 staging 文件已清理。" onClose={onClose} />
  return <><DialogHeader><DialogTitle>正在安全安装</DialogTitle><DialogDescription>可以离开当前页面，安装进度会继续保留。</DialogDescription></DialogHeader><InstallSteps state={state} /><DialogFooter><button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">取消安装</button></DialogFooter></>
}

function InstallSteps({ state }: { state: Exclude<MarketplaceInstallState, { status: 'conflict' | 'success' | 'error' | 'cancelled' }> }): React.ReactElement {
  const active = stepIndex(state)
  const labels = ['下载安装包', '完整性校验', '安全预检', '写入工作区']
  return <ol className="space-y-3">{labels.map((label, index) => <li key={label} className={cn('flex items-center gap-3 rounded-xl p-3 text-sm', index === active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground')}><span className={cn('grid size-7 place-items-center rounded-full', index < active ? 'bg-emerald-500/15 text-emerald-700' : index === active ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{index < active ? <Check size={14} /> : index === active ? (index === 0 ? <Download size={14} /> : index === 2 ? <ShieldCheck size={14} /> : <Loader2 size={14} className="animate-spin" />) : index + 1}</span><span>{label}</span>{state.status === 'downloading' && index === 0 && <span className="ml-auto text-xs tabular-nums">{state.total ? `${Math.round(state.received / state.total * 100)}%` : formatBytes(state.received)}</span>}</li>)}</ol>
}

function Terminal({ icon, title, description, onClose }: { icon: React.ReactNode; title: string; description: string; onClose: () => void }): React.ReactElement {
  return <div className="py-5 text-center"><div className="flex justify-center">{icon}</div><h2 className="mt-4 text-lg font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p><button type="button" onClick={onClose} className="mt-6 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">完成</button></div>
}

function stepIndex(state: Exclude<MarketplaceInstallState, { status: 'conflict' | 'success' | 'error' | 'cancelled' }>): number {
  if (state.status === 'downloading' || state.status === 'idle') return 0
  if (state.status === 'committing') return 3
  return state.step === 'hash' ? 1 : 2
}

function isTerminal(state: MarketplaceInstallState): boolean { return state.status === 'success' || state.status === 'error' || state.status === 'cancelled' }
function conflictLabel(kind: 'unmanaged' | 'locally-modified' | 'downgrade' | 'different-source'): string { return ({ unmanaged: '同名 Skill 无来源信息', 'locally-modified': '本地文件已修改', downgrade: '目标版本低于本地版本', 'different-source': '同名 Skill 来自其他来源' })[kind] }
function permissionLabel(permission: 'network' | 'filesystem' | 'shell' | 'filesystem.write'): string { return ({ network: '网络访问', filesystem: '读取工作区文件', shell: 'Shell', 'filesystem.write': '扩大文件写入范围' })[permission] }
function formatBytes(value: number): string { return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB` }
