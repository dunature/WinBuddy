import * as React from 'react'
import { useAtom } from 'jotai'
import { CheckCircle2, FileArchive, LoaderCircle, UploadCloud, XCircle } from 'lucide-react'
import type { MarketplaceAdminUpload, MarketplaceAdminVersion, MarketplaceValidationCheck } from '@proma/shared'
import { getAdminUpload, listAdminUploads, uploadAdminVersion } from '../../admin-api'
import {
  adminVersionUploadsAtom,
  mergeAdminUploadState,
  needsAdminUploadPolling,
  type AdminVersionUploadState,
} from '../../admin-upload-state'

interface AdminVersionUploadPanelProps {
  skillId: string
  version: MarketplaceAdminVersion
  csrfToken: string
  onVersionChanged(upload: MarketplaceAdminUpload): void
}

const emptyState: AdminVersionUploadState = { phase: 'idle', items: [], error: null }
const maxUploadBytes = 20 * 1024 * 1024

const uploadStatusText = {
  queued: '等待校验',
  running: '正在校验',
  succeeded: '校验通过',
  failed: '校验失败',
} as const

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 600)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
}

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ValidationCheckList({ checks }: { checks: MarketplaceValidationCheck[] }): React.ReactElement {
  return (
    <ul className="mt-3 grid gap-2 md:grid-cols-2">
      {checks.map((check, index) => (
        <li key={`${check.code}-${check.path ?? index}`} className={`admin-validation-check ${check.passed ? 'is-passed' : 'is-failed'}`}>
          {check.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span className="min-w-0"><strong>{check.message}</strong><small>{check.code}{check.path ? ` · ${check.path}` : ''}</small></span>
        </li>
      ))}
    </ul>
  )
}

export function AdminVersionUploadPanel({
  skillId,
  version,
  csrfToken,
  onVersionChanged,
}: AdminVersionUploadPanelProps): React.ReactElement {
  const [uploads, setUploads] = useAtom(adminVersionUploadsAtom)
  const state = uploads.get(version.id) ?? emptyState
  const [file, setFile] = React.useState<File | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const lifecycle = React.useRef<AbortController | null>(null)

  const setState = React.useCallback((next: AdminVersionUploadState): void => {
    setUploads((current) => {
      const updated = new Map(current)
      updated.set(version.id, next)
      return updated
    })
  }, [setUploads, version.id])

  const patchState = React.useCallback((patch: Partial<AdminVersionUploadState>): void => {
    setUploads((current) => {
      const updated = new Map(current)
      const existing = current.get(version.id) ?? emptyState
      updated.set(version.id, { ...existing, ...patch })
      return updated
    })
  }, [setUploads, version.id])

  const pollUpload = React.useCallback(async (
    uploadId: string,
    signal: AbortSignal,
  ): Promise<void> => {
    while (!signal.aborted) {
      const upload = await getAdminUpload(skillId, version.id, uploadId, signal)
      setUploads((current) => mergeAdminUploadState(current, version.id, upload))
      onVersionChanged(upload)
      if (upload.status === 'succeeded' || upload.status === 'failed') return
      await waitForNextPoll(signal)
    }
  }, [onVersionChanged, setUploads, skillId, version.id])

  React.useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    const restore = async (): Promise<void> => {
      patchState({ phase: 'loading', error: null })
      try {
        const items = await listAdminUploads(skillId, version.id, controller.signal)
        if (controller.signal.aborted) return
        setState({ phase: 'ready', items, error: null })
        if (needsAdminUploadPolling(items)) {
          await Promise.all(items
            .filter((item) => item.status === 'queued' || item.status === 'running')
            .map((item) => pollUpload(item.id, controller.signal)))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        patchState({
          phase: 'error',
          error: error instanceof Error ? error.message : '上传记录加载失败',
        })
      }
    }
    void restore()
    return () => {
      controller.abort()
      if (lifecycle.current === controller) lifecycle.current = null
    }
  }, [patchState, pollUpload, setState, skillId, version.id])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!file) return
    if (file.size > maxUploadBytes) {
      patchState({ phase: 'error', error: 'ZIP 不能超过 20 MB' })
      return
    }
    patchState({ phase: 'uploading', error: null })
    try {
      const accepted = await uploadAdminVersion(skillId, version.id, file, csrfToken)
      setUploads((current) => mergeAdminUploadState(current, version.id, accepted))
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      const controller = lifecycle.current ?? new AbortController()
      await pollUpload(accepted.id, controller.signal)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setUploads((current) => {
        const updated = new Map(current)
        const latest = current.get(version.id) ?? emptyState
        updated.set(version.id, {
          ...latest,
          phase: 'error',
          error: error instanceof Error ? error.message : 'Skill 包上传失败',
        })
        return updated
      })
    }
  }

  const latest = state.items[0] ?? null
  const uploadable = version.allowedActions.includes('reupload')
  const busy = state.phase === 'uploading' || needsAdminUploadPolling(state.items)

  return (
    <div className="mt-4 rounded-[18px] bg-white/55 p-4 shadow-[0_12px_30px_rgba(16,35,61,0.07)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--ink)]"><FileArchive size={15} /> Skill 包校验</div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">ZIP 最大 20 MB；上传后由服务端逐项检查路径、体积与 manifest。</p>
        </div>
        <form onSubmit={(event) => { void submit(event) }} className="flex flex-wrap items-center justify-end gap-2">
          <label className="admin-upload-picker">
            <span>{file ? file.name : '选择 ZIP'}</span>
            <input
              ref={inputRef}
              aria-label={`Skill ZIP 包 ${version.version}`}
              type="file"
              accept=".zip,application/zip,application/octet-stream"
              disabled={busy || !uploadable}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" className="admin-secondary-button" disabled={!file || busy || !uploadable}>
            {busy ? <LoaderCircle className="animate-spin" size={15} /> : <UploadCloud size={15} />}
            {state.items.length > 0 ? '重新上传' : '上传校验'}
          </button>
        </form>
      </div>

      {!uploadable && <p className="mt-3 text-[11px] text-[var(--muted)]">当前版本状态不可重新上传。</p>}

      {state.phase === 'loading' && state.items.length === 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]"><LoaderCircle className="animate-spin" size={14} /> 正在恢复上传记录</div>
      )}
      {state.error && <div role="alert" className="admin-alert mt-4">{state.error}</div>}

      {latest && (
        <div className="mt-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`admin-validation-pill admin-validation-${latest.status}`}>
              {(latest.status === 'queued' || latest.status === 'running') && <LoaderCircle className="animate-spin" size={12} />}
              {latest.status === 'succeeded' && <CheckCircle2 size={12} />}
              {latest.status === 'failed' && <XCircle size={12} />}
              {uploadStatusText[latest.status]}
            </span>
            <span className="font-mono text-[10px] text-[var(--muted)]">{latest.originalFilename} · {readableBytes(latest.size)} · {latest.sha256.slice(0, 12)}</span>
          </div>

          {latest.report && <ValidationCheckList checks={latest.report.checks} />}

          {state.items.length > 1 && (
            <details className="mt-3 text-xs text-[var(--muted)]">
              <summary className="cursor-pointer font-bold">历史上传记录（{state.items.length - 1}）</summary>
              <div className="mt-2 space-y-1.5">
                {state.items.slice(1).map((item) => (
                  <details key={item.id} className="rounded-xl bg-[rgba(16,35,61,0.045)] px-3 py-2">
                    <summary className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="truncate">{item.originalFilename}</span>
                      <span>{uploadStatusText[item.status]}</span>
                    </summary>
                    {item.report && <ValidationCheckList checks={item.report.checks} />}
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
