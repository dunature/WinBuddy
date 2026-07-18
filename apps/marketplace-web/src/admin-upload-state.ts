import { atom } from 'jotai'
import type { MarketplaceAdminUpload } from '@proma/shared'

export type AdminUploadPhase = 'idle' | 'loading' | 'uploading' | 'ready' | 'error'

export interface AdminVersionUploadState {
  phase: AdminUploadPhase
  items: MarketplaceAdminUpload[]
  error: string | null
}

export const adminVersionUploadsAtom = atom<Map<string, AdminVersionUploadState>>(new Map())

export function needsAdminUploadPolling(items: MarketplaceAdminUpload[]): boolean {
  return items.some((item) => item.status === 'queued' || item.status === 'running')
}

export function mergeAdminUploadState(
  state: Map<string, AdminVersionUploadState>,
  versionId: string,
  upload: MarketplaceAdminUpload,
): Map<string, AdminVersionUploadState> {
  const next = new Map(state)
  const current = state.get(versionId) ?? { phase: 'idle', items: [], error: null }
  const existingIndex = current.items.findIndex((item) => item.id === upload.id)
  const items = existingIndex < 0
    ? [upload, ...current.items]
    : current.items.map((item, index) => index === existingIndex ? upload : item)
  next.set(versionId, { phase: 'ready', items, error: null })
  return next
}
