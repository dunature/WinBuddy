import type {
  MarketplaceAdminIdentity,
  MarketplaceAdminAuditEntry,
  MarketplaceAdminAuditQuery,
  MarketplaceAdminCategory,
  MarketplaceAdminSession,
  MarketplaceAdminSkillDetail,
  MarketplaceAdminSkillSummary,
  MarketplaceAdminUpload,
  MarketplaceAdminVersion,
  MarketplaceAdminVersionActionResult,
  MarketplaceAdminTag,
  MarketplaceBulkGovernanceAction,
  MarketplaceBulkGovernanceResult,
  MarketplaceBulkGovernanceTarget,
  MarketplaceVersionGovernanceAction,
  MarketplaceApiPage,
  MarketplaceApiSuccess,
  MarketplacePage,
} from '@proma/shared'
import { MarketplaceRequestError, requestMarketplaceEnvelope } from './api'
import { buildAdminAuditSearch } from './admin-audit-state'

export const ADMIN_SESSION_EXPIRED_EVENT = 'proma:marketplace-admin-session-expired'

function notifyExpiredSession(error: unknown): void {
  if (error instanceof MarketplaceRequestError && error.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT))
  }
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const response = await requestMarketplaceEnvelope(path, init) as unknown as MarketplaceApiSuccess<T>
    return response.data
  } catch (error) {
    notifyExpiredSession(error)
    throw error
  }
}

async function adminPageRequest<T>(path: string, signal?: AbortSignal): Promise<MarketplacePage<T>> {
  try {
    const response = await requestMarketplaceEnvelope(path, { signal }) as unknown as MarketplaceApiPage<T>
    return { items: response.data, page: response.page }
  } catch (error) {
    notifyExpiredSession(error)
    throw error
  }
}

let adminSessionRequest: Promise<MarketplaceAdminSession> | null = null

export async function getAdminSession(): Promise<MarketplaceAdminSession> {
  if (!adminSessionRequest) {
    adminSessionRequest = adminRequest<MarketplaceAdminSession>('/admin/auth/session')
      .finally(() => { adminSessionRequest = null })
  }
  return adminSessionRequest
}

export async function loginAdmin(username: string, password: string): Promise<MarketplaceAdminSession> {
  const challenge = await adminRequest<{ csrfToken: string }>('/admin/auth/login-challenge')
  return adminRequest('/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': challenge.csrfToken },
    body: JSON.stringify({ username, password }),
  })
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string,
  csrfToken: string,
): Promise<{ admin: MarketplaceAdminIdentity }> {
  return adminRequest('/admin/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function logoutAdmin(csrfToken: string): Promise<void> {
  await adminRequest('/admin/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  })
}

export interface AdminSkillWriteInput {
  identifier: string
  name: string
  tagline: string
  description: string
  authorName: string
  authorUrl?: string
  categoryId: string
  tagIds: string[]
  icon: string
  featured: boolean
}

export async function listAdminCategories(): Promise<MarketplaceAdminCategory[]> {
  return adminRequest('/admin/categories')
}

export async function listAdminTags(): Promise<MarketplaceAdminTag[]> {
  return adminRequest('/admin/tags')
}

export async function createAdminCategory(
  input: { name: string; icon: string },
  csrfToken: string,
): Promise<MarketplaceAdminCategory> {
  return adminRequest('/admin/categories', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  })
}

export async function updateAdminCategory(
  categoryId: string,
  input: { revision: number; name: string; icon: string },
  csrfToken: string,
): Promise<MarketplaceAdminCategory> {
  return adminRequest(`/admin/categories/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  })
}

export async function deleteAdminCategory(
  categoryId: string,
  revision: number,
  csrfToken: string,
): Promise<void> {
  await adminRequest(`/admin/categories/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ revision }),
  })
}

export async function createAdminTag(name: string, csrfToken: string): Promise<MarketplaceAdminTag> {
  return adminRequest('/admin/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ name }),
  })
}

export async function updateAdminTag(
  tagId: string,
  revision: number,
  name: string,
  csrfToken: string,
): Promise<MarketplaceAdminTag> {
  return adminRequest(`/admin/tags/${encodeURIComponent(tagId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ revision, name }),
  })
}

export async function deleteAdminTag(tagId: string, revision: number, csrfToken: string): Promise<void> {
  await adminRequest(`/admin/tags/${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ revision }),
  })
}

export async function listAdminSkills(): Promise<MarketplacePage<MarketplaceAdminSkillSummary>> {
  return adminPageRequest('/admin/skills?pageSize=50')
}

export async function listAdminAuditEntries(
  query: MarketplaceAdminAuditQuery,
  signal?: AbortSignal,
): Promise<MarketplacePage<MarketplaceAdminAuditEntry>> {
  return adminPageRequest(`/admin/audit-entries?${buildAdminAuditSearch(query)}`, signal)
}

export async function getAdminSkill(skillId: string): Promise<MarketplaceAdminSkillDetail> {
  return adminRequest(`/admin/skills/${encodeURIComponent(skillId)}`)
}

export async function createAdminSkill(
  input: AdminSkillWriteInput,
  csrfToken: string,
): Promise<MarketplaceAdminSkillDetail> {
  return adminRequest('/admin/skills', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  })
}

export async function updateAdminSkill(
  skillId: string,
  revision: number,
  input: AdminSkillWriteInput,
  csrfToken: string,
): Promise<MarketplaceAdminSkillDetail> {
  return adminRequest(`/admin/skills/${encodeURIComponent(skillId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ revision, ...input }),
  })
}

export async function deleteAdminSkill(
  skillId: string,
  revision: number,
  csrfToken: string,
): Promise<void> {
  await adminRequest(`/admin/skills/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ revision }),
  })
}

export async function createAdminVersion(
  skillId: string,
  input: { version: string; changelog: string },
  csrfToken: string,
): Promise<MarketplaceAdminVersion> {
  return adminRequest(`/admin/skills/${encodeURIComponent(skillId)}/versions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  })
}

export async function listAdminUploads(
  skillId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<MarketplaceAdminUpload[]> {
  return adminRequest(
    `/admin/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/uploads`,
    { signal },
  )
}

export async function getAdminUpload(
  skillId: string,
  versionId: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<MarketplaceAdminUpload> {
  return adminRequest(
    `/admin/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/uploads/${encodeURIComponent(uploadId)}`,
    { signal },
  )
}

export async function uploadAdminVersion(
  skillId: string,
  versionId: string,
  file: File,
  csrfToken: string,
): Promise<MarketplaceAdminUpload> {
  return adminRequest(
    `/admin/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/uploads`,
    {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/zip',
        'x-file-name': encodeURIComponent(file.name),
        'x-csrf-token': csrfToken,
      },
      body: file,
    },
  )
}

export async function performAdminVersionAction(
  skillId: string,
  versionId: string,
  action: MarketplaceVersionGovernanceAction,
  csrfToken: string,
  reason = '',
): Promise<MarketplaceAdminVersionActionResult> {
  return adminRequest(
    `/admin/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/actions/${action}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ reason }),
    },
  )
}

export async function performAdminBulkGovernance(
  action: MarketplaceBulkGovernanceAction,
  items: MarketplaceBulkGovernanceTarget[],
  reason: string,
  csrfToken: string,
): Promise<MarketplaceBulkGovernanceResult> {
  return adminRequest(`/admin/bulk-actions/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ items, reason }),
  })
}
