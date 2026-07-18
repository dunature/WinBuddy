import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  MarketplaceAdminSession,
  MarketplaceAdminSkillDetail,
  MarketplaceAdminUpload,
  MarketplaceApiSuccess,
} from '@proma/shared'
import { initializeMarketplaceAdmin } from '../src/admin-auth'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'
import { createZipFixture } from './zip-fixture'

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

describe.skipIf(!adminDatabaseUrl)('Marketplace 包上传与校验 API（真实 PostgreSQL 与文件系统）', () => {
  let testDatabase: MarketplaceTestDatabase
  let database: ReturnType<typeof createMarketplaceDatabase>
  let app: ReturnType<typeof createMarketplaceApp>
  let storageDir = ''
  let sessionCookie = ''
  let csrfToken = ''
  let skillId = ''
  let versionId = ''

  async function createVersion(version: string): Promise<string> {
    const response = await app.request(`/api/v1/admin/skills/${skillId}/versions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: allowedOrigin,
        'x-csrf-token': csrfToken, cookie: sessionCookie,
      },
      body: JSON.stringify({ version, changelog: `候选版本 ${version}` }),
    })
    return (await readJson<MarketplaceApiSuccess<{ id: string }>>(response)).data.id
  }

  async function uploadZip(targetVersionId: string, zip: Uint8Array): Promise<MarketplaceAdminUpload> {
    const response = await app.request(`/api/v1/admin/skills/${skillId}/versions/${targetVersionId}/uploads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'x-file-name': encodeURIComponent('daily-briefing.zip'),
        origin: allowedOrigin,
        'x-csrf-token': csrfToken,
        cookie: sessionCookie,
      },
      body: zip,
    })
    expect(response.status).toBe(202)
    return (await readJson<MarketplaceApiSuccess<MarketplaceAdminUpload>>(response)).data
  }

  async function waitForUpload(
    targetApp: ReturnType<typeof createMarketplaceApp>,
    targetVersionId: string,
    uploadId: string,
  ): Promise<MarketplaceAdminUpload> {
    let upload: MarketplaceAdminUpload | undefined
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await targetApp.request(
        `/api/v1/admin/skills/${skillId}/versions/${targetVersionId}/uploads/${uploadId}`,
        { headers: { cookie: sessionCookie } },
      )
      upload = (await readJson<MarketplaceApiSuccess<MarketplaceAdminUpload>>(response)).data
      if (upload.status === 'succeeded' || upload.status === 'failed') return upload
      await Bun.sleep(20)
    }
    throw new Error(`等待上传校验超时: ${uploadId}，最后状态 ${upload?.status ?? 'unknown'}`)
  }

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    database = createMarketplaceDatabase(testDatabase.databaseUrl)
    storageDir = await mkdtemp(join(tmpdir(), 'proma-marketplace-upload-'))
    await runMarketplaceMigrations(database.sql)
    await initializeMarketplaceAdmin(database, {
      username: 'admin',
      initialPassword: 'initial-password-123',
      requestId: 'uploads-bootstrap',
    })
    await database.sql`INSERT INTO categories (id, name, icon) VALUES ('automation', '效率自动化', 'workflow')`
    app = createMarketplaceApp({ database, allowedOrigin, storageDir })

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
      headers: {
        'content-type': 'application/json',
        origin: allowedOrigin,
        'x-csrf-token': csrfToken,
        cookie: sessionCookie,
      },
      body: JSON.stringify({ currentPassword: 'initial-password-123', newPassword: 'updated-password-456' }),
    })

    const createSkillResponse = await app.request('/api/v1/admin/skills', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: allowedOrigin,
        'x-csrf-token': csrfToken, cookie: sessionCookie,
      },
      body: JSON.stringify({
        identifier: 'daily-briefing', name: '每日简报', tagline: '自动整理每日进展',
        description: '生成结构化每日简报。', authorName: 'Proma Labs', categoryId: 'automation',
        tags: ['自动化'], icon: 'workflow', featured: false,
      }),
    })
    const skill = await readJson<MarketplaceApiSuccess<MarketplaceAdminSkillDetail>>(createSkillResponse)
    skillId = skill.data.id
    versionId = await createVersion('1.0.0')
  })

  afterAll(async () => {
    await closeSql(database.sql)
    await testDatabase.close()
    await rm(storageDir, { recursive: true, force: true })
  })

  test('Given 合法 ZIP When 流式上传并轮询 Then 持久化通过报告并更新候选版本元数据', async () => {
    const zip = createZipFixture([
      {
        path: 'daily-briefing/SKILL.md',
        content: '---\nname: daily-briefing\ndescription: 自动生成每日简报\nversion: 1.0.0\n---\n# 每日简报\n',
      },
      { path: 'daily-briefing/references/guide.md', content: '# 使用说明\n' },
    ])
    const accepted = await uploadZip(versionId, zip)
    expect(accepted).toMatchObject({ versionId, originalFilename: 'daily-briefing.zip' })
    expect(['queued', 'running', 'succeeded']).toContain(accepted.status)

    const upload = await waitForUpload(app, versionId, accepted.id)

    expect(upload.status).toBe('succeeded')
    expect(upload.size).toBe(zip.byteLength)
    expect(upload.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(upload.report?.passed).toBe(true)
    expect(upload.report?.fileCount).toBe(2)
    expect(upload.report?.checks.every((check) => check.passed)).toBe(true)
    expect(upload.versionStatus).toBe('created')
    expect(JSON.stringify(upload)).not.toContain(storageDir)

    const listResponse = await app.request(
      `/api/v1/admin/skills/${skillId}/versions/${versionId}/uploads`,
      { headers: { cookie: sessionCookie } },
    )
    const history = await readJson<MarketplaceApiSuccess<MarketplaceAdminUpload[]>>(listResponse)
    expect(history.data.map((item) => item.id)).toEqual([upload.id])

    const versions = await database.sql<{ sha256: string; size: number; file_count: number; status: string }[]>`
      SELECT sha256, size, file_count, status FROM skill_versions WHERE id = ${versionId}
    `
    expect(versions[0]).toMatchObject({ sha256: upload.sha256, size: zip.byteLength, file_count: 2, status: 'created' })
  })

  test('Given 首次校验失败 When 重新上传合法包 Then 保留失败报告并追加成功记录', async () => {
    const targetVersionId = await createVersion('1.1.0')
    const invalidZip = createZipFixture([
      { path: 'daily-briefing/README.md', content: '# 缺少 SKILL.md\n' },
      { path: 'daily-briefing/link', content: 'target', externalFileAttributes: 0o120777 << 16 },
    ])
    const failedUpload = await waitForUpload(app, targetVersionId, (await uploadZip(targetVersionId, invalidZip)).id)

    expect(failedUpload.status).toBe('failed')
    expect(failedUpload.versionStatus).toBe('validation_failed')
    expect(failedUpload.report?.passed).toBe(false)
    expect(failedUpload.report?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ZIP_SYMLINK', passed: false }),
      expect.objectContaining({ code: 'SKILL_MD_MISSING', passed: false }),
    ]))

    const validZip = createZipFixture([{
      path: 'daily-briefing/SKILL.md',
      content: '---\nname: daily-briefing\ndescription: 自动生成每日简报\nversion: 1.1.0\n---\n',
    }])
    const succeededUpload = await waitForUpload(app, targetVersionId, (await uploadZip(targetVersionId, validZip)).id)
    expect(succeededUpload.status).toBe('succeeded')
    expect(succeededUpload.versionStatus).toBe('created')

    const response = await app.request(
      `/api/v1/admin/skills/${skillId}/versions/${targetVersionId}/uploads`,
      { headers: { cookie: sessionCookie } },
    )
    const history = (await readJson<MarketplaceApiSuccess<MarketplaceAdminUpload[]>>(response)).data
    expect(history.map((item) => item.id)).toEqual([succeededUpload.id, failedUpload.id])
    expect(history[1]?.report).toEqual(failedUpload.report)
  })

  test('Given 未声明长度的超限流 When 上传 Then 达到 20 MB 后中止并清理隔离临时文件', async () => {
    let emittedChunks = 0
    const megabyte = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emittedChunks < 20) controller.enqueue(megabyte)
        else if (emittedChunks === 20) controller.enqueue(new Uint8Array([1]))
        else controller.close()
        emittedChunks += 1
      },
    })
    const response = await app.fetch(new Request(
      `http://localhost/api/v1/admin/skills/${skillId}/versions/${versionId}/uploads`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/zip', 'x-file-name': 'oversized.zip',
          origin: allowedOrigin, 'x-csrf-token': csrfToken, cookie: sessionCookie,
        },
        body,
      },
    ))

    expect(response.status).toBe(413)
    expect(await readdir(join(storageDir, 'quarantine', '.incoming'))).toEqual([])
  })

  test('Given 损坏的 ZIP When 校验 Then 报告只标记归档格式失败而不保留同规则成功项', async () => {
    const targetVersionId = await createVersion('1.1.1')
    const upload = await waitForUpload(
      app,
      targetVersionId,
      (await uploadZip(targetVersionId, new Uint8Array([1, 2, 3]))).id,
    )

    expect(upload.status).toBe('failed')
    expect(upload.report?.checks).toContainEqual(expect.objectContaining({
      code: 'ZIP_INVALID_ARCHIVE',
      passed: false,
    }))
    expect(upload.report?.checks.some((check) => check.code === 'ZIP_ENTRY_TYPES_SAFE')).toBe(false)
  })

  test('Given 服务中断时任务为 running When 新实例启动 Then 恢复 queued 并完成校验', async () => {
    const targetVersionId = await createVersion('1.2.0')
    const zip = createZipFixture([{
      path: 'daily-briefing/SKILL.md',
      content: '---\nname: daily-briefing\ndescription: 自动生成每日简报\nversion: 1.2.0\n---\n',
    }])
    const uploadId = randomUUID()
    const storageKey = `quarantine/${uploadId}.zip`
    await writeFile(join(storageDir, storageKey), zip)
    const admin = await database.sql<{ id: string }[]>`SELECT id FROM admins LIMIT 1`
    await database.sql`
      INSERT INTO uploads (
        id, skill_version_id, original_filename, storage_key, sha256, size,
        status, attempt_count, created_by, started_at
      ) VALUES (
        ${uploadId}, ${targetVersionId}, 'recovery.zip', ${storageKey},
        ${createHash('sha256').update(zip).digest('hex')}, ${zip.byteLength},
        'running', 1, ${admin[0]!.id}, now()
      )
    `

    const recoveredApp = createMarketplaceApp({ database, allowedOrigin, storageDir })
    const recovered = await waitForUpload(recoveredApp, targetVersionId, uploadId)
    expect(recovered.status).toBe('succeeded')
    expect(recovered.attemptCount).toBe(2)
    expect(recovered.report?.passed).toBe(true)
  })
})
