import { atom } from 'jotai'
import type {
  MarketplaceCategory,
  MarketplaceListQuery,
  MarketplaceInstallState,
  MarketplacePageInfo,
  MarketplaceSkillDetail,
  MarketplaceSkillFile,
  MarketplaceSkillSummary,
  MarketplaceSort,
} from '@proma/shared'
import type { MarketplaceDetailTab } from './marketplace-route'
import { workspaceCapabilitiesVersionAtom } from './agent-atoms'

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
  selectedVersion: string | null
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
  selectedVersion: null,
  selectedSkill: null,
  selectedFile: null,
  loading: false,
  detailLoading: false,
  error: null,
  detailError: null,
  refreshVersion: 0,
}

export const marketplaceStateAtom = atom<MarketplaceState>(initialMarketplaceState)
export const marketplaceInstallTasksAtom = atom<Map<string, MarketplaceInstallState>>(new Map())
export const notifyMarketplaceWorkspaceChangedAtom = atom(null, (get, set) => {
  set(workspaceCapabilitiesVersionAtom, get(workspaceCapabilitiesVersionAtom) + 1)
})

export function withMarketplaceInstallState(
  tasks: Map<string, MarketplaceInstallState>,
  state: MarketplaceInstallState,
): Map<string, MarketplaceInstallState> {
  const next = new Map(tasks)
  next.set(state.installId, state)
  return next
}

export const applyMarketplaceInstallProgressAtom = atom(
  null,
  (get, set, state: MarketplaceInstallState) => {
    const previous = get(marketplaceInstallTasksAtom).get(state.installId)
    set(marketplaceInstallTasksAtom, (tasks) => withMarketplaceInstallState(tasks, state))
    if (state.phase === 'completed' && previous?.phase !== 'completed') {
      set(workspaceCapabilitiesVersionAtom, get(workspaceCapabilitiesVersionAtom) + 1)
    }
  },
)

const marketplaceInstallPhaseLabels: Record<MarketplaceInstallState['phase'], string> = {
  queued: '等待安装',
  downloading: '正在下载',
  verifying: '正在校验',
  extracting: '正在解压',
  committing: '正在提交',
  completed: '安装完成',
  failed: '安装失败',
  cancelled: '已取消',
}

const marketplaceUpdatePhaseLabels: Partial<Record<MarketplaceInstallState['phase'], string>> = {
  queued: '等待更新',
  completed: '更新完成',
  failed: '更新失败',
  cancelled: '更新已取消',
}

export function marketplaceInstallPhaseLabel(
  phase: MarketplaceInstallState['phase'],
  action: MarketplaceInstallState['action'] = 'install',
): string {
  const updateLabel = action === 'update' ? marketplaceUpdatePhaseLabels[phase] : undefined
  return updateLabel ?? marketplaceInstallPhaseLabels[phase]
}

export function findMarketplaceInstallTask(
  tasks: Map<string, MarketplaceInstallState>,
  workspaceSlug: string,
  marketplaceSkillId: string,
  version: string,
): MarketplaceInstallState | undefined {
  let current: MarketplaceInstallState | undefined
  for (const task of tasks.values()) {
    if (
      task.workspaceSlug === workspaceSlug
      && task.marketplaceSkillId === marketplaceSkillId
      && task.version === version
    ) {
      current = task
    }
  }
  return current
}

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
