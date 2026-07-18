import { atom } from 'jotai'

export type AdminPublishPhase = 'idle' | 'submitting' | 'success' | 'error'

export interface AdminPublishActionState {
  phase: AdminPublishPhase
  message: string | null
  error: string | null
}

export const adminPublishActionsAtom = atom<Map<string, AdminPublishActionState>>(new Map())

export function completeAdminPublishAction(
  state: Map<string, AdminPublishActionState>,
  versionId: string,
  message: string,
): Map<string, AdminPublishActionState> {
  const next = new Map(state)
  next.set(versionId, { phase: 'success', message, error: null })
  return next
}
