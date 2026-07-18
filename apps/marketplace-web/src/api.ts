import type {
  MarketplaceApiError,
  MarketplaceApiPage,
  MarketplaceApiSuccess,
  MarketplaceCategory,
  MarketplaceListQuery,
  MarketplacePage,
  MarketplaceSkillDetail,
  MarketplaceSkillFile,
  MarketplaceSkillSummary,
} from '@proma/shared'

const apiBaseUrl = (import.meta.env.VITE_MARKETPLACE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '')

export class MarketplaceRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'MarketplaceRequestError'
  }

  get offline(): boolean {
    return this.code === 'OFFLINE'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function requestMarketplaceEnvelope(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...Object.fromEntries(new Headers(init.headers)) },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new MarketplaceRequestError('无法连接技能市场，请检查网络后重试', 'OFFLINE', 0)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MarketplaceRequestError('技能市场返回了无法识别的响应', 'INVALID_RESPONSE', response.status)
  }
  if (!isRecord(payload)) {
    throw new MarketplaceRequestError('技能市场返回了无法识别的响应', 'INVALID_RESPONSE', response.status)
  }
  if (!response.ok) {
    const failure = payload as unknown as MarketplaceApiError
    throw new MarketplaceRequestError(
      failure.error?.message || '技能市场请求失败',
      failure.error?.code || 'REQUEST_FAILED',
      response.status,
      failure.error?.details,
    )
  }
  return payload
}

async function requestData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const envelope = await requestMarketplaceEnvelope(path, { signal }) as unknown as MarketplaceApiSuccess<T>
  return envelope.data
}

export async function listMarketplaceCategories(signal?: AbortSignal): Promise<MarketplaceCategory[]> {
  return requestData('/marketplace/categories', signal)
}

export async function listMarketplaceSkills(
  query: MarketplaceListQuery,
  signal?: AbortSignal,
): Promise<MarketplacePage<MarketplaceSkillSummary>> {
  const search = new URLSearchParams({
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.query) search.set('q', query.query)
  if (query.category) search.set('category', query.category)
  if (query.tag) search.set('tag', query.tag)
  if (query.featured) search.set('featured', '1')
  const envelope = await requestMarketplaceEnvelope(`/marketplace/skills?${search}`, { signal }) as unknown as MarketplaceApiPage<MarketplaceSkillSummary>
  return { items: envelope.data, page: envelope.page }
}

export async function getMarketplaceSkill(identifier: string, signal?: AbortSignal): Promise<MarketplaceSkillDetail> {
  return requestData(`/marketplace/skills/${encodeURIComponent(identifier)}`, signal)
}

export async function getMarketplaceSkillFile(
  identifier: string,
  version: string,
  path: string,
  signal?: AbortSignal,
): Promise<MarketplaceSkillFile> {
  const search = new URLSearchParams({ path })
  return requestData(
    `/marketplace/skills/${encodeURIComponent(identifier)}/versions/${encodeURIComponent(version)}/file?${search}`,
    signal,
  )
}
