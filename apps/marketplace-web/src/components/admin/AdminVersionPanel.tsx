import * as React from 'react'
import { GitBranchPlus, LoaderCircle, PackageOpen } from 'lucide-react'
import type { MarketplaceAdminSkillDetail, MarketplaceAdminVersion } from '@proma/shared'
import { createAdminVersion } from '../../admin-api'

interface AdminVersionPanelProps {
  skill: MarketplaceAdminSkillDetail
  csrfToken: string
  onCreated(version: MarketplaceAdminVersion): void
}

export function AdminVersionPanel({ skill, csrfToken, onCreated }: AdminVersionPanelProps): React.ReactElement {
  const [creating, setCreating] = React.useState(false)
  const [version, setVersion] = React.useState('')
  const [changelog, setChangelog] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const created = await createAdminVersion(skill.id, { version, changelog }, csrfToken)
      onCreated(created)
      setCreating(false)
      setVersion('')
      setChangelog('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '候选版本创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-8 border-t border-[rgba(16,35,61,0.09)] pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="admin-step">VERSION LEDGER</div>
          <h3 className="mt-2 font-display text-2xl font-semibold text-[var(--ink)]">候选版本</h3>
        </div>
        <button type="button" onClick={() => setCreating((value) => !value)} className="admin-secondary-button">
          <GitBranchPlus size={16} /> 新建候选版本
        </button>
      </div>

      {creating && (
        <form onSubmit={(event) => { void submit(event) }} className="mt-5 grid gap-4 rounded-[22px] bg-[#f2eee5] p-5 sm:grid-cols-[0.8fr_1.5fr_auto] sm:items-end">
          <label className="admin-compact-field">
            <span>版本号</span>
            <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" required />
          </label>
          <label className="admin-compact-field">
            <span>更新说明</span>
            <input value={changelog} onChange={(event) => setChangelog(event.target.value)} />
          </label>
          <button type="submit" disabled={submitting} className="admin-primary-button min-w-[170px]">
            {submitting ? <LoaderCircle className="animate-spin" size={16} /> : <PackageOpen size={16} />}
            保存候选版本
          </button>
          {error && <div role="alert" className="admin-alert sm:col-span-3">{error}</div>}
        </form>
      )}

      <div className="mt-5 space-y-2">
        {skill.versions.length === 0 ? (
          <div className="rounded-[20px] bg-[#f2eee5] px-5 py-7 text-center text-sm text-[var(--muted)]">尚未创建候选版本</div>
        ) : skill.versions.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center gap-4 rounded-[20px] bg-[#f2eee5] px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-bold text-[var(--ink)]">{item.version}</div>
              <div className="mt-1 truncate text-xs text-[var(--muted)]">{item.changelog || '暂无更新说明'}</div>
            </div>
            <span className="admin-status-pill">{item.status}</span>
            <span className="text-[10px] font-bold tracking-[0.12em] text-[var(--muted)]">R{item.revision}</span>
          </article>
        ))}
      </div>
    </section>
  )
}
