import * as React from 'react'
import { useAtom } from 'jotai'
import { Archive, LoaderCircle, RotateCcw, Trash2, X, EyeOff } from 'lucide-react'
import type { MarketplaceBulkGovernanceAction, MarketplaceBulkGovernanceTarget } from '@proma/shared'
import { performAdminBulkGovernance } from '../../admin-api'
import {
  adminBulkSelectionAtom,
  adminBulkStateAtom,
  retryableBulkTargets,
} from '../../admin-bulk-state'

interface AdminBulkBarProps {
  csrfToken: string
  onCompleted(): void
}

const actionLabels: Record<MarketplaceBulkGovernanceAction, string> = {
  unpublish: '批量下架',
  archive: '批量归档',
  delete_draft: '删除草稿',
}

export function AdminBulkBar({ csrfToken, onCompleted }: AdminBulkBarProps): React.ReactElement | null {
  const [selection, setSelection] = useAtom(adminBulkSelectionAtom)
  const [state, setState] = useAtom(adminBulkStateAtom)
  const [reason, setReason] = React.useState('')

  const execute = async (
    action: MarketplaceBulkGovernanceAction,
    targets: MarketplaceBulkGovernanceTarget[],
  ): Promise<void> => {
    if (!reason.trim() || targets.length === 0) return
    setState({ phase: 'submitting', action, result: null, error: null })
    try {
      const result = await performAdminBulkGovernance(action, targets, reason.trim(), csrfToken)
      setState({ phase: 'complete', action, result, error: null })
      setSelection(new Map(retryableBulkTargets(result).map((target) => [target.key, target])))
      onCompleted()
    } catch (error) {
      setState({
        phase: 'error', action, result: null,
        error: error instanceof Error ? error.message : '批量治理失败',
      })
    }
  }

  const clear = (): void => {
    setSelection(new Map())
    setState({ phase: 'idle', action: null, result: null, error: null })
    setReason('')
  }

  if (selection.size === 0 && !state.result && !state.error) return null
  const selectedTargets = [...selection.values()]
  return (
    <section className="sticky bottom-4 z-20 mb-4 rounded-[22px] bg-[#10233d] p-4 text-white shadow-[0_22px_60px_rgba(3,12,25,0.35)]" aria-label="批量治理栏">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-sm">已选择 {selection.size} 项</strong>
        <input
          aria-label="批量治理原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="填写本次治理原因"
          className="min-w-[220px] flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/35"
        />
        <button type="button" className="admin-secondary-button bg-white/10 text-white" disabled={state.phase === 'submitting' || !reason.trim()} onClick={() => { void execute('unpublish', selectedTargets) }}><EyeOff size={14} /> 批量下架</button>
        <button type="button" className="admin-secondary-button bg-white/10 text-white" disabled={state.phase === 'submitting' || !reason.trim()} onClick={() => { void execute('archive', selectedTargets) }}><Archive size={14} /> 批量归档</button>
        <button type="button" className="admin-danger-button" disabled={state.phase === 'submitting' || !reason.trim()} onClick={() => { void execute('delete_draft', selectedTargets) }}><Trash2 size={14} /> 删除草稿</button>
        <button type="button" aria-label="清空批量选择" onClick={clear}><X size={17} /></button>
      </div>
      {state.phase === 'submitting' && <p className="mt-3 flex items-center gap-2 text-xs text-white/60"><LoaderCircle className="animate-spin" size={14} /> 正在逐项执行，已完成条目不会被其他失败回滚</p>}
      {state.error && <p role="alert" className="mt-3 text-xs font-semibold text-red-300">{state.error}<button type="button" className="ml-3 underline" onClick={() => { if (state.action) void execute(state.action, selectedTargets) }}>重试本次批量操作</button></p>}
      {state.result && (
        <div className="mt-3 rounded-2xl bg-white/[0.07] p-3 text-xs">
          <div className="font-semibold">
            成功 {state.result.succeeded.length} · 跳过 {state.result.skipped.length} · 失败 {state.result.failed.length}
          </div>
          {state.result.failed.length > 0 && (
            <>
              <ul className="mt-2 space-y-1 text-red-200">
                {state.result.failed.map((item) => <li key={item.key}>{item.label ?? item.key}：{item.code} · {item.message}</li>)}
              </ul>
              {retryableBulkTargets(state.result).length > 0 && (
                <button
                  type="button"
                  className="admin-secondary-button mt-3 bg-white/10 text-white"
                  disabled={state.phase === 'submitting' || !state.action}
                  onClick={() => { if (state.action && state.result) void execute(state.action, retryableBulkTargets(state.result)) }}
                >
                  <RotateCcw size={14} /> 仅重试可重试项
                </button>
              )}
            </>
          )}
          {state.result.skipped.length > 0 && (
            <ul className="mt-2 space-y-1 text-amber-100">
              {state.result.skipped.map((item) => <li key={item.key}>{item.label ?? item.key}：{item.code}</li>)}
            </ul>
          )}
          <span className="sr-only">{actionLabels[state.result.action]}执行完成</span>
        </div>
      )}
    </section>
  )
}
