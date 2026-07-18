import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  MarketplaceAdminSession,
  MarketplaceAdminSkillDetail,
  MarketplaceAdminUpload,
  MarketplaceAdminVersionActionResult,
  MarketplaceApiError,
  MarketplaceApiSuccess,
  MarketplaceInstallManifest,
} from '@proma/shared'
import { initializeMarketplaceAdmin } from '../src/admin-auth'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'
import { createZipFixture } from './zip-fixture'
import { createMarketplaceCatalogClient } from '../../electron/src/main/lib/marketplace-catalog-client'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
const allowedOrigin = 'https://marketplace.test'
const signingSecret = 'test-download-signing-secret-with-32-bytes'

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`响应缺少 Cookie: ${name}`)
  return cookie.split(';', 1)[0]!.split('=', 2)[1]!
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe.skipIf(!adminDatabaseUrl)('Marketplace 审核发布黄金路径（真实 PostgreSQL 与文件系统）', () => {
  let testDatabase: MarketplaceTestDatabase
  let database: ReturnType<typeof createMarketplaceDatabase>
  let app: ReturnType<typeof createMarketplaceApp>
  let storageDir = ''
  let sessionCookie = ''
  let csrfToken = ''

  const adminHeaders = (): Record<string, string> => ({
    'content-type': 'application/json',
    origin: allowedOrigin,
    'x-csrf-token': csrfToken,
    cookie: sessionCookie,
  })

  async function createCandidate(identifier: string, version: string): Promise<{
    skillId: string
    versionId: string
    archive: Uint8Array
  }> {
    const skillResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        identifier,
        name: identifier,
        tagline: '黄金路径测试',
        description: '审核发布黄金路径测试 Skill。',
        authorName: 'Proma Labs',
        categoryId: 'automation',
        tags: ['测试'],
        icon: 'workflow',
        featured: false,
      }),
    })
    const skill = await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(skillResponse)
    return createVersionCandidate(skill.data.id, identifier, version)
  }

  async function createVersionCandidate(skillId: string, identifier: string, version: string): Promise<{
    skillId: string
    versionId: string
    archive: Uint8Array
  }> {
    const versionResponse = await app.request(`/api/v1/admin/skills/${skillId}/versions`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ version, changelog: `发布 ${version}` }),
    })
    const created = await readJson<MarketplaceApiSuccess<{ id: string }>>(versionResponse)
    const archive = createZipFixture([
      {
        path: `${identifier}/SKILL.md`,
        content: `---\nname: ${identifier}\ndescription: 黄金路径测试\nversion: ${version}\n---\n# ${identifier}\n`,
      },
      { path: `${identifier}/references/guide.md`, content: '# 使用说明\n' },
    ])
    const uploadResponse = await app.request(
      `/api/v1/admin/skills/${skillId}/versions/${created.data.id}/uploads`,
      {
        method: 'POST',
        headers: {
          ...adminHeaders(),
          'content-type': 'application/zip',
          'x-file-name': `${identifier}.zip`,
        },
        body: archive,
      },
    )
    const accepted = await readJson<MarketplaceApiSuccess<MarketplaceAdminUpload>>(uploadResponse)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.request(
        `/api/v1/admin/skills/${skillId}/versions/${created.data.id}/uploads/${accepted.data.id}`,
        { headers: { cookie: sessionCookie } },
      )
      const upload = await readJson<MarketplaceApiSuccess<MarketplaceAdminUpload>>(response)
      if (upload.data.status === 'succeeded') {
        return { skillId, versionId: created.data.id, archive }
      }
      if (upload.data.status === 'failed') throw new Error(`测试 Skill 包校验失败: ${upload.data.lastError}`)
      await Bun.sleep(20)
    }
    throw new Error('等待测试 Skill 包校验超时')
  }

  async function action(
    skillId: string,
    versionId: string,
    name: 'submit_review' | 'approve' | 'publish',
  ): Promise<{ response: Response; body: MarketplaceApiSuccess<MarketplaceAdminVersionActionResult> }> {
    const response = await app.request(
      `/api/v1/admin/skills/${skillId}/versions/${versionId}/actions/${name}`,
      { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ reason: `测试动作 ${name}` }) },
    )
    return { response, body: await readJson<MarketplaceApiSuccess<MarketplaceAdminVersionActionResult>>(response) }
  }

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    database = createMarketplaceDatabase(testDatabase.databaseUrl)
    storageDir = await mkdtemp(join(tmpdir(), 'proma-marketplace-publish-'))
    await runMarketplaceMigrations(database.sql)
    await initializeMarketplaceAdmin(database, {
      username: 'admin',
      initialPassword: 'initial-password-123',
      requestId: 'publish-bootstrap',
    })
    await database.sql`INSERT INTO categories (id, name, icon) VALUES ('automation', '效率自动化', 'workflow')`
    app = createMarketplaceApp({
      database,
      allowedOrigin,
      storageDir,
      downloadSigningSecret: signingSecret,
      now: () => new Date('2026-07-18T05:00:00.000Z'),
    })

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
    await app.request('/api/v1/admin/auth/change-password', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })
  })

  afterAll(async () => {
    await closeSql(database.sql)
    await testDatabase.close()
    await rm(storageDir, { recursive: true, force: true })
  })

  test('Given 校验通过候选版本 When 提交审核、批准并发布 Then 幂等审计、切换指针并提供五分钟签名下载', async () => {
    const candidate = await createCandidate('golden-skill', '1.0.0')

    const submitted = await action(candidate.skillId, candidate.versionId, 'submit_review')
    expect(submitted.response.status).toBe(200)
    expect(submitted.body.data).toMatchObject({ changed: true, version: { status: 'pending_review' } })
    expect(submitted.body.data.skill.currentPublishedVersionId).toBeNull()

    const retried = await action(candidate.skillId, candidate.versionId, 'submit_review')
    expect(retried.body.data).toMatchObject({ changed: false, version: { status: 'pending_review' } })
    expect(retried.body.data.skill.currentPublishedVersionId).toBeNull()

    const approved = await action(candidate.skillId, candidate.versionId, 'approve')
    expect(approved.body.data).toMatchObject({ changed: true, version: { status: 'approved' } })
    expect(approved.body.data.skill.currentPublishedVersionId).toBeNull()

    const published = await action(candidate.skillId, candidate.versionId, 'publish')
    expect(published.body.data).toMatchObject({
      changed: true,
      skill: { status: 'published', currentPublishedVersionId: candidate.versionId },
      version: { status: 'published' },
    })
    const publishRetry = await action(candidate.skillId, candidate.versionId, 'publish')
    expect(publishRetry.body.data).toMatchObject({ changed: false, version: { status: 'published' } })

    const publicResponse = await app.request('/api/v1/marketplace/skills/golden-skill')
    expect(publicResponse.status).toBe(200)
    const electronClient = createMarketplaceCatalogClient({
      runtime: 'production',
      enableFixture: false,
      apiBaseUrl: `${allowedOrigin}/api/v1`,
      fetchFn: async (input, init) => app.fetch(
        input instanceof Request ? input : new Request(input.toString(), init),
      ),
    })
    expect((await electronClient.listSkills({
      query: 'golden-skill', sort: 'latest', page: 1, pageSize: 16,
    })).items[0]?.identifier).toBe('golden-skill')
    const manifestResponse = await app.request('/api/v1/marketplace/skills/golden-skill/versions/1.0.0/manifest')
    const manifest = await readJson<MarketplaceApiSuccess<MarketplaceInstallManifest>>(manifestResponse)
    expect(manifest.data.downloadUrl).toMatch(/^https:\/\/marketplace\.test\/api\/v1\/marketplace\/downloads\//)
    expect(JSON.stringify(manifest)).not.toContain(storageDir)

    const downloadResponse = await app.request(manifest.data.downloadUrl!)
    const downloaded = new Uint8Array(await downloadResponse.arrayBuffer())
    expect(downloadResponse.status).toBe(200)
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(createHash('sha256').update(candidate.archive).digest('hex'))
    expect(await readFile(join(storageDir, 'published', 'golden-skill', '1.0.0', 'package.zip'))).toEqual(Buffer.from(candidate.archive))

    const tamperedUrl = new URL(manifest.data.downloadUrl!)
    tamperedUrl.searchParams.set('signature', 'tampered')
    const tamperedResponse = await app.request(tamperedUrl.toString())
    expect(tamperedResponse.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(tamperedResponse)).error.code).toBe('DOWNLOAD_SIGNATURE_INVALID')

    const expiredUrl = new URL(manifest.data.downloadUrl!)
    expiredUrl.searchParams.set('expires', '1')
    const expiredResponse = await app.request(expiredUrl.toString())
    expect(expiredResponse.status).toBe(403)
    expect((await readJson<MarketplaceApiError>(expiredResponse)).error.code).toBe('DOWNLOAD_URL_EXPIRED')

    const audits = await database.sql<{
      action: string
      actor_identifier: string
      request_id: string
      before_state: { status: string }
      after_state: { status: string; changed: boolean }
      reason: string
    }[]>`
      SELECT action, actor_identifier, request_id, before_state, after_state, reason
      FROM audit_entries
      WHERE action IN ('skill_version.submit_review', 'skill_version.approve', 'skill_version.publish')
        AND after_state->>'versionId' = ${candidate.versionId}
      ORDER BY created_at, id
    `
    expect(audits.filter((entry) => entry.action.includes('submit_review'))).toHaveLength(2)
    expect(audits.every((entry) => entry.actor_identifier === 'admin'
      && Boolean(entry.request_id) && Boolean(entry.before_state) && Boolean(entry.after_state) && Boolean(entry.reason))).toBe(true)
  })

  test('Given 已有线上版本 When 新版本审核批准 Then 仅在发布事务成功后切换指针并下线旧版本', async () => {
    const first = await createCandidate('pointer-skill', '1.0.0')
    await action(first.skillId, first.versionId, 'submit_review')
    await action(first.skillId, first.versionId, 'approve')
    await action(first.skillId, first.versionId, 'publish')

    const candidate = await createVersionCandidate(first.skillId, 'pointer-skill', '1.1.0')
    const submitted = await action(candidate.skillId, candidate.versionId, 'submit_review')
    const approved = await action(candidate.skillId, candidate.versionId, 'approve')
    expect(submitted.body.data.skill.currentPublishedVersionId).toBe(first.versionId)
    expect(approved.body.data.skill.currentPublishedVersionId).toBe(first.versionId)

    const published = await action(candidate.skillId, candidate.versionId, 'publish')
    expect(published.body.data.skill.currentPublishedVersionId).toBe(candidate.versionId)
    const versions = await database.sql<{ id: string; status: string }[]>`
      SELECT id, status FROM skill_versions WHERE id IN (${first.versionId}, ${candidate.versionId}) ORDER BY version
    `
    expect([...versions]).toEqual([
      { id: first.versionId, status: 'unpublished' },
      { id: candidate.versionId, status: 'published' },
    ])
  })

  test('Given 数据库在发布事务中失败 When 发布 Then 保留旧指针并清理半发布目录', async () => {
    const candidate = await createCandidate('rollback-skill', '1.0.0')
    await action(candidate.skillId, candidate.versionId, 'submit_review')
    await action(candidate.skillId, candidate.versionId, 'approve')
    await database.sql.unsafe(`
      CREATE FUNCTION reject_marketplace_pointer() RETURNS trigger AS $$
      BEGIN
        IF NEW.current_published_version_id IS NOT NULL THEN
          RAISE EXCEPTION 'injected publish failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_marketplace_pointer
      BEFORE UPDATE ON skills
      FOR EACH ROW EXECUTE FUNCTION reject_marketplace_pointer();
    `)

    try {
      const response = await app.request(
        `/api/v1/admin/skills/${candidate.skillId}/versions/${candidate.versionId}/actions/publish`,
        { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ reason: '注入失败' }) },
      )
      expect(response.status).toBe(500)
      const rows = await database.sql<{ status: string; current_published_version_id: string | null }[]>`
        SELECT versions.status, skills.current_published_version_id
        FROM skill_versions versions INNER JOIN skills ON skills.id = versions.skill_id
        WHERE versions.id = ${candidate.versionId}
      `
      expect(rows[0]).toEqual({ status: 'approved', current_published_version_id: null })
      expect(await Bun.file(join(storageDir, 'published', 'rollback-skill', '1.0.0', 'package.zip')).exists()).toBe(false)
    } finally {
      await database.sql.unsafe('DROP TRIGGER reject_marketplace_pointer ON skills; DROP FUNCTION reject_marketplace_pointer();')
    }
  })

  test('Given 发布目标目录冲突 When 发布 Then 拒绝覆盖并保持批准状态', async () => {
    const candidate = await createCandidate('filesystem-skill', '1.0.0')
    await action(candidate.skillId, candidate.versionId, 'submit_review')
    await action(candidate.skillId, candidate.versionId, 'approve')
    const finalDirectory = join(storageDir, 'published', 'filesystem-skill', '1.0.0')
    await mkdir(finalDirectory, { recursive: true })
    await writeFile(join(finalDirectory, 'sentinel.txt'), '保留现有目录')

    const response = await app.request(
      `/api/v1/admin/skills/${candidate.skillId}/versions/${candidate.versionId}/actions/publish`,
      { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ reason: '文件系统冲突' }) },
    )
    expect(response.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(response)).error.code).toBe('PUBLISHED_PACKAGE_CONFLICT')
    const rows = await database.sql<{ status: string; current_published_version_id: string | null }[]>`
      SELECT versions.status, skills.current_published_version_id
      FROM skill_versions versions INNER JOIN skills ON skills.id = versions.skill_id
      WHERE versions.id = ${candidate.versionId}
    `
    expect(rows[0]).toEqual({ status: 'approved', current_published_version_id: null })
    expect(await readFile(join(finalDirectory, 'sentinel.txt'), 'utf8')).toBe('保留现有目录')
    expect(await readdir(join(storageDir, 'published', '.staging'))).toEqual([])
  })
})
