import type { MarketplaceAdminIdentity, MarketplaceAdminSession, MarketplaceApiSuccess } from '@proma/shared'
import { requestMarketplaceEnvelope } from './api'

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await requestMarketplaceEnvelope(path, init) as unknown as MarketplaceApiSuccess<T>
  return response.data
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
