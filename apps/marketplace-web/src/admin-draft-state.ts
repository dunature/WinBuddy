import { atom } from 'jotai'
import type { MarketplaceAdminSkillDetail, MarketplaceAdminSkillSummary, MarketplaceCategory } from '@proma/shared'

export type AdminDraftLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AdminDraftWorkspaceState {
  status: AdminDraftLoadStatus
  items: MarketplaceAdminSkillSummary[]
  categories: MarketplaceCategory[]
  selectedSkill: MarketplaceAdminSkillDetail | null
  creating: boolean
  error: string | null
}

export const adminDraftWorkspaceAtom = atom<AdminDraftWorkspaceState>({
  status: 'idle',
  items: [],
  categories: [],
  selectedSkill: null,
  creating: false,
  error: null,
})
