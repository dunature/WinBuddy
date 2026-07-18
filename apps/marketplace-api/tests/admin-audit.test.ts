import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { MarketplaceAdminAuditEntry, MarketplaceAdminSession, MarketplaceApiPage, MarketplaceApiSuccess } from '@proma/shared'
import { initializeMarketplaceAdmin } from '../src/admin-auth'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
const allowedOrigin = 'https://marketplace.test'

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`响应缺少 Cookie: ${name}`)
  return cookie.split(';', 1)[0]!.split('=', 2)[1]!
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe.skipIf(!adminDatabaseUrl)('Marketplace 管理审计查询 API（真实 PostgreSQL）', () => {
  let testDatabase: MarketplaceTestDatabase
  let database: ReturnType<typeof createMarketplaceDatabase>
  let app: ReturnType<typeof createMarketplaceApp>
  let sessionCookie = ''

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    database = createMarketplaceDatabase(testDatabase.databaseUrl)
    await runMarketplaceMigrations(database.sql)
    await initializeMarketplaceAdmin(database, {
      username: 'admin', initialPassword: 'initial-password-123', requestId: 'audit-bootstrap',
    })
    app = createMarketplaceApp({ database, allowedOrigin })
    const challengeResponse = await app.request('/api/v1/admin/auth/login-challenge')
    const challenge = await readJson<MarketplaceApiSuccess<{ csrfToken: string }>>(challengeResponse)
    const loginResponse = await app.request('/api/v1/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: allowedOrigin,
        'x-csrf-token': challenge.data.csrfToken,
        cookie: `proma_marketplace_admin_login_csrf=${cookieValue(challengeResponse, 'proma_marketplace_admin_login_csrf')}`,
      },
      body: JSON.stringify({ username: 'admin', password: 'initial-password-123' }),
    })
    const login = await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(loginResponse)
    sessionCookie = `proma_marketplace_admin_session=${cookieValue(loginResponse, 'proma_marketplace_admin_session')}`
    const changeResponse = await app.request('/api/v1/admin/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: allowedOrigin,
        'x-csrf-token': login.data.csrfToken, cookie: sessionCookie,
      },
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })
    if (!changeResponse.ok) throw new Error('测试前置首次改密失败')

    await database.sql`
      INSERT INTO audit_entries (
        id, actor_identifier, action, request_id, skill_id, version_id,
        before_state, after_state, reason, created_at
      ) VALUES
        ('audit-a', 'admin', 'skill_version.publish', 'request-a', 'skill-a', 'version-a',
          '{"status":"approved"}'::jsonb, '{"status":"published"}'::jsonb, '发布 A', '2026-07-18T10:00:00.000Z'),
        ('audit-b', 'admin', 'bulk.unpublish.failed', 'request-b', 'skill-a', 'version-a',
          '{"status":"published"}'::jsonb, '{"outcome":"failed"}'::jsonb, '批量下架 A', '2026-07-18T11:00:00.000Z'),
        ('audit-c', 'marketplace-validation-worker', 'skill_version.validated', 'request-c', 'skill-b', 'version-b',
          null, '{"passed":true}'::jsonb, '校验 B', '2026-07-18T12:00:00.000Z')
    `
  })

  afterAll(async () => {
    await closeSql(database.sql)
    await testDatabase.close()
  })

  test('Given 未认证请求 When 查询审计 Then 在读取数据前拒绝', async () => {
    const response = await app.request('/api/v1/admin/audit-entries')
    expect(response.status).toBe(401)
  })

  test('Given 组合筛选与边界时间 When 查询审计 Then 起点包含终点不包含且返回稳定分页', async () => {
    const search = new URLSearchParams({
      skillId: 'skill-a', actor: 'ADMIN', action: 'skill_version.publish',
      from: '2026-07-18T10:00:00.000Z', to: '2026-07-18T11:00:00.000Z',
      page: '1', pageSize: '1',
    })
    const response = await app.request(`/api/v1/admin/audit-entries?${search}`, {
      headers: { cookie: sessionCookie },
    })
    expect(response.status).toBe(200)
    const body = await readJson<MarketplaceApiPage<MarketplaceAdminAuditEntry>>(response)
    expect(body.page).toEqual({ number: 1, size: 1, total: 1, pages: 1 })
    expect(body.data).toEqual([expect.objectContaining({
      id: 'audit-a', actorIdentifier: 'admin', action: 'skill_version.publish',
      requestId: 'request-a', skillId: 'skill-a', versionId: 'version-a', reason: '发布 A',
      beforeState: { status: 'approved' }, afterState: { status: 'published' },
      createdAt: '2026-07-18T10:00:00.000Z',
    })])
  })

  test('Given 同时间记录与分页 When 翻页 Then 按 createdAt 和 id 稳定倒序', async () => {
    await database.sql`
      INSERT INTO audit_entries (id, actor_identifier, action, request_id, skill_id, reason, created_at)
      VALUES ('audit-d', 'admin', 'skill.updated', 'request-d', 'skill-a', '更新 D', '2026-07-18T11:00:00.000Z')
    `
    const first = await app.request('/api/v1/admin/audit-entries?skillId=skill-a&page=1&pageSize=2', {
      headers: { cookie: sessionCookie },
    })
    const second = await app.request('/api/v1/admin/audit-entries?skillId=skill-a&page=2&pageSize=2', {
      headers: { cookie: sessionCookie },
    })
    const firstBody = await readJson<MarketplaceApiPage<MarketplaceAdminAuditEntry>>(first)
    const secondBody = await readJson<MarketplaceApiPage<MarketplaceAdminAuditEntry>>(second)
    expect(firstBody.data.map((entry) => entry.id)).toEqual(['audit-d', 'audit-b'])
    expect(secondBody.data.map((entry) => entry.id)).toEqual(['audit-a'])
  })

  test('Given 不存在 actor 或 Skill When 筛选 Then 返回空分页而不是 404', async () => {
    const response = await app.request('/api/v1/admin/audit-entries?actor=missing&skillId=missing', {
      headers: { cookie: sessionCookie },
    })
    const body = await readJson<MarketplaceApiPage<MarketplaceAdminAuditEntry>>(response)
    expect(response.status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.page).toEqual({ number: 1, size: 16, total: 0, pages: 1 })
  })

  test('Given 非法时间范围 When 查询 Then 返回稳定请求错误', async () => {
    const response = await app.request('/api/v1/admin/audit-entries?from=2026-07-19T00:00:00Z&to=2026-07-18T00:00:00Z', {
      headers: { cookie: sessionCookie },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'INVALID_AUDIT_TIME_RANGE' }),
    }))
  })
})
