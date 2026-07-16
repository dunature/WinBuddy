import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileCode2, Rocket, XCircle } from 'lucide-react'
import type { MarketplaceSubmissionDetail, MarketplaceSubmissionSummary } from '@proma/shared'
import { marketplaceApi } from '../lib/api-client.ts'

export function AdminReviewPage(): React.ReactElement {
  const [items, setItems] = React.useState<MarketplaceSubmissionSummary[]>([])
  const [detail, setDetail] = React.useState<MarketplaceSubmissionDetail | null>(null)
  const [selectedPath, setSelectedPath] = React.useState('SKILL.md')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState('')
  const load = React.useCallback(async () => { const rows = await marketplaceApi.listSubmissions(); setItems(rows.filter((row) => ['pending_review', 'approved', 'publish_failed'].includes(row.status))); if (!detail && rows[0]) setDetail(await marketplaceApi.getSubmission(rows[0].id)) }, [detail])
  React.useEffect(() => { void load().catch(() => setError('审核队列读取失败')) }, [load])
  async function decide(decision: 'approve' | 'reject') { if (decision === 'reject' && !reason.trim()) { setError('驳回原因不能为空'); return } try { setError(''); await marketplaceApi.decideSubmission(detail!.id, { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }); setDetail(null); await load() } catch (value) { setError(value instanceof Error ? value.message : '审核操作失败') } }
  if (!detail) return <main className="admin-page"><header className="admin-page-header"><div><p className="admin-kicker">REVIEW QUEUE</p><h1>审核队列</h1></div></header><div className="admin-empty">暂无待审核提交</div></main>
  const file = detail.files?.find((item) => item.path === selectedPath)
  return <main className="admin-page admin-review-page"><header className="admin-review-header"><div><p className="admin-kicker">SUBMISSION #{detail.id.slice(0, 8)}</p><h1>审核上传：{String(detail.manifest?.display_name ?? detail.fileName)}</h1><p>@{detail.submittedBy} · {new Date(detail.createdAt).toLocaleString('zh-CN')}</p></div><span className="admin-status">待审核</span></header><div className="admin-review-flow"><span><CheckCircle2 />上传完成</span><span><CheckCircle2 />自动校验</span><span className="active"><FileCode2 />人工审核</span><span><Rocket />发布上线</span></div><div className="admin-review-grid"><section className="admin-file-review"><aside>{detail.files?.map((item) => <button key={item.path} className={selectedPath === item.path ? 'active' : ''} onClick={() => setSelectedPath(item.path)}>{item.path}</button>)}</aside><article><header>{selectedPath}</header><pre>{file?.content ?? '该文件不支持文本预览'}</pre></article></section><aside className="admin-review-panel"><h2>发布元数据</h2>{['display_name','name','version','category'].map((key) => <label key={key}><span>{key}</span><input readOnly value={String(detail.manifest?.[key] ?? '')} /></label>)}<h2>自动校验报告</h2>{detail.validationIssues.length === 0 ? <p className="review-ok"><CheckCircle2 />全部规则通过</p> : detail.validationIssues.map((issue) => <p key={`${issue.code}-${issue.path}`} className={issue.severity === 'error' ? 'review-error' : 'review-warning'}><AlertTriangle />{issue.message}</p>)}<label><span>审核备注 / 驳回原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label></aside></div>{error && <p className="admin-inline-error"><AlertTriangle />{error}</p>}<footer className="admin-review-actions"><button onClick={() => void decide('reject')}><XCircle />驳回上传</button><button className="primary" onClick={() => void decide('approve')}><Rocket />批准并发布</button></footer></main>
}
