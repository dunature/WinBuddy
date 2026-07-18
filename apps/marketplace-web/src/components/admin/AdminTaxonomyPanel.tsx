import * as React from 'react'
import { LoaderCircle, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import type { MarketplaceAdminCategory, MarketplaceAdminTag } from '@proma/shared'
import {
  createAdminCategory,
  createAdminTag,
  deleteAdminCategory,
  deleteAdminTag,
  updateAdminCategory,
  updateAdminTag,
} from '../../admin-api'
import { MarketplaceRequestError } from '../../api'

interface AdminTaxonomyPanelProps {
  categories: MarketplaceAdminCategory[]
  tags: MarketplaceAdminTag[]
  csrfToken: string
  onChanged(categories: MarketplaceAdminCategory[], tags: MarketplaceAdminTag[]): void
}

interface EditingState {
  kind: 'category' | 'tag'
  id: string
  name: string
  icon: string
}

const taxonomyInputClass = 'min-w-0 flex-1 rounded-xl bg-white/[0.09] px-3 py-2 text-sm text-white outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] placeholder:text-white/30 focus:bg-white/[0.13] focus:shadow-[inset_0_0_0_2px_rgba(110,231,183,0.55)]'

function actionError(error: unknown): string {
  if (error instanceof MarketplaceRequestError
    && error.details && typeof error.details === 'object' && 'referenceCount' in error.details) {
    return `${error.message}（引用 ${(error.details as { referenceCount: number }).referenceCount} 个 Skill）`
  }
  return error instanceof Error ? error.message : '分类标签操作失败'
}

export function AdminTaxonomyPanel({
  categories,
  tags,
  csrfToken,
  onChanged,
}: AdminTaxonomyPanelProps): React.ReactElement {
  const [categoryName, setCategoryName] = React.useState('')
  const [categoryIcon, setCategoryIcon] = React.useState('folder')
  const [tagName, setTagName] = React.useState('')
  const [editing, setEditing] = React.useState<EditingState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      await action()
    } catch (requestError) {
      setError(actionError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const createCategory = (): void => {
    if (!categoryName.trim() || !categoryIcon.trim()) return
    void run(async () => {
      const created = await createAdminCategory({ name: categoryName, icon: categoryIcon }, csrfToken)
      onChanged([...categories, created], tags)
      setCategoryName('')
    })
  }

  const createTag = (): void => {
    if (!tagName.trim()) return
    void run(async () => {
      const created = await createAdminTag(tagName, csrfToken)
      onChanged(categories, [...tags, created])
      setTagName('')
    })
  }

  const saveEditing = (): void => {
    if (!editing?.name.trim()) return
    void run(async () => {
      if (editing.kind === 'category') {
        const current = categories.find((item) => item.id === editing.id)
        if (!current) return
        const updated = await updateAdminCategory(current.id, {
          revision: current.revision, name: editing.name, icon: editing.icon,
        }, csrfToken)
        onChanged(categories.map((item) => item.id === updated.id ? updated : item), tags)
      } else {
        const current = tags.find((item) => item.id === editing.id)
        if (!current) return
        const updated = await updateAdminTag(current.id, current.revision, editing.name, csrfToken)
        onChanged(categories, tags.map((item) => item.id === updated.id ? updated : item))
      }
      setEditing(null)
    })
  }

  const removeCategory = (category: MarketplaceAdminCategory): void => {
    if (!window.confirm(`确认删除分类“${category.name}”？`)) return
    void run(async () => {
      await deleteAdminCategory(category.id, category.revision, csrfToken)
      onChanged(categories.filter((item) => item.id !== category.id), tags)
    })
  }

  const removeTag = (tag: MarketplaceAdminTag): void => {
    if (!window.confirm(`确认删除标签“${tag.name}”？`)) return
    void run(async () => {
      await deleteAdminTag(tag.id, tag.revision, csrfToken)
      onChanged(categories, tags.filter((item) => item.id !== tag.id))
    })
  }

  const renderEdit = (item: MarketplaceAdminCategory | MarketplaceAdminTag): React.ReactElement | null => {
    if (!editing || editing.id !== item.id) return null
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={taxonomyInputClass} aria-label={`重命名 ${item.name}`} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
        {editing.kind === 'category' && (
          <input className={taxonomyInputClass} aria-label={`更新 ${item.name} 图标`} value={editing.icon} onChange={(event) => setEditing({ ...editing, icon: event.target.value })} />
        )}
        <button type="button" className="admin-primary-button max-w-[110px]" disabled={submitting} onClick={saveEditing}><Save size={14} /> 保存</button>
        <button type="button" className="admin-secondary-button" onClick={() => setEditing(null)}><X size={14} /> 取消</button>
      </div>
    )
  }

  return (
    <section className="mb-4 grid gap-4 lg:grid-cols-2" aria-label="分类标签管理">
      {error && <div role="alert" className="admin-alert lg:col-span-2">{error}</div>}
      <div className="rounded-[24px] bg-white/[0.055] p-4">
        <h2 className="font-display text-xl font-semibold">分类管理</h2>
        <div className="mt-3 flex gap-2">
          <input className={taxonomyInputClass} aria-label="新分类名称" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="分类名称" />
          <input className={taxonomyInputClass} aria-label="新分类图标" value={categoryIcon} onChange={(event) => setCategoryIcon(event.target.value)} placeholder="图标" />
          <button type="button" className="admin-primary-button max-w-[140px]" disabled={submitting || !categoryName.trim()} onClick={createCategory}>
            {submitting ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />} 创建分类
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {categories.length === 0 ? <p className="py-5 text-center text-xs text-white/40">暂无分类</p> : categories.map((category) => (
            <article key={category.id} className="rounded-2xl bg-white/[0.05] p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold">{category.name}</span>
                <span className="text-[10px] text-white/40">{category.referenceCount} 个引用</span>
                <button type="button" aria-label={`编辑分类 ${category.name}`} onClick={() => setEditing({ kind: 'category', id: category.id, name: category.name, icon: category.icon })}><Pencil size={14} /></button>
                <button type="button" aria-label={`删除分类 ${category.name}`} onClick={() => removeCategory(category)}><Trash2 size={14} /></button>
              </div>
              {renderEdit(category)}
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-[24px] bg-white/[0.055] p-4">
        <h2 className="font-display text-xl font-semibold">标签管理</h2>
        <div className="mt-3 flex gap-2">
          <input className={taxonomyInputClass} aria-label="新标签名称" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="标签名称" />
          <button type="button" className="admin-primary-button max-w-[140px]" disabled={submitting || !tagName.trim()} onClick={createTag}>
            {submitting ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />} 创建标签
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {tags.length === 0 ? <p className="py-5 text-center text-xs text-white/40">暂无标签</p> : tags.map((tag) => (
            <article key={tag.id} className="rounded-2xl bg-white/[0.05] p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold">{tag.name}</span>
                <span className="text-[10px] text-white/40">{tag.referenceCount} 个引用</span>
                <button type="button" aria-label={`编辑标签 ${tag.name}`} onClick={() => setEditing({ kind: 'tag', id: tag.id, name: tag.name, icon: '' })}><Pencil size={14} /></button>
                <button type="button" aria-label={`删除标签 ${tag.name}`} onClick={() => removeTag(tag)}><Trash2 size={14} /></button>
              </div>
              {renderEdit(tag)}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
