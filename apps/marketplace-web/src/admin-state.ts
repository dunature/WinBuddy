import { atom } from 'jotai'
import type { MarketplaceAdminSession } from '@proma/shared'

export type AdminAuthStatus = 'idle' | 'loading' | 'unauthenticated' | 'must-change-password' | 'authenticated'

export interface AdminAuthState {
  status: AdminAuthStatus
  session: MarketplaceAdminSession | null
}

export const adminAuthAtom = atom<AdminAuthState>({ status: 'idle', session: null })

export function authenticatedAdminState(session: MarketplaceAdminSession): AdminAuthState {
  return {
    status: session.admin.mustChangePassword ? 'must-change-password' : 'authenticated',
    session,
  }
}
