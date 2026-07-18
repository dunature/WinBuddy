import { atom } from 'jotai'
import type {
  MarketplaceAdminCategory,
  MarketplaceAdminSkillDetail,
  MarketplaceAdminSkillSummary,
  MarketplaceAdminTag,
} from '@proma/shared'

export type AdminDraftLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AdminDraftWorkspaceState {
  status: AdminDraftLoadStatus
  items: MarketplaceAdminSkillSummary[]
  categories: MarketplaceAdminCategory[]
  tags: MarketplaceAdminTag[]
  selectedSkill: MarketplaceAdminSkillDetail | null
  creating: boolean
  error: string | null
}

export const adminDraftWorkspaceAtom = atom<AdminDraftWorkspaceState>({
  status: 'idle',
  items: [],
  categories: [],
  tags: [],
  selectedSkill: null,
  creating: false,
  error: null,
})
