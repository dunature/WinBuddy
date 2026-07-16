import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Archive, Download, UploadCloud } from 'lucide-react'
import type { MarketplaceAdminSkillSummary, MarketplaceAdminVersionSummary } from '@proma/shared'
import { adminSessionAtom } from '../atoms/admin-auth.ts'
import { marketplaceApi } from '../lib/api-client.ts'

export function AdminSkillsPage(): React.ReactElement {
  const session = useAtomValue(adminSessionAtom)
  const [items, setItems] = React.useState<MarketplaceAdminSkillSummary[]>([])
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<MarketplaceAdminSkillSummary | null>(null)
  const [versions, setVersions] = React.useState<MarketplaceAdminVersionSummary[]>([])
  const load = React.useCallback(() => marketplaceApi.listAdminSkills(query).then(setItems), [query])
  React.useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => clearTimeout(timer) }, [load])

  async function open(skill: MarketplaceAdminSkillSummary): Promise<void> {
    setSelected(skill)
    setVersions(await marketplaceApi.listAdminVersions(skill.id))
  }

  async function lifecycle(action: 'unlist' | 'republish' | 'archive'): Promise<void> {
    if (!selected) return
    const labels = { unlist: '下架', republish: '重新发布', archive: '归档' }
    const reason = window.prompt(`请输入${labels[action]}原因`)
    if (!reason) return
    await marketplaceApi.updateSkillLifecycle(selected.id, action, reason)
    setSelected(null)
    await load()
  }

  return <main className="admin-page">
    <header className="admin-page-header"><div><p className="admin-kicker">CATALOG CONTROL</p><h1>Skills 管理</h1><p>管理上传、审核、版本与公开状态</p></div><a className="admin-primary-link" href="/admin/uploads"><UploadCloud />上传 Skill</a></header>
    <section className="admin-metrics"><div><span>已发布</span><strong>{items.filter((item) => item.status === 'published').length}</strong></div><div><span>待处理</span><strong>{items.filter((item) => item.status !== 'published').length}</strong></div><div><span>30 天安装</span><strong>{items.reduce((sum, item) => sum + item.installCount, 0).toLocaleString()}</strong></div></section>
    <label className="admin-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、slug 或作者" /></label>
    <section className="admin-table"><header><span>Skill</span><span>版本</span><span>分类</span><span>状态</span><span>安装量</span></header>{items.map((item) => <button key={item.id} onClick={() => void open(item)}><span><strong>{item.displayName}</strong><small>{item.slug} · @{item.authorHandle}</small></span><span>{item.version}</span><span>{item.category}</span><span className={`admin-status admin-status-${item.status}`}>{item.status}</span><span>{item.installCount.toLocaleString()}</span></button>)}</section>
    {selected && <div className="admin-version-drawer"><button className="close" onClick={() => setSelected(null)}>×</button><h2>{selected.displayName}</h2><p>{selected.slug} · 当前 {selected.version}</p><h3>版本历史</h3>{versions.map((version) => <div key={version.id}><strong>v{version.version}</strong><span>{version.status}</span><small>sha256 {version.sha256.slice(0, 12)}…</small></div>)}{session?.user?.role === 'admin' && <footer>{selected.status === 'published' && <button onClick={() => void lifecycle('unlist')}><Download />下架</button>}{selected.status === 'unlisted' && <button onClick={() => void lifecycle('republish')}><UploadCloud />重新发布</button>}{selected.status !== 'archived' && <button onClick={() => void lifecycle('archive')}><Archive />归档</button>}</footer>}</div>}
  </main>
}
