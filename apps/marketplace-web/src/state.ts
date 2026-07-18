import { atom } from 'jotai'
import type {
  MarketplaceCategory,
  MarketplacePageInfo,
  MarketplaceSkillDetail,
  MarketplaceSkillFile,
  MarketplaceSkillSummary,
} from '@proma/shared'
import type { MarketplaceRequestError } from './api'

export interface CatalogState {
  searchInput: string
  categories: MarketplaceCategory[]
  skills: MarketplaceSkillSummary[]
  page: MarketplacePageInfo
  loading: boolean
  error: MarketplaceRequestError | null
  revision: number
}

export const catalogStateAtom = atom<CatalogState>({
  searchInput: '',
  categories: [],
  skills: [],
  page: { number: 1, size: 16, total: 0, pages: 1 },
  loading: true,
  error: null,
  revision: 0,
})

export interface DetailState {
  skill: MarketplaceSkillDetail | null
  file: MarketplaceSkillFile | null
  loading: boolean
  loadingFile: boolean
  error: MarketplaceRequestError | null
  fileError: MarketplaceRequestError | null
  revision: number
}

export const detailStateAtom = atom<DetailState>({
  skill: null,
  file: null,
  loading: true,
  loadingFile: false,
  error: null,
  fileError: null,
  revision: 0,
})
