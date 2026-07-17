import type { MarketplaceSort } from '@proma/shared'

export type MarketplaceDetailTab = 'overview' | 'skill-md' | 'files' | 'versions'

export interface MarketplaceCatalogRoute {
  query: string
  category: string
  featured: boolean
  sort: MarketplaceSort
  page: number
}

export interface MarketplaceDetailRoute {
  tab: MarketplaceDetailTab
  file: string | null
  version: string | null
}

export interface MarketplaceDetailEntry {
  identifier: string
  route: MarketplaceDetailRoute
}

export function readMarketplaceCatalogRoute(searchParams: URLSearchParams): MarketplaceCatalogRoute {
  const page = Number.parseInt(searchParams.get('page') ?? '', 10)
  return {
    query: searchParams.get('q')?.trim() ?? '',
    category: searchParams.get('category') ?? '',
    featured: searchParams.get('featured') === '1',
    sort: searchParams.get('sort') === 'latest' ? 'latest' : 'hot',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

export function writeMarketplaceCatalogRoute(route: MarketplaceCatalogRoute): URLSearchParams {
  const searchParams = new URLSearchParams()
  const query = route.query.trim()
  if (query) searchParams.set('q', query)
  if (route.category) searchParams.set('category', route.category)
  if (route.featured) searchParams.set('featured', '1')
  if (route.sort !== 'hot') searchParams.set('sort', route.sort)
  if (route.page > 1) searchParams.set('page', String(route.page))
  return searchParams
}

export function readMarketplaceDetailRoute(searchParams: URLSearchParams): MarketplaceDetailRoute {
  const tabParam = searchParams.get('tab')
  const tab: MarketplaceDetailTab = tabParam === 'skill-md' || tabParam === 'files' || tabParam === 'versions'
    ? tabParam
    : 'overview'
  const file = searchParams.get('file')?.trim() || null
  return {
    tab,
    file: tab === 'skill-md' ? 'SKILL.md' : file ?? (tab === 'files' ? 'SKILL.md' : null),
    version: searchParams.get('version')?.trim() || null,
  }
}

export function writeMarketplaceDetailRoute(route: MarketplaceDetailRoute): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (route.tab !== 'overview') searchParams.set('tab', route.tab)
  if (route.tab === 'files' && route.file && route.file !== 'SKILL.md') searchParams.set('file', route.file)
  if (route.version) searchParams.set('version', route.version)
  return searchParams
}

export function createMarketplaceMemoryEntries(
  catalogRoute: MarketplaceCatalogRoute,
  detailEntry?: MarketplaceDetailEntry,
): string[] {
  const catalogSearch = writeMarketplaceCatalogRoute(catalogRoute).toString()
  const catalogEntry = catalogSearch ? `/?${catalogSearch}` : '/'
  if (!detailEntry) return [catalogEntry]

  const detailSearch = writeMarketplaceDetailRoute(detailEntry.route).toString()
  const detailSuffix = detailSearch ? `?${detailSearch}` : ''
  return [catalogEntry, `/skills/${encodeURIComponent(detailEntry.identifier)}${detailSuffix}`]
}
