import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, FolderOpen, ShieldCheck, UploadCloud } from 'lucide-react'
import type { MarketplaceSubmissionSummary } from '@proma/shared'
import { marketplaceApi } from '../lib/api-client.ts'

export function AdminUploadPage(): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [submissions, setSubmissions] = React.useState<MarketplaceSubmissionSummary[]>([])
  const [progress, setProgress] = React.useState<number | null>(null)
  const [error, setError] = React.useState('')
  const load = React.useCallback(() => marketplaceApi.listSubmissions().then(setSubmissions).catch(() => setError('最近提交读取失败')), [])
  React.useEffect(() => { void load() }, [load])

  async function upload(file: File): Promise<void> {
    setError('')
    if (!file.name.toLowerCase().endsWith('.zip') || file.size > 20 * 1024 * 1024) { setError('请选择不超过 20 MB 的 ZIP 文件'); return }
    try {
      setProgress(0)
      const created = await marketplaceApi.createSubmission({ fileName: file.name, size: file.size, idempotencyKey: crypto.randomUUID() })
      await uploadWithProgress(created.uploadUrl, file, setProgress)
      const sha256 = await hashFile(file)
      await marketplaceApi.completeSubmission(created.submission.id, sha256)
      setProgress(null)
      await load()
    } catch (uploadError) { setProgress(null); setError(uploadError instanceof Error ? uploadError.message : '上传失败，请重试') }
  }

  return <main className="admin-page"><header className="admin-page-header"><div><p className="admin-kicker">SUBMISSIONS</p><h1>上传中心</h1><p>上传 Skill ZIP，系统会在进入审核前完成结构与安全校验。</p></div><small>ZIP · 最大 20 MB</small></header><div className="admin-upload-grid"><button className="admin-dropzone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file) }}><span><UploadCloud size={28} /></span><strong>拖入 Skill ZIP</strong><small>或点击选择文件，上传后不会立即公开</small><em><FolderOpen size={16} />选择 ZIP 文件</em><input ref={inputRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} /></button><aside className="admin-checklist"><h2>上传前检查</h2>{['包含唯一的 SKILL.md','版本高于当前已发布版本','不包含密钥、路径穿越或危险链接','解压后不超过 50 MB'].map((item) => <p key={item}><ShieldCheck size={17} />{item}</p>)}</aside></div>{progress !== null && <div className="admin-progress" role="status"><div style={{ width: `${progress}%` }} /><span>正在安全上传… {progress}%</span></div>}{error && <p className="admin-inline-error" role="alert"><AlertTriangle size={17} />{error}</p>}<section className="admin-recent"><header><h2>最近提交</h2><span>{submissions.length} 条记录</span></header>{submissions.length === 0 ? <div className="admin-empty">尚无上传记录</div> : submissions.map((submission) => <div className="admin-submission-row" key={submission.id}><FileArchive size={19} /><div><strong>{submission.fileName}</strong><small>@{submission.submittedBy} · {new Date(submission.createdAt).toLocaleString('zh-CN')}</small></div><span className={`admin-status admin-status-${submission.status}`}>{submission.status === 'pending_review' ? <CheckCircle2 size={13} /> : null}{statusLabel(submission.status)}</span></div>)}</section></main>
}

function uploadWithProgress(url: string, file: File, onProgress: (progress: number) => void): Promise<void> { return new Promise((resolve, reject) => { const request = new XMLHttpRequest(); request.open('PUT', url); request.setRequestHeader('Content-Type', 'application/zip'); request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }; request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`OSS 上传失败（${request.status}）`)); request.onerror = () => reject(new Error('OSS 上传网络错误')); request.send(file) }) }
async function hashFile(file: File): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
function statusLabel(status: MarketplaceSubmissionSummary['status']): string { return ({ uploading: '上传中', validating: '校验中', validation_failed: '校验失败', pending_review: '待审核', rejected: '已驳回', approved: '已批准', publishing: '发布中', published: '已发布', publish_failed: '发布失败' })[status] }
