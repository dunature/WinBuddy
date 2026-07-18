import type { MarketplaceSort } from '@proma/shared'

export type MarketplaceDetailTab = 'overview' | 'skill-md' | 'files' | 'versions'

export interface CatalogRoute {
  query: string
  category: string
  featured: boolean
  sort: MarketplaceSort
  page: number
}

export interface DetailRoute {
  tab: MarketplaceDetailTab
  file: string | null
  version: string | null
}

export function readCatalogRoute(searchParams: URLSearchParams): CatalogRoute {
  const page = Number.parseInt(searchParams.get('page') ?? '', 10)
  return {
    query: searchParams.get('q')?.trim() ?? '',
    category: searchParams.get('category') ?? '',
    featured: searchParams.get('featured') === '1',
    sort: searchParams.get('sort') === 'latest' ? 'latest' : 'hot',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

export function writeCatalogRoute(route: CatalogRoute): URLSearchParams {
  const searchParams = new URLSearchParams()
  const query = route.query.trim()
  if (query) searchParams.set('q', query)
  if (route.category) searchParams.set('category', route.category)
  if (route.featured) searchParams.set('featured', '1')
  if (route.sort !== 'hot') searchParams.set('sort', route.sort)
  if (route.page > 1) searchParams.set('page', String(route.page))
  return searchParams
}

export function readDetailRoute(searchParams: URLSearchParams): DetailRoute {
  const requestedTab = searchParams.get('tab')
  const tab: MarketplaceDetailTab = requestedTab === 'skill-md'
    || requestedTab === 'files'
    || requestedTab === 'versions'
    ? requestedTab
    : 'overview'
  const requestedFile = searchParams.get('file')?.trim() || null
  return {
    tab,
    file: tab === 'skill-md' ? 'SKILL.md' : requestedFile ?? (tab === 'files' ? 'SKILL.md' : null),
    version: searchParams.get('version')?.trim() || null,
  }
}

export function writeDetailRoute(route: DetailRoute): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (route.tab !== 'overview') searchParams.set('tab', route.tab)
  if (route.tab === 'files' && route.file && route.file !== 'SKILL.md') searchParams.set('file', route.file)
  if (route.version) searchParams.set('version', route.version)
  return searchParams
}
