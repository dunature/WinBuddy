import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type {
  MarketplaceAdminSession,
  MarketplaceAdminSkillDetail,
  MarketplaceApiError,
  MarketplaceApiSuccess,
  MarketplaceSkillSummary,
} from '@proma/shared'
import { initializeMarketplaceAdmin } from '../src/admin-auth'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
const allowedOrigin = 'https://marketplace.test'

interface TaxonomyRecord {
  id: string
  name: string
  icon?: string
  normalizedName: string
  revision: number
  referenceCount: number
}

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`响应缺少 Cookie: ${name}`)
  return cookie.split(';', 1)[0]!.split('=', 2)[1]!
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe.skipIf(!adminDatabaseUrl)('Marketplace 分类标签管理 API（真实 PostgreSQL）', () => {
  let testDatabase: MarketplaceTestDatabase
  let database: ReturnType<typeof createMarketplaceDatabase>
  let app: ReturnType<typeof createMarketplaceApp>
  let sessionCookie = ''
  let csrfToken = ''

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    database = createMarketplaceDatabase(testDatabase.databaseUrl)
    await runMarketplaceMigrations(database.sql)
    await initializeMarketplaceAdmin(database, {
      username: 'admin',
      initialPassword: 'initial-password-123',
      requestId: 'taxonomy-bootstrap',
    })
    app = createMarketplaceApp({ database, allowedOrigin })

    const challengeResponse = await app.request('/api/v1/admin/auth/login-challenge')
    const challenge = await readJson<MarketplaceApiSuccess<{ csrfToken: string }>>(challengeResponse)
    const loginResponse = await app.request('/api/v1/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
        'x-csrf-token': challenge.data.csrfToken,
        cookie: `proma_marketplace_admin_login_csrf=${cookieValue(challengeResponse, 'proma_marketplace_admin_login_csrf')}`,
      },
      body: JSON.stringify({ username: 'admin', password: 'initial-password-123' }),
    })
    const login = await readJson<MarketplaceApiSuccess<MarketplaceAdminSession>>(loginResponse)
    sessionCookie = `proma_marketplace_admin_session=${cookieValue(loginResponse, 'proma_marketplace_admin_session')}`
    csrfToken = login.data.csrfToken
    const changeResponse = await app.request('/api/v1/admin/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
        'x-csrf-token': csrfToken,
        cookie: sessionCookie,
      },
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })
    if (!changeResponse.ok) throw new Error('测试前置首次改密失败')
  })

  afterAll(async () => {
    await closeSql(database.sql)
    await testDatabase.close()
  })

  test('Given 分类标签写接口 When 缺少会话、可信 Origin 或 CSRF Then 在写入前拒绝', async () => {
    const body = JSON.stringify({ name: '效率工具', icon: 'workflow' })
    const unauthorized = await app.request('/api/v1/admin/categories', { method: 'POST', body })
    expect(unauthorized.status).toBe(401)

    const badOrigin = await app.request('/api/v1/admin/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-csrf-token': csrfToken, origin: 'https://evil.test' },
      body,
    })
    expect(badOrigin.status).toBe(403)

    const badCsrf = await app.request('/api/v1/admin/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie, 'x-csrf-token': 'invalid', origin: allowedOrigin },
      body,
    })
    expect(badCsrf.status).toBe(403)
  })

  test('Given 已认证管理员 When 并发创建、重命名、绑定、筛选和删除 Then 唯一性、引用保护与审计成立', async () => {
    const writeHeaders = {
      'content-type': 'application/json',
      origin: allowedOrigin,
      'x-csrf-token': csrfToken,
      cookie: sessionCookie,
    }
    const categoryResponse = await app.request('/api/v1/admin/categories', {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({ name: '  效率\n 工具 ', icon: 'workflow' }),
    })
    expect(categoryResponse.status).toBe(201)
    const category = (await readJson<MarketplaceApiSuccess<TaxonomyRecord>>(categoryResponse)).data
    expect(category).toMatchObject({ name: '效率 工具', normalizedName: '效率 工具', revision: 1, referenceCount: 0 })

    const concurrentTags = await Promise.all([
      app.request('/api/v1/admin/tags', {
        method: 'POST', headers: writeHeaders, body: JSON.stringify({ name: ' AI  工具 ' }),
      }),
      app.request('/api/v1/admin/tags', {
        method: 'POST', headers: writeHeaders, body: JSON.stringify({ name: 'ＡＩ 工具' }),
      }),
    ])
    expect(concurrentTags.map((response) => response.status).sort()).toEqual([201, 409])
    const successfulTagResponse = concurrentTags.find((response) => response.status === 201)
    if (!successfulTagResponse) throw new Error('并发标签创建没有成功项')
    const tag = (await readJson<MarketplaceApiSuccess<TaxonomyRecord>>(successfulTagResponse)).data
    expect(tag).toMatchObject({ name: 'AI 工具', normalizedName: 'ai 工具', referenceCount: 0 })

    const secondCategoryResponse = await app.request('/api/v1/admin/categories', {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({ name: '研究', icon: 'search' }),
    })
    const secondCategory = (await readJson<MarketplaceApiSuccess<TaxonomyRecord>>(secondCategoryResponse)).data
    const secondTagResponse = await app.request('/api/v1/admin/tags', {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({ name: '研究' }),
    })
    let secondTag = (await readJson<MarketplaceApiSuccess<TaxonomyRecord>>(secondTagResponse)).data
    const renamedTagResponse = await app.request(`/api/v1/admin/tags/${secondTag.id}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: secondTag.revision, name: ' 投资\n 研究 ' }),
    })
    expect(renamedTagResponse.status).toBe(200)
    secondTag = (await readJson<MarketplaceApiSuccess<TaxonomyRecord>>(renamedTagResponse)).data
    expect(secondTag).toMatchObject({ name: '投资 研究', normalizedName: '投资 研究', revision: 2 })

    const renameConflict = await app.request(`/api/v1/admin/categories/${secondCategory.id}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: secondCategory.revision, name: '效率　工具' }),
    })
    expect(renameConflict.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(renameConflict)).error.code).toBe('CATEGORY_NAME_CONFLICT')

    const createSkillResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        identifier: 'taxonomy-skill',
        name: '分类标签测试',
        tagline: '验证持久化绑定',
        description: '验证分类标签的持久化绑定与公开筛选。',
        authorName: 'Proma Labs',
        categoryId: category.id,
        tagIds: [tag.id],
        icon: 'workflow',
      }),
    })
    expect(createSkillResponse.status).toBe(201)
    const skill = (await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(createSkillResponse)).data
    expect(skill).toMatchObject({ categoryId: category.id, tagIds: [tag.id], tags: ['AI 工具'] })

    for (const target of [
      { path: `categories/${category.id}`, code: 'CATEGORY_IN_USE' },
      { path: `tags/${tag.id}`, code: 'TAG_IN_USE' },
    ]) {
      const response = await app.request(`/api/v1/admin/${target.path}`, {
        method: 'DELETE', headers: writeHeaders, body: JSON.stringify({ revision: 1 }),
      })
      expect(response.status).toBe(409)
      const error = await readJson<MarketplaceApiError>(response)
      expect(error.error.code).toBe(target.code)
      expect(error.error.details).toEqual({ referenceCount: 1 })
    }

    const updateSkillResponse = await app.request(`/api/v1/admin/skills/${skill.id}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: skill.revision, categoryId: secondCategory.id, tagIds: [secondTag.id] }),
    })
    expect(updateSkillResponse.status).toBe(200)
    const updatedSkill = (await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(updateSkillResponse)).data
    expect(updatedSkill).toMatchObject({ categoryId: secondCategory.id, tagIds: [secondTag.id], tags: ['投资 研究'] })

    const versionId = crypto.randomUUID()
    await database.sql`
      INSERT INTO skill_versions (
        id, skill_id, version, changelog, sha256, size, file_count, status, published_at
      ) VALUES (${versionId}, ${skill.id}, '1.0.0', '', ${'a'.repeat(64)}, 1, 1, 'published', now())
    `
    await database.sql`
      UPDATE skills SET status = 'published', current_published_version_id = ${versionId}
      WHERE id = ${skill.id}
    `
    const publicResponse = await app.request(
      `/api/v1/marketplace/skills?category=${secondCategory.id}&tag=${secondTag.id}`,
    )
    expect(publicResponse.status).toBe(200)
    const publicSkills = await readJson<{ data: MarketplaceSkillSummary[] }>(publicResponse)
    expect(publicSkills.data).toEqual([
      expect.objectContaining({ id: skill.id, category: secondCategory.id, tags: ['投资 研究'] }),
    ])

    expect((await app.request(`/api/v1/admin/categories/${category.id}`, {
      method: 'DELETE', headers: writeHeaders, body: JSON.stringify({ revision: category.revision }),
    })).status).toBe(200)
    expect((await app.request(`/api/v1/admin/tags/${tag.id}`, {
      method: 'DELETE', headers: writeHeaders, body: JSON.stringify({ revision: tag.revision }),
    })).status).toBe(200)

    const audits = await database.sql<{ action: string }[]>`
      SELECT action FROM audit_entries WHERE action LIKE 'category.%' OR action LIKE 'tag.%'
    `
    expect(audits.map((entry) => entry.action).sort()).toEqual([
      'category.created', 'category.created', 'category.deleted',
      'tag.created', 'tag.created', 'tag.deleted', 'tag.updated',
    ])
  })
})
