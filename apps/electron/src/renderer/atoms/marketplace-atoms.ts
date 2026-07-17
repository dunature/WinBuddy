import { atom } from 'jotai'
import type {
  MarketplaceCategory,
  MarketplaceListQuery,
  MarketplacePageInfo,
  MarketplaceSkillDetail,
  MarketplaceSkillFile,
  MarketplaceSkillSummary,
  MarketplaceSort,
} from '@proma/shared'

export type MarketplaceDetailTab = 'overview' | 'skill-md' | 'files' | 'versions'

export interface MarketplaceState {
  searchInput: string
  query: string
  category: string
  featured: boolean
  sort: MarketplaceSort
  page: number
  pageSize: number
  categories: MarketplaceCategory[]
  skills: MarketplaceSkillSummary[]
  pageInfo: MarketplacePageInfo
  selectedIdentifier: string | null
  selectedTab: MarketplaceDetailTab
  selectedSkill: MarketplaceSkillDetail | null
  selectedFile: MarketplaceSkillFile | null
  loading: boolean
  detailLoading: boolean
  error: string | null
  detailError: string | null
  refreshVersion: number
}

export const initialMarketplaceState: MarketplaceState = {
  searchInput: '',
  query: '',
  category: '',
  featured: false,
  sort: 'hot',
  page: 1,
  pageSize: 16,
  categories: [],
  skills: [],
  pageInfo: { number: 1, size: 16, total: 0, pages: 1 },
  selectedIdentifier: null,
  selectedTab: 'overview',
  selectedSkill: null,
  selectedFile: null,
  loading: false,
  detailLoading: false,
  error: null,
  detailError: null,
  refreshVersion: 0,
}

export const marketplaceStateAtom = atom<MarketplaceState>(initialMarketplaceState)

export function toMarketplaceListQuery(state: MarketplaceState): MarketplaceListQuery {
  const query = state.query.trim()
  return {
    ...(query ? { query } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.featured ? { featured: true } : {}),
    sort: state.sort,
    page: state.page,
    pageSize: state.pageSize,
  }
}
