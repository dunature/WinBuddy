import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { CheckCheck, LoaderCircle, Rocket, Send, type LucideIcon } from 'lucide-react'
import type {
  MarketplaceAdminSkillDetail,
  MarketplaceAdminVersion,
  MarketplaceGoldenPathAction,
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

const emptyState: AdminPublishActionState = { phase: 'idle', message: null, error: null }

const actionDetails: Record<MarketplaceGoldenPathAction, {
  label: string
  success: string
  icon: LucideIcon
}> = {
  submit_review: { label: '提交审核', success: '已提交审核', icon: Send },
  approve: { label: '批准版本', success: '版本已批准', icon: CheckCheck },
  publish: { label: '发布上线', success: '版本已发布，公开市场现已可见', icon: Rocket },
}

function nextAction(version: MarketplaceAdminVersion): MarketplaceGoldenPathAction | null {
  if (version.status === 'created') return 'submit_review'
  if (version.status === 'pending_review') return 'approve'
  if (version.status === 'approved') return 'publish'
  return null
}

export function AdminVersionActions({
  skillId,
  version,
  csrfToken,
  onCompleted,
}: AdminVersionActionsProps): React.ReactElement {
  const [actions, setActions] = useAtom(adminPublishActionsAtom)
  const uploads = useAtomValue(adminVersionUploadsAtom)
  const state = actions.get(version.id) ?? emptyState
  const action = nextAction(version)
  const details = action ? actionDetails[action] : null
  const latestUpload = uploads.get(version.id)?.items[0]
  const validationPassed = latestUpload?.status === 'succeeded' && latestUpload.report?.passed === true
  const disabled = state.phase === 'submitting' || (action === 'submit_review' && !validationPassed)

  const submit = async (): Promise<void> => {
    if (!action || !details) return
    setActions((current) => {
      const next = new Map(current)
      next.set(version.id, { phase: 'submitting', message: null, error: null })
      return next
    })
    try {
      const result = await performAdminVersionAction(skillId, version.id, action, csrfToken)
      setActions((current) => completeAdminPublishAction(current, version.id, details.success))
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

  if (!action || !details) {
    return version.status === 'published'
      ? <div className="mt-3 text-xs font-bold text-emerald-700">{state.message ?? '当前版本已发布上线'}</div>
      : <></>
  }
  const Icon = details.icon
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3" aria-live="polite">
      <button type="button" className="admin-primary-button" disabled={disabled} onClick={() => { void submit() }}>
        {state.phase === 'submitting' ? <LoaderCircle className="animate-spin" size={15} /> : <Icon size={15} />}
        {details.label}
      </button>
      {action === 'submit_review' && !validationPassed && (
        <span className="text-[11px] text-[var(--muted)]">Skill 包校验通过后可提交审核。</span>
      )}
      {state.message && <span className="text-xs font-bold text-emerald-700">{state.message}</span>}
      {state.error && <span role="alert" className="text-xs font-bold text-red-700">{state.error}</span>}
    </div>
  )
}
