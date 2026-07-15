import type {
  MarketplaceApiError,
  MarketplaceCategory,
  MarketplacePaginatedResponse,
  MarketplaceSearchParams,
  MarketplaceSkillSummary,
  MarketplaceSkillDetail,
} from '@proma/shared'

const DEFAULT_API_URL = 'http://localhost:4310/api/v1'

export class MarketplaceRequestError extends Error {
  constructor(readonly error: MarketplaceApiError) {
    super(error.message)
    this.name = 'MarketplaceRequestError'
  }
}

export class MarketplaceApiClient {
  constructor(
    private readonly baseUrl = import.meta.env.VITE_MARKETPLACE_API_URL || DEFAULT_API_URL,
    private readonly timeoutMs = 10_000,
  ) {}

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, { signal: combined, headers: { Accept: 'application/json' } })
    } catch (error) {
      throw new MarketplaceRequestError({
        code: 'MARKETPLACE_OFFLINE',
        message: error instanceof DOMException && error.name === 'TimeoutError' ? '技能市场响应超时' : '无法连接技能市场',
        requestId: crypto.randomUUID(),
      })
    }
    if (!response.ok) throw new MarketplaceRequestError(await response.json() as MarketplaceApiError)
    return response.json() as Promise<T>
  }

  listCategories(signal?: AbortSignal): Promise<MarketplaceCategory[]> {
    return this.get('/categories', signal)
  }

  listSkills(params: MarketplaceSearchParams, signal?: AbortSignal): Promise<MarketplacePaginatedResponse<MarketplaceSkillSummary>> {
    return this.get(buildMarketplaceSearchPath(params), signal)
  }

  getSkill(slug: string, signal?: AbortSignal): Promise<MarketplaceSkillDetail> {
    return this.get(`/skills/${encodeURIComponent(slug)}`, signal)
  }
}

export function buildMarketplaceSearchPath(params: MarketplaceSearchParams): string {
  const query = new URLSearchParams()
  if (params.query) query.set('query', params.query)
  if (params.scope && params.scope !== 'all') query.set('scope', params.scope)
  if (params.category) query.set('category', params.category)
  if (params.sort && params.sort !== 'popular') query.set('sort', params.sort)
  if (params.page && params.page > 1) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  const suffix = query.toString()
  return `/skills${suffix ? `?${suffix}` : ''}`
}

export const marketplaceApi = new MarketplaceApiClient()
