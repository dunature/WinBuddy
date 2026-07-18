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
  MarketplaceBulkGovernanceResult,
  MarketplaceVersionGovernanceAction,
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
  let idempotencySequence = 0

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
    name: MarketplaceVersionGovernanceAction,
    options: { reason?: string; idempotencyKey?: string } = {},
  ): Promise<{ response: Response; body: MarketplaceApiSuccess<MarketplaceAdminVersionActionResult> }> {
    const response = await app.request(
      `/api/v1/admin/skills/${skillId}/versions/${versionId}/actions/${name}`,
      {
        method: 'POST',
        headers: {
          ...adminHeaders(),
          'idempotency-key': options.idempotencyKey ?? `publish-test-${idempotencySequence += 1}`,
        },
        body: JSON.stringify({ reason: options.reason ?? `测试动作 ${name}` }),
      },
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
    await database.sql`
      INSERT INTO categories (id, name, normalized_name, icon)
      VALUES ('automation', '效率自动化', '效率自动化', 'workflow')
    `
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
      skill_id: string
      version_id: string
      before_state: { status: string }
      after_state: { status: string; changed: boolean }
      reason: string
    }[]>`
      SELECT action, actor_identifier, request_id, skill_id, version_id, before_state, after_state, reason
      FROM audit_entries
      WHERE action IN ('skill_version.submit_review', 'skill_version.approve', 'skill_version.publish')
        AND version_id = ${candidate.versionId}
      ORDER BY created_at, id
    `
    expect(audits.filter((entry) => entry.action.includes('submit_review'))).toHaveLength(2)
    expect(audits.every((entry) => entry.actor_identifier === 'admin'
      && entry.skill_id === candidate.skillId && entry.version_id === candidate.versionId
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
    const publishAudits = await database.sql<{
      before_state: { skillRevision: number }
      after_state: { skillRevision: number }
    }[]>`
      SELECT before_state, after_state FROM audit_entries
      WHERE action = 'skill_version.publish' AND after_state->>'versionId' = ${candidate.versionId}
      ORDER BY created_at DESC LIMIT 1
    `
    expect(publishAudits[0]?.after_state.skillRevision)
      .toBe((publishAudits[0]?.before_state.skillRevision ?? 0) + 1)
    const historical = published.body.data.skill.versions.find((version) => version.id === first.versionId)
    expect(historical).toMatchObject({ allowedActions: ['archive'], nextAction: 'archive' })

    const archived = await action(first.skillId, first.versionId, 'archive', { reason: '归档历史版本' })
    expect(archived.body.data).toMatchObject({
      version: { status: 'archived' },
      skill: { status: 'published', currentPublishedVersionId: candidate.versionId },
    })
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
        {
          method: 'POST',
          headers: { ...adminHeaders(), 'idempotency-key': 'publish-injected-failure' },
          body: JSON.stringify({ reason: '注入失败' }),
        },
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
      {
        method: 'POST',
        headers: { ...adminHeaders(), 'idempotency-key': 'publish-filesystem-conflict' },
        body: JSON.stringify({ reason: '文件系统冲突' }),
      },
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

  test('Given 候选版本审核分支 When 驳回、返回编辑和撤回 Then 服务端决策驱动且旧线上指针不变', async () => {
    const current = await createCandidate('review-branches', '1.0.0')
    await action(current.skillId, current.versionId, 'submit_review')
    await action(current.skillId, current.versionId, 'approve')
    await action(current.skillId, current.versionId, 'publish')
    const candidate = await createVersionCandidate(current.skillId, 'review-branches', '1.1.0')

    await action(candidate.skillId, candidate.versionId, 'submit_review')
    const rejected = await action(candidate.skillId, candidate.versionId, 'reject', { reason: '缺少变更说明' })
    expect(rejected.body.data).toMatchObject({
      version: { status: 'rejected', allowedActions: ['reupload', 'return_to_edit', 'archive'], nextAction: 'return_to_edit' },
      skill: { currentPublishedVersionId: current.versionId },
    })

    const returned = await action(candidate.skillId, candidate.versionId, 'return_to_edit', { reason: '按意见修订' })
    expect(returned.body.data).toMatchObject({
      version: { status: 'created', nextAction: 'submit_review' },
      skill: { currentPublishedVersionId: current.versionId },
    })

    await action(candidate.skillId, candidate.versionId, 'submit_review')
    await action(candidate.skillId, candidate.versionId, 'approve')
    const withdrawn = await action(candidate.skillId, candidate.versionId, 'withdraw', { reason: '发布前主动撤回' })
    expect(withdrawn.body.data).toMatchObject({
      version: { status: 'created', nextAction: 'submit_review' },
      skill: { currentPublishedVersionId: current.versionId },
    })
  })

  test('Given 当前线上版本 When 下架、重新发布并归档 Then 公开可见性与指针保持事务一致', async () => {
    const current = await createCandidate('release-governance', '1.0.0')
    await action(current.skillId, current.versionId, 'submit_review')
    await action(current.skillId, current.versionId, 'approve')
    await action(current.skillId, current.versionId, 'publish')

    const unpublished = await action(current.skillId, current.versionId, 'unpublish', { reason: '临时下架整改' })
    expect(unpublished.body.data).toMatchObject({
      version: { status: 'unpublished', allowedActions: ['republish', 'archive'], nextAction: 'republish' },
      skill: { status: 'unpublished', currentPublishedVersionId: null },
    })
    expect((await app.request('/api/v1/marketplace/skills/release-governance')).status).toBe(404)

    const republished = await action(current.skillId, current.versionId, 'republish')
    expect(republished.body.data).toMatchObject({
      version: { status: 'published', nextAction: 'unpublish' },
      skill: { status: 'published', currentPublishedVersionId: current.versionId },
    })
    expect((await app.request('/api/v1/marketplace/skills/release-governance')).status).toBe(200)

    await action(current.skillId, current.versionId, 'unpublish', { reason: '永久下架' })
    const archived = await action(current.skillId, current.versionId, 'archive', { reason: '结束维护' })
    expect(archived.body.data).toMatchObject({
      version: { status: 'archived', allowedActions: [], nextAction: null },
      skill: { status: 'archived', currentPublishedVersionId: null },
    })
    const createAfterArchive = await app.request(`/api/v1/admin/skills/${current.skillId}/versions`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ version: '1.1.0', changelog: '不应创建' }),
    })
    expect(createAfterArchive.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(createAfterArchive)).error.code)
      .toBe('SKILL_VERSION_CREATION_NOT_ALLOWED')
  })

  test('Given 治理写请求 When 缺少原因、幂等键或复用其他动作键 Then 返回稳定错误且同键重试不重复写记录', async () => {
    const candidate = await createCandidate('governance-guards', '1.0.0')
    const missingKey = await app.request(
      `/api/v1/admin/skills/${candidate.skillId}/versions/${candidate.versionId}/actions/submit_review`,
      { method: 'POST', headers: adminHeaders(), body: '{}' },
    )
    expect(missingKey.status).toBe(400)
    expect((await readJson<MarketplaceApiError>(missingKey)).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const illegal = await app.request(
      `/api/v1/admin/skills/${candidate.skillId}/versions/${candidate.versionId}/actions/approve`,
      {
        method: 'POST',
        headers: { ...adminHeaders(), 'idempotency-key': 'governance-illegal-approve' },
        body: '{}',
      },
    )
    expect(illegal.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(illegal)).error.code).toBe('VERSION_ACTION_NOT_ALLOWED')

    const key = 'governance-guard-submit'
    const submitted = await action(candidate.skillId, candidate.versionId, 'submit_review', { idempotencyKey: key })
    const replay = await action(candidate.skillId, candidate.versionId, 'submit_review', { idempotencyKey: key })
    expect(submitted.body.data.changed).toBe(true)
    expect(replay.body.data.changed).toBe(false)

    const noReason = await app.request(
      `/api/v1/admin/skills/${candidate.skillId}/versions/${candidate.versionId}/actions/reject`,
      {
        method: 'POST',
        headers: { ...adminHeaders(), 'idempotency-key': 'governance-reject-no-reason' },
        body: '{}',
      },
    )
    expect(noReason.status).toBe(400)
    expect((await readJson<MarketplaceApiError>(noReason)).error.code).toBe('ACTION_REASON_REQUIRED')

    const reused = await app.request(
      `/api/v1/admin/skills/${candidate.skillId}/versions/${candidate.versionId}/actions/approve`,
      {
        method: 'POST',
        headers: { ...adminHeaders(), 'idempotency-key': key },
        body: '{}',
      },
    )
    expect(reused.status).toBe(409)
    expect((await readJson<MarketplaceApiError>(reused)).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const records = await database.sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM review_records WHERE idempotency_key = ${key}
    `
    expect(records[0]?.count).toBe(1)
  })

  test('Given 两个并发批准请求 When 竞争同一版本锁 Then 一次转换一次幂等完成且指针不变', async () => {
    const candidate = await createCandidate('concurrent-review', '1.0.0')
    await action(candidate.skillId, candidate.versionId, 'submit_review')

    const results = await Promise.all([
      action(candidate.skillId, candidate.versionId, 'approve', { idempotencyKey: 'concurrent-approve-one' }),
      action(candidate.skillId, candidate.versionId, 'approve', { idempotencyKey: 'concurrent-approve-two' }),
    ])

    expect(results.map((result) => result.body.data.changed).sort()).toEqual([false, true])
    expect(results.every((result) => result.body.data.version.status === 'approved'
      && result.body.data.skill.currentPublishedVersionId === null)).toBe(true)
  })

  test('Given 混合状态目标 When 批量下架、归档和删除草稿 Then 独立提交并返回成功跳过失败与逐项审计', async () => {
    const current = await createCandidate('bulk-current', '1.0.0')
    await action(current.skillId, current.versionId, 'submit_review')
    await action(current.skillId, current.versionId, 'approve')
    await action(current.skillId, current.versionId, 'publish')
    const candidate = await createVersionCandidate(current.skillId, 'bulk-current', '1.1.0')

    const bulk = async (
      name: 'unpublish' | 'archive' | 'delete_draft',
      key: string,
      items: Array<{ key: string; skillId: string; versionId?: string; revision?: number }>,
    ): Promise<MarketplaceBulkGovernanceResult> => {
      const response = await app.request(`/api/v1/admin/bulk-actions/${name}`, {
        method: 'POST',
        headers: { ...adminHeaders(), 'idempotency-key': key },
        body: JSON.stringify({ reason: `批量测试 ${name}`, items }),
      })
      expect(response.status).toBe(200)
      return (await readJson<MarketplaceApiSuccess<MarketplaceBulkGovernanceResult>>(response)).data
    }

    const mixed = await bulk('unpublish', 'bulk-unpublish-mixed', [
      { key: 'current', skillId: current.skillId, versionId: current.versionId },
      { key: 'candidate', skillId: candidate.skillId, versionId: candidate.versionId },
    ])
    expect(mixed.succeeded.map((item) => item.key)).toEqual(['current'])
    expect(mixed.failed).toEqual([
      expect.objectContaining({ key: 'candidate', outcome: 'failed', code: 'VERSION_ACTION_NOT_ALLOWED' }),
    ])

    const skipped = await bulk('unpublish', 'bulk-unpublish-skipped', [
      { key: 'current', skillId: current.skillId, versionId: current.versionId },
    ])
    expect(skipped.skipped).toEqual([
      expect.objectContaining({ key: 'current', outcome: 'skipped', code: 'TARGET_ALREADY_STATE' }),
    ])

    const archived = await bulk('archive', 'bulk-archive-current', [
      { key: 'current', skillId: current.skillId, versionId: current.versionId },
    ])
    expect(archived.succeeded.map((item) => item.key)).toEqual(['current'])

    const draft = await createCandidate('bulk-delete-draft', '1.0.0')
    const draftRows = await database.sql<{ revision: number }[]>`
      SELECT revision FROM skills WHERE id = ${draft.skillId}
    `
    const deleted = await bulk('delete_draft', 'bulk-delete-success', [
      { key: 'draft', skillId: draft.skillId, revision: draftRows[0]!.revision },
      { key: 'published', skillId: current.skillId, revision: 1 },
    ])
    expect(deleted.succeeded.map((item) => item.key)).toEqual(['draft'])
    expect(deleted.failed).toEqual([
      expect.objectContaining({ key: 'published', outcome: 'failed', code: 'SKILL_NOT_DELETABLE' }),
    ])
    const deletedAgain = await bulk('delete_draft', 'bulk-delete-skipped', [
      { key: 'draft', skillId: draft.skillId, revision: draftRows[0]!.revision },
    ])
    expect(deletedAgain.skipped).toEqual([
      expect.objectContaining({ key: 'draft', outcome: 'skipped', code: 'TARGET_ALREADY_DELETED' }),
    ])

    const concurrent = await createCandidate('bulk-concurrent', '1.0.0')
    await action(concurrent.skillId, concurrent.versionId, 'submit_review')
    await action(concurrent.skillId, concurrent.versionId, 'approve')
    await action(concurrent.skillId, concurrent.versionId, 'publish')
    const concurrentResults = await Promise.all([
      bulk('unpublish', 'bulk-concurrent-one', [
        { key: 'concurrent-one', skillId: concurrent.skillId, versionId: concurrent.versionId },
      ]),
      bulk('unpublish', 'bulk-concurrent-two', [
        { key: 'concurrent-two', skillId: concurrent.skillId, versionId: concurrent.versionId },
      ]),
    ])
    expect(concurrentResults.flatMap((result) => [
      ...result.succeeded.map((item) => item.outcome),
      ...result.skipped.map((item) => item.outcome),
    ]).sort()).toEqual(['skipped', 'succeeded'])

    const audits = await database.sql<{
      action: string
      request_id: string
      actor_identifier: string
      skill_id: string
      version_id: string | null
      before_state: Record<string, unknown>
      after_state: Record<string, unknown>
      reason: string
    }[]>`
      SELECT action, request_id, actor_identifier, skill_id, version_id, before_state, after_state, reason
      FROM audit_entries WHERE action LIKE 'bulk.%'
    `
    expect(audits).toHaveLength(9)
    expect(audits.every((entry) => Boolean(entry.request_id))).toBe(true)
    expect(audits.every((entry) => entry.actor_identifier === 'admin'
      && Boolean(entry.before_state.key) && Boolean(entry.after_state.outcome)
      && entry.reason.startsWith('批量测试'))).toBe(true)
    expect(audits.every((entry) => Boolean(entry.skill_id))).toBe(true)
  })
})
