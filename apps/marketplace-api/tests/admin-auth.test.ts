import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Sql } from 'postgres'
import type { MarketplaceApiError, MarketplaceApiSuccess, MarketplaceAdminSession } from '@proma/shared'
import { initializeMarketplaceAdmin } from '../src/admin-auth'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
const allowedOrigin = 'https://marketplace.test'

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`响应缺少 Cookie: ${name}`)
  return cookie.split(';', 1)[0]!.split('=', 2)[1]!
}

async function loginRequest(
  app: ReturnType<typeof createMarketplaceApp>,
  input: { username: string; password: string; ipAddress: string; origin?: string },
): Promise<Response> {
  const challengeResponse = await app.request('/api/v1/admin/auth/login-challenge')
  const challenge = await readJson<MarketplaceApiSuccess<{ csrfToken: string }>>(challengeResponse)
  const challengeCookie = cookieValue(challengeResponse, 'proma_marketplace_admin_login_csrf')
  return app.request('/api/v1/admin/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: input.origin ?? allowedOrigin,
      'x-forwarded-for': input.ipAddress,
      'x-csrf-token': challenge.data.csrfToken,
      cookie: `proma_marketplace_admin_login_csrf=${challengeCookie}`,
    },
    body: JSON.stringify({ username: input.username, password: input.password }),
  })
}

