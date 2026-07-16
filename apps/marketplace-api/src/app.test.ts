import { describe, expect, test } from 'bun:test'
import type { MarketplaceApiError } from '@proma/shared'
import { createMarketplaceApp } from './app.ts'
import { loadMarketplaceApiConfig } from './config.ts'
import { AdminAuthService } from './auth/admin-auth.ts'

const TEST_ENV = {
  MARKETPLACE_DATABASE_URL: 'postgres://localhost/test',
  MARKETPLACE_OBJECT_BUCKET: 'test-bucket',
  MARKETPLACE_OBJECT_REGION: 'test-region',
  MARKETPLACE_OBJECT_ACCESS_KEY_ID: 'test-access-key',
  MARKETPLACE_OBJECT_SECRET_ACCESS_KEY: 'test-secret-key',
  MARKETPLACE_PUBLIC_ORIGINS: 'http://localhost:4173',
  NODE_ENV: 'test',
}

describe('Marketplace API foundation', () => {
  test('health 返回状态和版本且不泄露配置', async () => {
    const app = createMarketplaceApp({ config: loadMarketplaceApiConfig(TEST_ENV), version: 'test-version' })
    const response = await app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: 'test-version' })
  })

  test('未知路由返回统一错误和 request id', async () => {
    const app = createMarketplaceApp({ config: loadMarketplaceApiConfig(TEST_ENV) })
    const response = await app.request('/missing')
    const body = await response.json() as MarketplaceApiError
    expect(response.status).toBe(404)
    expect(body.code).toBe('SKILL_NOT_FOUND')
    expect(body.requestId).toBeString()
  })

  test('缺少配置时给出中文错误', () => {
    expect(() => loadMarketplaceApiConfig({ NODE_ENV: 'test' })).toThrow('Marketplace API 配置无效')
  })

  test('admin=false 时不注册管理认证路由', async () => {
    const auth = new AdminAuthService({
      findEnabledUser: async () => undefined,
      createSession: async () => undefined,
      findSession: async () => undefined,
      deleteSession: async () => undefined,
    }, {
      getAuthorizeUrl: () => 'https://github.com/login/oauth/authorize',
      exchange: async () => ({ login: 'test', name: 'Test' }),
    }, 'test-secret-that-is-long-enough-for-hmac')
    const app = createMarketplaceApp({ config: loadMarketplaceApiConfig(TEST_ENV), adminAuth: auth })
    expect((await app.request('/api/v1/admin/auth/session')).status).toBe(404)
    expect(await (await app.request('/api/v1/features')).json()).toEqual({ browse: false, install: false, admin: false, community: false })
  })

  test('管理写请求拒绝缺失或跨站 Origin', async () => {
    const auth = new AdminAuthService({
      findEnabledUser: async () => undefined,
      createSession: async () => undefined,
      findSession: async () => undefined,
      deleteSession: async () => undefined,
    }, {
      getAuthorizeUrl: () => 'https://github.com/login/oauth/authorize',
      exchange: async () => ({ login: 'test', name: 'Test' }),
    }, 'test-secret-that-is-long-enough-for-hmac')
    const config = loadMarketplaceApiConfig(TEST_ENV)
    const app = createMarketplaceApp({ config: { ...config, adminEnabled: true, features: { ...config.features, admin: true } }, adminAuth: auth })
    expect((await app.request('/api/v1/admin/auth/logout', { method: 'POST' })).status).toBe(403)
    expect((await app.request('/api/v1/admin/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    expect((await app.request('/api/v1/admin/auth/logout', { method: 'POST', headers: { Origin: 'http://localhost:4173', 'Sec-Fetch-Site': 'same-site' } })).status).toBe(200)
  })
})
