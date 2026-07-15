import type {
  MarketplaceApiError,
  MarketplaceCategory,
  MarketplaceExample,
  MarketplaceFileContent,
  MarketplaceFileNode,
  MarketplacePaginatedResponse,
  MarketplaceSearchParams,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
} from '@proma/shared'

const DEFAULT_MARKETPLACE_API_URL = 'https://marketplace.proma.ai/api/v1'

export class ElectronMarketplaceRequestError extends Error {
  constructor(readonly payload: MarketplaceApiError) {
    super(payload.message)
    this.name = 'ElectronMarketplaceRequestError'
  }
}

export class ElectronMarketplaceApi {
  constructor(private readonly baseUrl: string = DEFAULT_MARKETPLACE_API_URL, private readonly timeoutMs = 10_000) {}

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        signal: combinedSignal,
        headers: { Accept: 'application/json' },
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ElectronMarketplaceRequestError({
        code: 'MARKETPLACE_OFFLINE',
        message: error instanceof DOMException && error.name === 'TimeoutError' ? '技能市场响应超时' : '暂时无法连接技能市场',
        requestId: crypto.randomUUID(),
      })
    }
    if (!response.ok) {
      const payload = await response.json() as MarketplaceApiError
      throw new ElectronMarketplaceRequestError(payload)
    }
    return response.json() as Promise<T>
  }

  listCategories(signal?: AbortSignal): Promise<MarketplaceCategory[]> {
    return this.get('/categories', signal)
  }

  listSkills(params: MarketplaceSearchParams, signal?: AbortSignal): Promise<MarketplacePaginatedResponse<MarketplaceSkillSummary>> {
    return this.get(buildElectronMarketplaceSearchPath(params), signal)
  }

  getSkill(slug: string, signal?: AbortSignal): Promise<MarketplaceSkillDetail> {
    return this.get(`/skills/${encodeURIComponent(slug)}`, signal)
  }

  listFiles(slug: string, version: string, signal?: AbortSignal): Promise<MarketplaceFileNode[]> {
    return this.get(`/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/files`, signal)
  }

  getFile(slug: string, version: string, path: string, signal?: AbortSignal): Promise<MarketplaceFileContent> {
    return this.get(`/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/files/content?path=${encodeURIComponent(path)}`, signal)
  }

  listExamples(slug: string, version: string, signal?: AbortSignal): Promise<MarketplaceExample[]> {
    return this.get(`/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/examples`, signal)
  }
}

export function buildElectronMarketplaceSearchPath(params: MarketplaceSearchParams): string {
  const query = new URLSearchParams()
  if (params.query) query.set('query', params.query)
  if (params.scope && params.scope !== 'all') query.set('scope', params.scope)
  if (params.category) query.set('category', params.category)
  if (params.sort && params.sort !== 'popular') query.set('sort', params.sort)
  if (params.page && params.page > 1) query.set('page', String(params.page))
  query.set('pageSize', String(params.pageSize ?? 24))
  return `/skills?${query.toString()}`
}
