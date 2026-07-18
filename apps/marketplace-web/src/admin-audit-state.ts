import { atom } from 'jotai'
import type { MarketplaceAdminAuditEntry, MarketplaceAdminAuditQuery, MarketplacePage } from '@proma/shared'

export const initialAdminAuditQuery: MarketplaceAdminAuditQuery = {
  skillId: '', actor: '', action: '', from: '', to: '', page: 1, pageSize: 16,
}

export interface AdminAuditState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result: MarketplacePage<MarketplaceAdminAuditEntry> | null
  error: string | null
}

export const adminAuditQueryAtom = atom<MarketplaceAdminAuditQuery>(initialAdminAuditQuery)
export const adminAuditStateAtom = atom<AdminAuditState>({ status: 'idle', result: null, error: null })
export const adminAuditVisibleAtom = atom(false)

export function buildAdminAuditSearch(query: MarketplaceAdminAuditQuery): URLSearchParams {
  const search = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  for (const key of ['skillId', 'actor', 'action', 'from', 'to'] as const) {
    const value = query[key].trim()
    if (value) search.set(key, value)
  }
  return search
}
