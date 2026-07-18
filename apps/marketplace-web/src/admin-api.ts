import type {
  MarketplaceAdminIdentity,
  MarketplaceAdminSession,
  MarketplaceAdminSkillDetail,
  MarketplaceAdminSkillSummary,
  MarketplaceAdminVersion,
  MarketplaceApiPage,
  MarketplaceApiSuccess,
  MarketplacePage,
} from '@proma/shared'
import { requestMarketplaceEnvelope } from './api'

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestMarketplaceEnvelope(path, init) as unknown as MarketplaceApiSuccess<T>
  return response.data
}

async function adminPageRequest<T>(path: string): Promise<MarketplacePage<T>> {
  const response = await requestMarketplaceEnvelope(path) as unknown as MarketplaceApiPage<T>
  return { items: response.data, page: response.page }
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
  tags: string[]
  icon: string
  featured: boolean
}

export async function listAdminSkills(): Promise<MarketplacePage<MarketplaceAdminSkillSummary>> {
  return adminPageRequest('/admin/skills?status=draft&pageSize=50')
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
