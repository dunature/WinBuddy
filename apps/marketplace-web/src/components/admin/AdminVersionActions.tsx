import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  Archive,
  CheckCheck,
  EyeOff,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  Rocket,
  Send,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type {
  MarketplaceAdminSkillDetail,
  MarketplaceAdminVersion,
  MarketplaceVersionGovernanceAction,
} from '@proma/shared'
import { performAdminVersionAction } from '../../admin-api'
import {
  adminPublishActionsAtom,
  completeAdminPublishAction,
  type AdminPublishActionState,
} from '../../admin-publish-state'
import { adminVersionUploadsAtom } from '../../admin-upload-state'

interface AdminVersionActionsProps {
  skillId: string
  version: MarketplaceAdminVersion
  csrfToken: string
  onCompleted(skill: MarketplaceAdminSkillDetail): void
}

interface ActionDetails {
  label: string
  success: string
  icon: LucideIcon
  requiresReason?: boolean
  destructive?: boolean
}

const emptyState: AdminPublishActionState = { phase: 'idle', message: null, error: null }

const actionDetails: Record<MarketplaceVersionGovernanceAction, ActionDetails> = {
  submit_review: { label: '提交审核', success: '已提交审核', icon: Send },
  approve: { label: '批准版本', success: '版本已批准', icon: CheckCheck },
  reject: { label: '驳回', success: '版本已驳回', icon: XCircle, requiresReason: true, destructive: true },
  return_to_edit: { label: '返回编辑', success: '版本已返回编辑', icon: PencilLine, requiresReason: true },
  withdraw: { label: '撤回', success: '版本已撤回', icon: Undo2, requiresReason: true },
  publish: { label: '发布上线', success: '版本已发布，公开市场现已可见', icon: Rocket },
  unpublish: { label: '下架', success: '版本已下架', icon: EyeOff, requiresReason: true, destructive: true },
  republish: { label: '重新发布', success: '版本已重新发布', icon: RefreshCw },
  archive: { label: '归档', success: '版本已归档', icon: Archive, requiresReason: true, destructive: true },
}

function isGovernanceAction(action: MarketplaceAdminVersion['allowedActions'][number]): action is MarketplaceVersionGovernanceAction {
  return action !== 'reupload'
}

export function AdminVersionActions({
  skillId,
  version,
  csrfToken,
  onCompleted,
}: AdminVersionActionsProps): React.ReactElement {
  const [actions, setActions] = useAtom(adminPublishActionsAtom)
  const uploads = useAtomValue(adminVersionUploadsAtom)
  const [pendingAction, setPendingAction] = React.useState<MarketplaceVersionGovernanceAction | null>(null)
  const [reason, setReason] = React.useState('')
  const state = actions.get(version.id) ?? emptyState
  const availableActions = version.allowedActions.filter(isGovernanceAction)
  const latestUpload = uploads.get(version.id)?.items[0]
  const validationPassed = latestUpload?.status === 'succeeded' && latestUpload.report?.passed === true

  const execute = async (action: MarketplaceVersionGovernanceAction, actionReason = ''): Promise<void> => {
    const details = actionDetails[action]
    setActions((current) => {
      const next = new Map(current)
      next.set(version.id, { phase: 'submitting', message: null, error: null })
      return next
    })
    try {
      const result = await performAdminVersionAction(skillId, version.id, action, csrfToken, actionReason)
      setActions((current) => completeAdminPublishAction(current, version.id, details.success))
      setPendingAction(null)
      setReason('')
      onCompleted(result.skill)
    } catch (error) {
      setActions((current) => {
        const next = new Map(current)
        next.set(version.id, {
          phase: 'error',
          message: null,
          error: error instanceof Error ? error.message : '版本动作执行失败',
        })
        return next
      })
    }
  }

  const start = (action: MarketplaceVersionGovernanceAction): void => {
    if (actionDetails[action].requiresReason) {
      setPendingAction(action)
      setReason('')
      return
    }
    void execute(action)
  }

  if (availableActions.length === 0) {
    return state.message
      ? <div className="mt-3 text-xs font-bold text-emerald-700">{state.message}</div>
      : <></>
  }

  return (
    <div className="mt-3 space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        {availableActions.map((action) => {
          const details = actionDetails[action]
          const Icon = details.icon
          const isPrimary = version.nextAction === action && !details.destructive
          const disabled = state.phase === 'submitting'
            || (action === 'submit_review' && !validationPassed)
          return (
            <button
              key={action}
              type="button"
              className={details.destructive
                ? 'admin-danger-button'
                : isPrimary ? 'admin-primary-button' : 'admin-secondary-button'}
              disabled={disabled}
              onClick={() => start(action)}
            >
              {state.phase === 'submitting' ? <LoaderCircle className="animate-spin" size={15} /> : <Icon size={15} />}
              {details.label}
            </button>
          )
        })}
        {availableActions.includes('submit_review') && !validationPassed && (
          <span className="text-[11px] text-[var(--muted)]">Skill 包校验通过后可提交审核。</span>
        )}
      </div>

      {pendingAction && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-white/65 p-3">
          <label className="admin-compact-field min-w-[240px] flex-1">
            <span>{actionDetails[pendingAction].label}原因</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} autoFocus />
          </label>
          <button
            type="button"
            className={actionDetails[pendingAction].destructive ? 'admin-danger-button' : 'admin-primary-button'}
            disabled={!reason.trim() || state.phase === 'submitting'}
            onClick={() => { void execute(pendingAction, reason.trim()) }}
          >
            确认{actionDetails[pendingAction].label}
          </button>
          <button type="button" className="admin-secondary-button" onClick={() => setPendingAction(null)}>取消</button>
        </div>
      )}

      {state.message && <span className="text-xs font-bold text-emerald-700">{state.message}</span>}
      {state.error && <span role="alert" className="text-xs font-bold text-red-700">{state.error}</span>}
    </div>
  )
}
