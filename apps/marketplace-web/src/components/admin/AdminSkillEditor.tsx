import * as React from 'react'
import { ArchiveX, LoaderCircle, Save } from 'lucide-react'
import type { MarketplaceAdminSkillDetail, MarketplaceCategory } from '@proma/shared'
import {
  createAdminSkill,
  deleteAdminSkill,
  updateAdminSkill,
  type AdminSkillWriteInput,
} from '../../admin-api'

interface AdminSkillEditorProps {
  skill: MarketplaceAdminSkillDetail | null
  categories: MarketplaceCategory[]
  csrfToken: string
  onSaved(skill: MarketplaceAdminSkillDetail): void
  onDeleted(skillId: string): void
}

function initialForm(skill: MarketplaceAdminSkillDetail | null, categories: MarketplaceCategory[]): AdminSkillWriteInput {
  return {
    identifier: skill?.identifier ?? '',
    name: skill?.name ?? '',
    tagline: skill?.tagline ?? '',
    description: skill?.description ?? '',
    authorName: skill?.authorName ?? '',
    ...(skill?.authorUrl ? { authorUrl: skill.authorUrl } : {}),
    categoryId: skill?.categoryId ?? categories[0]?.id ?? '',
    tags: skill?.tags ?? [],
    icon: skill?.icon ?? '',
    featured: skill?.featured ?? false,
  }
}

export function AdminSkillEditor({
  skill,
  categories,
  csrfToken,
  onSaved,
  onDeleted,
}: AdminSkillEditorProps): React.ReactElement {
  const [form, setForm] = React.useState(() => initialForm(skill, categories))
  const [tagsText, setTagsText] = React.useState(skill?.tags.join(', ') ?? '')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setForm(initialForm(skill, categories))
    setTagsText(skill?.tags.join(', ') ?? '')
    setError(null)
  }, [categories, skill])

  const setField = <K extends keyof AdminSkillWriteInput>(key: K, value: AdminSkillWriteInput[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const input = {
      ...form,
      tags: [...new Set(tagsText.split(',').map((tag) => tag.trim()).filter(Boolean))],
    }
    try {
      const saved = skill
        ? await updateAdminSkill(skill.id, skill.revision, input, csrfToken)
        : await createAdminSkill(input, csrfToken)
      onSaved(saved)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Skill 草稿保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!skill || !window.confirm(`确认删除草稿“${skill.name}”？历史记录仍会保留。`)) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteAdminSkill(skill.id, skill.revision, csrfToken)
      onDeleted(skill.id)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Skill 草稿删除失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => { void submit(event) }} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="admin-step">{skill ? `REVISION ${skill.revision}` : 'NEW DOSSIER'}</div>
          <h2 className="mt-2 font-display text-3xl font-semibold text-[var(--ink)]">
            {skill ? '编辑 Skill 草稿' : '新建 Skill 草稿'}
          </h2>
        </div>
        {skill && <span className="admin-status-pill">{skill.status}</span>}
      </div>

      {error && <div role="alert" className="admin-alert">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="admin-compact-field">
          <span>Identifier</span>
          <input value={form.identifier} onChange={(event) => setField('identifier', event.target.value)} placeholder="daily-briefing" required />
        </label>
        <label className="admin-compact-field">
          <span>Skill 名称</span>
          <input value={form.name} onChange={(event) => setField('name', event.target.value)} required />
        </label>
      </div>
      <label className="admin-compact-field">
        <span>一句话简介</span>
        <input value={form.tagline} onChange={(event) => setField('tagline', event.target.value)} required />
      </label>
      <label className="admin-compact-field">
        <span>完整描述</span>
        <textarea rows={4} value={form.description} onChange={(event) => setField('description', event.target.value)} required />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="admin-compact-field">
          <span>作者</span>
          <input value={form.authorName} onChange={(event) => setField('authorName', event.target.value)} required />
        </label>
        <label className="admin-compact-field">
          <span>作者主页</span>
          <input type="url" value={form.authorUrl ?? ''} onChange={(event) => setField('authorUrl', event.target.value)} placeholder="https://" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="admin-compact-field">
          <span>分类</span>
          <select value={form.categoryId} onChange={(event) => setField('categoryId', event.target.value)} required>
            <option value="" disabled>选择分类</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="admin-compact-field sm:col-span-2">
          <span>标签</span>
          <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="自动化, 简报" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="admin-compact-field">
          <span>图标</span>
          <input value={form.icon} onChange={(event) => setField('icon', event.target.value)} placeholder="workflow" required />
        </label>
        <label className="flex h-12 items-center gap-3 rounded-2xl bg-white/70 px-4 text-xs font-semibold text-[var(--muted)] shadow-[inset_0_0_0_1px_rgba(16,35,61,0.1)]">
          <input type="checkbox" checked={form.featured} onChange={(event) => setField('featured', event.target.checked)} /> 精选 Skill
        </label>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-[rgba(16,35,61,0.09)] pt-5">
        <button type="submit" disabled={submitting} className="admin-primary-button max-w-[220px]">
          {submitting ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}
          {skill ? '保存修改' : '保存草稿'}
        </button>
        {skill && (
          <button type="button" disabled={submitting} onClick={() => { void remove() }} className="admin-danger-button">
            <ArchiveX size={16} /> 删除草稿
          </button>
        )}
      </div>
    </form>
  )
}
