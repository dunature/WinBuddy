import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type {
  MarketplaceApiPage,
  MarketplaceApiError,
  MarketplaceApiSuccess,
  MarketplaceAdminSession,
  MarketplaceAdminSkillDetail,
  MarketplaceAdminSkillSummary,
  MarketplaceAdminVersion,
} from '@proma/shared'
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

describe.skipIf(!adminDatabaseUrl)('Marketplace 草稿管理 API（真实 PostgreSQL）', () => {
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
      requestId: 'drafts-bootstrap',
    })
    await database.sql`
      INSERT INTO categories (id, name, normalized_name, icon)
      VALUES ('automation', '效率自动化', '效率自动化', 'workflow')
    `
    app = createMarketplaceApp({ database, allowedOrigin })

    const challengeResponse = await app.request('/api/v1/admin/auth/login-challenge')
    const challenge = await readJson<MarketplaceApiSuccess<{ csrfToken: string }>>(challengeResponse)
    const challengeCookie = cookieValue(challengeResponse, 'proma_marketplace_admin_login_csrf')
    const loginResponse = await app.request('/api/v1/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
        'x-csrf-token': challenge.data.csrfToken,
        cookie: `proma_marketplace_admin_login_csrf=${challengeCookie}`,
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

  test('Given 已认证管理员 When 完成草稿与候选版本生命周期 Then 并发、指针、软删除与审计约束均成立', async () => {
    const writeHeaders = {
      'content-type': 'application/json',
      origin: allowedOrigin,
      'x-csrf-token': csrfToken,
      cookie: sessionCookie,
    }
    const createSkillResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        identifier: 'daily-briefing',
        name: '每日简报',
        tagline: '自动整理每日工作进展',
        description: '汇总工作区中的进展并生成结构化简报。',
        authorName: 'Proma Labs',
        categoryId: 'automation',
        tags: ['自动化', '简报'],
        icon: 'workflow',
      }),
    })
    const createdSkill = await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(createSkillResponse)

    expect(createSkillResponse.status).toBe(201)
    expect(createdSkill.data).toMatchObject({
      identifier: 'daily-briefing',
      name: '每日简报',
      status: 'draft',
      currentPublishedVersionId: null,
      revision: 1,
      versions: [],
    })
    const skillId = createdSkill.data.id

    const listResponse = await app.request('/api/v1/admin/skills', { headers: { cookie: sessionCookie } })
    const list = await readJson<MarketplaceApiPage<MarketplaceAdminSkillSummary>>(listResponse)
    expect(listResponse.status).toBe(200)
    expect(list.data.map((skill) => skill.id)).toEqual([createdSkill.data.id])

    const initialDetailResponse = await app.request(`/api/v1/admin/skills/${createdSkill.data.id}`, {
      headers: { cookie: sessionCookie },
    })
    expect(initialDetailResponse.status).toBe(200)
    expect((await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(initialDetailResponse)).data).toEqual(createdSkill.data)

    const invalidSkillResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ identifier: 'Daily_Briefing' }),
    })
    expect(invalidSkillResponse.status).toBe(400)
    expect((await readJson<MarketplaceApiError>(invalidSkillResponse)).error.code).toBe('INVALID_REQUEST')

    const duplicateSkillResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        identifier: 'daily-briefing',
        name: '重复简报',
        tagline: '重复请求',
        description: '不应创建第二条记录。',
        authorName: 'Proma Labs',
        categoryId: 'automation',
        tags: [],
        icon: 'workflow',
      }),
    })
    expect(duplicateSkillResponse.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(duplicateSkillResponse)).error.code).toBe('SKILL_IDENTIFIER_CONFLICT')

    const updateSkillResponse = await app.request(`/api/v1/admin/skills/${skillId}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: 1, name: '每日工作简报', tagline: '自动整理每天的工作进展' }),
    })
    const updatedSkill = await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(updateSkillResponse)

    expect(updateSkillResponse.status).toBe(200)
    expect(updatedSkill.data).toMatchObject({ name: '每日工作简报', revision: 2 })

    const staleSkillResponse = await app.request(`/api/v1/admin/skills/${skillId}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: 1, name: '被覆盖的名称' }),
    })
    expect(staleSkillResponse.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(staleSkillResponse)).error.code).toBe('SKILL_REVISION_CONFLICT')

    const updatedSkillDetailResponse = await app.request(`/api/v1/admin/skills/${skillId}`, {
      headers: { cookie: sessionCookie },
    })
    expect((await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(updatedSkillDetailResponse)).data.name).toBe('每日工作简报')

    const createVersionResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ version: '1.0.0-beta.1', changelog: '首个候选版本。' }),
    })
    const createdVersion = await readJson<MarketplaceApiSuccess<MarketplaceAdminVersion>>(createVersionResponse)
    expect(createVersionResponse.status).toBe(201)
    expect(createdVersion.data).toMatchObject({
      skillId,
      version: '1.0.0-beta.1',
      changelog: '首个候选版本。',
      status: 'created',
      revision: 1,
    })
    const versionId = createdVersion.data.id

    const invalidVersionResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ version: 'v1.0', changelog: '' }),
    })
    expect(invalidVersionResponse.status).toBe(400)
    expect((await readJson<MarketplaceApiError>(invalidVersionResponse)).error.code).toBe('INVALID_SEMVER')

    const duplicateVersionResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ version: '1.0.0-beta.1', changelog: '重复请求。' }),
    })
    expect(duplicateVersionResponse.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(duplicateVersionResponse)).error.code).toBe('SKILL_VERSION_CONFLICT')

    const candidateDetailResponse = await app.request(`/api/v1/admin/skills/${skillId}`, {
      headers: { cookie: sessionCookie },
    })
    const candidateDetail = await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(candidateDetailResponse)
    expect(candidateDetail.data.currentPublishedVersionId).toBeNull()
    expect(candidateDetail.data.versions.map((version) => version.id)).toEqual([versionId])

    const getResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions/${versionId}`, {
      headers: { cookie: sessionCookie },
    })
    expect(getResponse.status).toBe(200)
    expect((await readJson<MarketplaceApiSuccess<MarketplaceAdminVersion>>(getResponse)).data.version).toBe('1.0.0-beta.1')

    const updateVersionResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions/${versionId}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: 1, version: '1.0.0', changelog: '稳定候选版本。' }),
    })
    const updatedVersion = await readJson<MarketplaceApiSuccess<MarketplaceAdminVersion>>(updateVersionResponse)
    expect(updateVersionResponse.status).toBe(200)
    expect(updatedVersion.data).toMatchObject({ version: '1.0.0', changelog: '稳定候选版本。', status: 'created', revision: 2 })

    const staleVersionResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions/${versionId}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ revision: 1, changelog: '过期编辑。' }),
    })
    expect(staleVersionResponse.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(staleVersionResponse)).error.code).toBe('VERSION_REVISION_CONFLICT')

    const deleteResponse = await app.request(`/api/v1/admin/skills/${skillId}`, {
      method: 'DELETE',
      headers: writeHeaders,
      body: JSON.stringify({ revision: 2 }),
    })
    expect(deleteResponse.status).toBe(200)
    expect((await readJson<MarketplaceApiSuccess<{ deleted: boolean }>>(deleteResponse)).data.deleted).toBe(true)

    const deletedDetailResponse = await app.request(`/api/v1/admin/skills/${skillId}`, {
      headers: { cookie: sessionCookie },
    })
    expect(deletedDetailResponse.status).toBe(404)
    const deletedListResponse = await app.request('/api/v1/admin/skills', { headers: { cookie: sessionCookie } })
    expect((await readJson<MarketplaceApiPage<MarketplaceAdminSkillSummary>>(deletedListResponse)).data).toEqual([])

    const storedSkills = await database.sql<{ deleted_at: string | null; revision: number }[]>`
      SELECT deleted_at, revision FROM skills WHERE id = ${skillId}
    `
    const storedVersions = await database.sql<{ id: string }[]>`
      SELECT id FROM skill_versions WHERE skill_id = ${skillId}
    `
    const audits = await database.sql<{
      action: string
      actor_identifier: string
      request_id: string
      skill_id: string
      version_id: string | null
      before_state: object | null
      after_state: object | null
      reason: string
      created_at: Date | string
    }[]>`
      SELECT action, actor_identifier, request_id, skill_id, version_id,
        before_state, after_state, reason, created_at
      FROM audit_entries WHERE action LIKE 'skill%'
    `
    expect(storedSkills).toHaveLength(1)
    expect(storedSkills[0]).toMatchObject({ revision: 3 })
    expect(storedSkills[0]!.deleted_at).not.toBeNull()
    expect(storedVersions.map((version) => version.id)).toEqual([versionId])
    expect(audits.map((entry) => entry.action).sort()).toEqual([
      'skill.created',
      'skill.deleted',
      'skill.updated',
      'skill_version.created',
      'skill_version.updated',
    ])
    expect(audits.every((entry) => entry.actor_identifier === 'admin'
      && entry.request_id.length > 0 && entry.skill_id === skillId
      && Boolean(entry.before_state || entry.after_state) && Boolean(entry.reason)
      && !Number.isNaN(new Date(entry.created_at).getTime()))).toBe(true)
    expect(audits.filter((entry) => entry.action.startsWith('skill_version.'))
      .every((entry) => entry.version_id === versionId)).toBe(true)
  })
})
