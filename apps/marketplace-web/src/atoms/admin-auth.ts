import { atom } from 'jotai'
import type { MarketplaceAdminSession } from '@proma/shared'

export const adminSessionAtom = atom<MarketplaceAdminSession | null>(null)
export const adminSessionLoadingAtom = atom(true)