describe.skipIf(!adminDatabaseUrl)('Marketplace 管理员认证（真实 PostgreSQL）', () => {
  let testDatabase: MarketplaceTestDatabase
  let database: ReturnType<typeof createMarketplaceDatabase>
  let sql: Sql
  let app: ReturnType<typeof createMarketplaceApp>
  let now = new Date('2026-07-18T02:30:00.000Z')

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    database = createMarketplaceDatabase(testDatabase.databaseUrl)
    sql = database.sql
    await runMarketplaceMigrations(sql)
    await initializeMarketplaceAdmin(database, {
      username: 'admin',
      initialPassword: 'initial-password-123',
      requestId: 'bootstrap-request',
    })
    app = createMarketplaceApp({ database, allowedOrigin, now: () => now })
  })

  afterAll(async () => {
    await closeSql(sql)
    await testDatabase.close()
  })

  test('Given 首次启动环境变量 When 初始化并登录 Then 创建唯一 Argon2id 管理员和八小时安全会话', async () => {
    now = new Date('2026-07-18T02:30:00.000Z')
    await initializeMarketplaceAdmin(database, {
      username: 'ignored-second-admin',
      initialPassword: 'ignored-password-123',
      requestId: 'second-bootstrap',
    })

    const loginResponse = await loginRequest(app, {
      username: 'admin', password: 'initial-password-123', ipAddress: '203.0.113.10',
    })
    const login = await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(loginResponse)
    const sessionCookie = loginResponse.headers.getSetCookie().find((value) => value.startsWith('proma_marketplace_admin_session='))
    const csrfCookie = loginResponse.headers.getSetCookie().find((value) => value.startsWith('proma_marketplace_admin_csrf='))

    expect(loginResponse.status).toBe(200)
    expect(login.data.admin).toEqual({ username: 'admin', mustChangePassword: true })
    expect(login.data.csrfToken).toHaveLength(43)
    expect(sessionCookie).toContain('Max-Age=28800')
    expect(sessionCookie).toContain('Path=/')
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(sessionCookie).toContain('SameSite=Lax')
    expect(csrfCookie).toContain('HttpOnly')
    expect(csrfCookie).toContain('Secure')
    expect(csrfCookie).toContain('SameSite=Lax')

    const rawSessionToken = sessionCookie!.split(';', 1)[0]!.split('=', 2)[1]!
    const admins = await sql<{ username: string; password_hash: string }[]>`
      SELECT username, password_hash FROM admins
    `
    const sessions = await sql<{ token_hash: string }[]>`SELECT token_hash FROM admin_sessions`

    expect(admins).toHaveLength(1)
    expect(admins[0]!.username).toBe('admin')
    expect(admins[0]!.password_hash.startsWith('$argon2id$')).toBe(true)
    expect(await Bun.password.verify('initial-password-123', admins[0]!.password_hash)).toBe(true)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.token_hash).not.toBe(rawSessionToken)
    expect(JSON.stringify(sessions)).not.toContain(rawSessionToken)

    const sessionResponse = await app.request('/api/v1/admin/auth/session', {
      headers: { cookie: `proma_marketplace_admin_session=${rawSessionToken}` },
    })
    const session = await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(sessionResponse)

    expect(sessionResponse.status).toBe(200)
    expect(session.data.admin).toEqual({ username: 'admin', mustChangePassword: true })
    expect(session.data.csrfToken).toHaveLength(43)

    const audits = await sql<{ action: string; request_id: string }[]>`
      SELECT action, request_id FROM audit_entries ORDER BY created_at
    `
    expect(audits.map((entry) => entry.action).sort()).toEqual(['admin.bootstrap', 'admin.login.succeeded'])
    expect(audits.every((entry) => entry.request_id.length > 0)).toBe(true)
  })

  test('Given 登录请求缺少预认证 CSRF challenge When 提交正确密码 Then 在校验密码前拒绝', async () => {
    now = new Date('2026-07-18T02:45:00.000Z')
    const response = await app.request('/api/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: allowedOrigin, 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({ username: 'admin', password: 'initial-password-123' }),
    })

    expect(response.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(response)).error.code).toBe('ADMIN_CSRF_INVALID')

    const foreignOriginResponse = await loginRequest(app, {
      username: 'admin',
      password: 'initial-password-123',
      ipAddress: '203.0.113.11',
      origin: 'https://attacker.test',
    })
    expect(foreignOriginResponse.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(foreignOriginResponse)).error.code).toBe('ORIGIN_FORBIDDEN')
  })

  test('Given 用户名或 IP 已有五次失败 When 15 分钟内再次登录 Then 稳定限流且窗口结束后恢复', async () => {
    now = new Date('2026-07-18T03:00:00.000Z')

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await loginRequest(app, {
        username: 'admin', password: 'wrong-password', ipAddress: `203.0.113.${attempt}`,
      })
      expect(response.status).toBe(401)
    }

    const usernameLimitedResponse = await loginRequest(app, {
      username: 'ADMIN', password: 'wrong-password', ipAddress: '203.0.113.99',
    })
    expect(usernameLimitedResponse.status).toBe(429)
    expect((await readJson<MarketplaceApiError>(usernameLimitedResponse)).error.code).toBe('ADMIN_LOGIN_RATE_LIMITED')

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await loginRequest(app, {
        username: `missing-${attempt}`, password: 'wrong-password', ipAddress: '198.51.100.20',
      })
      expect(response.status).toBe(401)
    }

    const ipLimitedResponse = await loginRequest(app, {
      username: 'another-missing', password: 'wrong-password', ipAddress: '198.51.100.20',
    })
    expect(ipLimitedResponse.status).toBe(429)
    expect((await readJson<MarketplaceApiError>(ipLimitedResponse)).error.code).toBe('ADMIN_LOGIN_RATE_LIMITED')

    now = new Date('2026-07-18T03:15:00.001Z')
    const recoveredResponse = await loginRequest(app, {
      username: 'admin', password: 'wrong-password', ipAddress: '203.0.113.99',
    })
    expect(recoveredResponse.status).toBe(401)

    const missingSessionResponse = await app.request('/api/v1/admin/auth/session', {
      headers: { cookie: 'proma_marketplace_admin_session=invalid-token' },
    })
    expect(missingSessionResponse.status).toBe(401)
    expect((await readJson<MarketplaceApiError>(missingSessionResponse)).error.code).toBe('ADMIN_UNAUTHORIZED')

    const auditActions = await sql<{ action: string }[]>`
      SELECT DISTINCT action FROM audit_entries
      WHERE action IN ('admin.login.failed', 'admin.login.rate_limited')
      ORDER BY action
    `
    expect(auditActions.map((entry) => entry.action)).toEqual([
      'admin.login.failed',
      'admin.login.rate_limited',
    ])
  })

  test('Given 初始密码会话 When 执行管理写请求 Then 必须通过 Origin、CSRF 和首次改密门禁', async () => {
    now = new Date('2026-07-18T04:00:00.000Z')
    const unauthenticatedResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: allowedOrigin },
      body: '{}',
    })
    expect(unauthenticatedResponse.status).toBe(401)
    expect((await readJson<MarketplaceApiError>(unauthenticatedResponse)).error.code).toBe('ADMIN_UNAUTHORIZED')

    const loginResponse = await loginRequest(app, {
      username: 'admin', password: 'initial-password-123', ipAddress: '192.0.2.30',
    })
    const login = await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(loginResponse)
    const sessionToken = cookieValue(loginResponse, 'proma_marketplace_admin_session')
    const authHeaders = {
      cookie: `proma_marketplace_admin_session=${sessionToken}`,
      'content-type': 'application/json',
    }

    const foreignOriginResponse = await app.request('/api/v1/admin/auth/change-password', {
      method: 'POST',
      headers: { ...authHeaders, origin: 'https://attacker.test', 'x-csrf-token': login.data.csrfToken },
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })
    expect(foreignOriginResponse.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(foreignOriginResponse)).error.code).toBe('ORIGIN_FORBIDDEN')

    const missingCsrfResponse = await app.request('/api/v1/admin/auth/change-password', {
      method: 'POST',
      headers: { ...authHeaders, origin: allowedOrigin },
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })
    expect(missingCsrfResponse.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(missingCsrfResponse)).error.code).toBe('ADMIN_CSRF_INVALID')

    const gatedResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: { ...authHeaders, origin: allowedOrigin, 'x-csrf-token': login.data.csrfToken },
      body: '{}',
    })
    expect(gatedResponse.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(gatedResponse)).error.code).toBe('ADMIN_PASSWORD_CHANGE_REQUIRED')

    const changeResponse = await app.request('/api/v1/admin/auth/change-password', {
      method: 'POST',
      headers: { ...authHeaders, origin: allowedOrigin, 'x-csrf-token': login.data.csrfToken },
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })
    const changed = await readJson<MarketplaceApiSuccess<{ admin: { username: string; mustChangePassword: boolean } }>>(changeResponse)
    expect(changeResponse.status).toBe(200)
    expect(changed.data.admin).toEqual({ username: 'admin', mustChangePassword: false })

    const oldPasswordResponse = await loginRequest(app, {
      username: 'admin', password: 'initial-password-123', ipAddress: '192.0.2.31',
    })
    expect(oldPasswordResponse.status).toBe(401)

    const newPasswordResponse = await loginRequest(app, {
      username: 'admin', password: 'updated-password-456', ipAddress: '192.0.2.31',
    })
    expect(newPasswordResponse.status).toBe(200)
    expect((await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(newPasswordResponse)).data.admin.mustChangePassword).toBe(false)

    const protectedResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: { ...authHeaders, origin: allowedOrigin, 'x-csrf-token': login.data.csrfToken },
      body: '{}',
    })
    expect(protectedResponse.status).toBe(400)
    expect((await readJson<MarketplaceApiError>(protectedResponse)).error.code).toBe('INVALID_REQUEST')

    const csrfRows = await sql<{ csrf_token_hash: string }[]>`SELECT csrf_token_hash FROM admin_sessions`
    expect(JSON.stringify(csrfRows)).not.toContain(login.data.csrfToken)
  })

  test('Given 已认证会话 When 会话过期或主动退出 Then 统一失效并写入审计', async () => {
    now = new Date('2026-07-18T05:00:00.000Z')
    const expiringLoginResponse = await loginRequest(app, {
      username: 'admin', password: 'updated-password-456', ipAddress: '192.0.2.40',
    })
    const expiringToken = cookieValue(expiringLoginResponse, 'proma_marketplace_admin_session')
    now = new Date('2026-07-18T13:00:00.001Z')
    const expiredResponse = await app.request('/api/v1/admin/auth/session', {
      headers: { cookie: `proma_marketplace_admin_session=${expiringToken}` },
    })
    expect(expiredResponse.status).toBe(401)
    expect((await readJson<MarketplaceApiError>(expiredResponse)).error.code).toBe('ADMIN_UNAUTHORIZED')

    const activeLoginResponse = await loginRequest(app, {
      username: 'admin', password: 'updated-password-456', ipAddress: '192.0.2.41',
    })
    const activeLogin = await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(activeLoginResponse)
    const activeToken = cookieValue(activeLoginResponse, 'proma_marketplace_admin_session')
    const logoutResponse = await app.request('/api/v1/admin/auth/logout', {
      method: 'POST',
      headers: {
        cookie: `proma_marketplace_admin_session=${activeToken}`,
        origin: allowedOrigin,
        'x-csrf-token': activeLogin.data.csrfToken,
      },
    })
    expect(logoutResponse.status).toBe(200)

    const loggedOutResponse = await app.request('/api/v1/admin/auth/session', {
      headers: { cookie: `proma_marketplace_admin_session=${activeToken}` },
    })
    expect(loggedOutResponse.status).toBe(401)

    const audits = await sql<{ action: string; request_id: string }[]>`
      SELECT action, request_id FROM audit_entries
      WHERE action IN ('admin.password.changed', 'admin.logout')
      ORDER BY created_at
    `
    expect(audits.map((entry) => entry.action)).toEqual(['admin.password.changed', 'admin.logout'])
    expect(audits.every((entry) => entry.request_id.length > 0)).toBe(true)
  })
})
