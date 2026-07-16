import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileCode2, Rocket, XCircle } from 'lucide-react'
import type { MarketplaceEditablePublishMetadata, MarketplaceSubmissionDetail } from '@proma/shared'
import { marketplaceApi } from '../lib/api-client.ts'

const CATEGORIES = ['research', 'productivity', 'content', 'design', 'data-ai', 'devops', 'writing']

export function AdminReviewPage(): React.ReactElement {
  const [detail, setDetail] = React.useState<MarketplaceSubmissionDetail | null>(null)
  const [selectedPath, setSelectedPath] = React.useState('SKILL.md')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState('')
  const [metadata, setMetadata] = React.useState<MarketplaceEditablePublishMetadata | null>(null)

  const load = React.useCallback(async () => {
    const rows = (await marketplaceApi.listSubmissions()).filter((row) => ['pending_review', 'approved', 'publish_failed'].includes(row.status))
    const next = rows[0] ? await marketplaceApi.getSubmission(rows[0].id) : null
    setDetail(next)
    setMetadata(next ? metadataFrom(next) : null)
  }, [])

  React.useEffect(() => { void load() }, [load])

  async function decide(decision: 'approve' | 'reject'): Promise<void> {
    if (decision === 'reject' && !reason.trim()) { setError('驳回原因不能为空'); return }
    if (decision === 'approve' && !metadata) { setError('发布元数据不完整'); return }
    try {
      setError('')
      await marketplaceApi.decideSubmission(detail!.id, {
        decision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(decision === 'approve' && metadata ? { metadata } : {}),
      })
      await load()
    } catch (value) {
      setError(value instanceof Error ? value.message : '审核操作失败')
    }
  }

  if (!detail || !metadata) return <main className="admin-page"><div className="admin-empty">当前没有待审核提交</div></main>
  const file = detail.files?.find((item) => item.path === selectedPath)

  return <main className="admin-page admin-review-page">
    <header className="admin-review-header"><div><p className="admin-kicker">SUBMISSION #{detail.id.slice(0, 8)}</p><h1>审核上传：{metadata.displayName || detail.fileName}</h1><p>@{detail.submittedBy} · {new Date(detail.createdAt).toLocaleString('zh-CN')}</p></div><span className="admin-status">待审核</span></header>
    <div className="admin-review-flow"><span><CheckCircle2 />上传完成</span><span><CheckCircle2 />自动校验</span><span className="active"><FileCode2 />人工审核</span><span><Rocket />发布上线</span></div>
    <div className="admin-review-grid">
      <section className="admin-file-review"><aside>{detail.files?.map((item) => <button key={item.path} className={selectedPath === item.path ? 'active' : ''} onClick={() => setSelectedPath(item.path)}>{item.path}</button>)}</aside><article><header>{selectedPath}</header><pre>{file?.content ?? '该文件不支持文本预览'}</pre></article></section>
      <aside className="admin-review-panel">
        <h2>发布元数据</h2>
        <ReadonlyField label="slug" value={String(detail.manifest?.name ?? '')} />
        <ReadonlyField label="version" value={String(detail.manifest?.version ?? '')} />
        <EditableField label="display_name" value={metadata.displayName} onChange={(displayName) => setMetadata({ ...metadata, displayName })} />
        <EditableField label="description" value={metadata.description} onChange={(description) => setMetadata({ ...metadata, description })} />
        <EditableField label="author.handle" value={metadata.authorHandle} onChange={(authorHandle) => setMetadata({ ...metadata, authorHandle })} />
        <EditableField label="author.name" value={metadata.authorName} onChange={(authorName) => setMetadata({ ...metadata, authorName })} />
        <label><span>category</span><select value={metadata.category} onChange={(event) => setMetadata({ ...metadata, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <h2>自动校验报告</h2>
        {detail.validationIssues.length === 0 ? <p className="review-ok"><CheckCircle2 />全部规则通过</p> : detail.validationIssues.map((issue) => <p key={`${issue.code}-${issue.path}`} className={issue.severity === 'error' ? 'review-error' : 'review-warning'}><AlertTriangle />{issue.message}</p>)}
        <label><span>审核备注 / 驳回原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      </aside>
    </div>
    {error && <p className="admin-inline-error"><AlertTriangle />{error}</p>}
    <footer className="admin-review-actions"><button onClick={() => void decide('reject')}><XCircle />驳回上传</button><button className="primary" onClick={() => void decide('approve')}><Rocket />批准并发布</button></footer>
  </main>
}

function ReadonlyField({ label, value }: { label: string; value: string }): React.ReactElement {
  return <label><span>{label}</span><input readOnly value={value} /></label>
}

function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.ReactElement {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function metadataFrom(detail: MarketplaceSubmissionDetail): MarketplaceEditablePublishMetadata {
  const author = record(detail.manifest?.author)
  return {
    authorHandle: String(author.handle ?? ''),
    authorName: String(author.name ?? ''),
    category: String(detail.manifest?.category ?? 'productivity'),
    displayName: String(detail.manifest?.display_name ?? ''),
    description: String(detail.manifest?.description ?? ''),
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
