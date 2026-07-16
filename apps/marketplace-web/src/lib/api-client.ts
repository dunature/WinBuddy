import type {
  MarketplaceApiError,
  MarketplaceCategory,
  MarketplacePaginatedResponse,
  MarketplaceSearchParams,
  MarketplaceSkillSummary,
  MarketplaceSkillDetail,
  MarketplaceExample,
  MarketplaceFileContent,
  MarketplaceFileNode,
  MarketplaceAdminSession,
  MarketplaceCreateSubmissionInput,
  MarketplaceCreateSubmissionResult,
  MarketplaceSubmissionDetail,
  MarketplaceSubmissionSummary,
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
      response = await fetch(`${this.baseUrl}${path}`, { signal: combined, credentials: 'include', headers: { Accept: 'application/json' } })
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

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new MarketplaceRequestError(await response.json() as MarketplaceApiError)
    return response.json() as Promise<T>
  }

  getAdminSession(signal?: AbortSignal): Promise<MarketplaceAdminSession> { return this.get('/admin/auth/session', signal) }
  logoutAdmin(): Promise<{ ok: boolean }> { return this.post('/admin/auth/logout') }
  getAdminLoginUrl(): string { return `${this.baseUrl}/admin/auth/github/start` }
  listSubmissions(signal?: AbortSignal): Promise<MarketplaceSubmissionSummary[]> { return this.get('/admin/submissions', signal) }
  getSubmission(id: string, signal?: AbortSignal): Promise<MarketplaceSubmissionDetail> { return this.get(`/admin/submissions/${encodeURIComponent(id)}`, signal) }
  createSubmission(input: MarketplaceCreateSubmissionInput): Promise<MarketplaceCreateSubmissionResult> { return this.post('/admin/submissions', input) }
  completeSubmission(id: string, sha256: string): Promise<MarketplaceSubmissionSummary> { return this.post(`/admin/submissions/${encodeURIComponent(id)}/complete`, { sha256 }) }

  listCategories(signal?: AbortSignal): Promise<MarketplaceCategory[]> {
    return this.get('/categories', signal)
  }

  listSkills(params: MarketplaceSearchParams, signal?: AbortSignal): Promise<MarketplacePaginatedResponse<MarketplaceSkillSummary>> {
    return this.get(buildMarketplaceSearchPath(params), signal)
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
