import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import AdmZip from 'adm-zip'
import postgres from 'postgres'
import type { MarketplaceAdminUser, MarketplaceAuditEntry, MarketplaceCreateSubmissionResult, MarketplaceReviewResult, MarketplaceSkillDetail, MarketplaceSubmissionDetail, MarketplaceSubmissionSummary } from '@proma/shared'
import { createMarketplaceApp } from './app.ts'
import { AdminAuthService } from './auth/admin-auth.ts'
import { loadMarketplaceApiConfig } from './config.ts'
import { runMarketplaceMigrations } from './db/migrate.ts'
import { AdminManagementService } from './management/admin-management-service.ts'
import { MemoryMarketplaceObjectStore } from './object-store/memory-object-store.ts'
import { publishedPackageKey, quarantinePackageKey } from './object-store/object-store.ts'
import { PostgresMarketplaceRepository } from './repository/postgres-marketplace-repository.ts'
import { PostgresReviewService } from './reviews/review-service.ts'
import { PostgresSubmissionRepository, SubmissionService } from './submissions/submission-service.ts'
import { MarketplaceValidationRunner, PostgresValidationRepository } from './validation/validation-runner.ts'

const ADMIN_DATABASE_URL = process.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL ?? (process.env.CI ? undefined : 'postgres://localhost/postgres')
const DATABASE_NAME = `proma_marketplace_test_${randomUUID().replaceAll('-', '')}`
const databaseUrl = ADMIN_DATABASE_URL ? withDatabase(ADMIN_DATABASE_URL, DATABASE_NAME) : 'postgres://localhost/marketplace_test_not_configured'
const editor: MarketplaceAdminUser = { githubLogin: 'editor-one', displayName: 'Editor One', role: 'editor' }
const reviewer: MarketplaceAdminUser = { githubLogin: 'reviewer-one', displayName: 'Reviewer One', role: 'reviewer' }
const admin: MarketplaceAdminUser = { githubLogin: 'admin-one', displayName: 'Admin One', role: 'admin' }

let currentUser = editor
let app: ReturnType<typeof createMarketplaceApp>
class ControlledMemoryObjectStore extends MemoryMarketplaceObjectStore {
  failCopy = false
  override async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    if (this.failCopy) throw new Error('模拟对象复制失败')
    await super.copyObject(sourceKey, destinationKey)
  }
}

let objects: ControlledMemoryObjectStore

beforeAll(async () => {
  if (!ADMIN_DATABASE_URL) return
  const control = postgres(ADMIN_DATABASE_URL, { max: 1 })
  await control.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`)
  await control.end()
  expect(await runMarketplaceMigrations(databaseUrl)).toEqual([
    '0000_marketplace.sql',
    '0001_marketplace_admin_auth.sql',
    '0002_marketplace_submissions.sql',
    '0003_marketplace_validation_payload.sql',
  ])
  expect(await runMarketplaceMigrations(databaseUrl)).toEqual([])

  objects = new ControlledMemoryObjectStore()
  const auth = new AdminAuthService({
    findEnabledUser: async () => currentUser,
    createSession: async () => undefined,
    findSession: async () => currentUser,
    deleteSession: async () => undefined,
  }, {
    getAuthorizeUrl: () => 'https://github.com/login/oauth/authorize',
    exchange: async () => ({ login: currentUser.githubLogin, name: currentUser.displayName }),
  }, 'integration-test-secret-at-least-32-characters')
  const config = loadMarketplaceApiConfig({
    MARKETPLACE_DATABASE_URL: databaseUrl,
    MARKETPLACE_OBJECT_BUCKET: 'test',
    MARKETPLACE_OBJECT_REGION: 'test',
    MARKETPLACE_OBJECT_ACCESS_KEY_ID: 'test',
    MARKETPLACE_OBJECT_SECRET_ACCESS_KEY: 'test',
    MARKETPLACE_FEATURE_BROWSE: 'true',
    MARKETPLACE_FEATURE_INSTALL: 'true',
    MARKETPLACE_FEATURE_COMMUNITY: 'true',
    NODE_ENV: 'test',
  })
  const submissions = new SubmissionService(new PostgresSubmissionRepository(databaseUrl), objects)
  app = createMarketplaceApp({
    config: { ...config, adminEnabled: true, features: { ...config.features, admin: true } },
    services: { repository: new PostgresMarketplaceRepository(databaseUrl), objectStore: objects },
    adminAuth: auth,
    submissions,
    reviews: new PostgresReviewService(databaseUrl, objects),
    management: new AdminManagementService(databaseUrl),
  })
})

afterAll(async () => {
  if (!ADMIN_DATABASE_URL) return
  const control = postgres(ADMIN_DATABASE_URL, { max: 1 })
  await control.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`)
  await control.end()
})

const describePostgres = ADMIN_DATABASE_URL ? describe : describe.skip

describePostgres('Marketplace PostgreSQL 管理链路', () => {
  test('上传、校验、审核、发布、公开读取、下架、重发和归档形成闭环', async () => {
    const created = await uploadAndValidate('1.0.0')
    expect(created).not.toHaveProperty('objectKey')

    const editorDetail = await adminRequest<MarketplaceSubmissionDetail>(`/api/v1/admin/submissions/${created.submission.id}`)
    expect(editorDetail).not.toHaveProperty('objectKey')
    expect(editorDetail.examples).toHaveLength(1)

    currentUser = reviewer
    const reviewed = await adminRequest<MarketplaceReviewResult>(`/api/v1/admin/submissions/${created.submission.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approve',
        metadata: {
          authorHandle: 'community-author',
          authorName: '社区作者',
          category: 'research',
          displayName: '集成测试 Skill',
          description: '通过真实 PostgreSQL 管理链路发布的集成测试 Skill。',
        },
      }),
    })
    expect(reviewed.status).toBe('published')

    const publicDetail = await publicRequest<MarketplaceSkillDetail>('/api/v1/skills/integration-skill')
    expect(publicDetail.author.handle).toBe('community-author')
    expect(await publicRequest<unknown[]>('/api/v1/skills/integration-skill/versions/1.0.0/examples')).toHaveLength(1)
    expect((await rawAdminRequest(`/api/v1/admin/skills/${publicDetail.id}/lifecycle`, { method: 'POST', body: JSON.stringify({ action: 'unlist', reason: 'Reviewer 不应有权限' }) })).status).toBe(403)
    expect((await rawAdminRequest('/api/v1/admin/audit')).status).toBe(403)

    const copyFailure = await uploadAndValidate('1.1.0')
    currentUser = reviewer
    objects.failCopy = true
    const copyFailureResponse = await rawAdminRequest(`/api/v1/admin/submissions/${copyFailure.submission.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) })
    objects.failCopy = false
    expect(copyFailureResponse.status).toBe(500)
    expect((await publicRequest<MarketplaceSkillDetail>('/api/v1/skills/integration-skill')).version).toBe('1.0.0')

    const databaseFailure = await uploadAndValidate('1.2.0')
    const sql = postgres(databaseUrl, { max: 1 })
    const rows = await sql<{ extracted_files: unknown[] }[]>`SELECT extracted_files FROM marketplace_submissions WHERE id=${databaseFailure.submission.id}`
    const files = rows[0]?.extracted_files ?? []
    await sql`UPDATE marketplace_submissions SET extracted_files=${sql.json(JSON.parse(JSON.stringify([...files, files[0]])))} WHERE id=${databaseFailure.submission.id}`
    await sql.end()
    currentUser = reviewer
    const databaseFailureResponse = await rawAdminRequest(`/api/v1/admin/submissions/${databaseFailure.submission.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) })
    expect(databaseFailureResponse.status).toBe(500)
    expect(objects.objects.has(publishedPackageKey(publicDetail.id, '1.2.0'))).toBe(false)
    expect((await publicRequest<MarketplaceSkillDetail>('/api/v1/skills/integration-skill')).version).toBe('1.0.0')

    currentUser = admin
    const audit = await adminRequest<MarketplaceAuditEntry[]>('/api/v1/admin/audit')
    expect(audit.some((entry) => entry.action === 'submission.metadata_changed')).toBe(true)
    await adminRequest(`/api/v1/admin/skills/${publicDetail.id}/lifecycle`, { method: 'POST', body: JSON.stringify({ action: 'unlist', reason: '集成测试下架' }) })
    expect((await app.request('/api/v1/skills/integration-skill')).status).toBe(404)
    await adminRequest(`/api/v1/admin/skills/${publicDetail.id}/lifecycle`, { method: 'POST', body: JSON.stringify({ action: 'republish', reason: '集成测试重发' }) })
    expect((await app.request('/api/v1/skills/integration-skill')).status).toBe(200)
    await adminRequest(`/api/v1/admin/skills/${publicDetail.id}/lifecycle`, { method: 'POST', body: JSON.stringify({ action: 'archive', reason: '集成测试归档' }) })
    const archivedRepublish = await rawAdminRequest(`/api/v1/admin/skills/${publicDetail.id}/lifecycle`, { method: 'POST', body: JSON.stringify({ action: 'republish', reason: '不应成功' }) })
    expect(archivedRepublish.status).toBe(409)
  }, 30_000)

  test('Editor 只能看到自己的提交，Reviewer 可以看到全部', async () => {
    const sql = postgres(databaseUrl, { max: 1 })
    const otherId = randomUUID()
    await sql`INSERT INTO marketplace_submissions (id, object_key, status, submitted_by, idempotency_key, file_name, package_size) VALUES (${otherId}, 'quarantine/other/package.zip', 'uploading', 'other-editor', ${randomUUID()}, 'other.zip', 1)`
    await sql.end()

    currentUser = editor
    const own = await adminRequest<MarketplaceSubmissionSummary[]>('/api/v1/admin/submissions')
    expect(own.every((item) => item.submittedBy === editor.githubLogin)).toBe(true)
    expect((await rawAdminRequest(`/api/v1/admin/submissions/${otherId}`)).status).toBe(404)
    currentUser = reviewer
    const all = await adminRequest<MarketplaceSubmissionSummary[]>('/api/v1/admin/submissions')
    expect(all.some((item) => item.submittedBy === 'other-editor')).toBe(true)
  })
})

async function adminRequest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await rawAdminRequest(path, init)
  if (!response.ok) throw new Error(`管理请求失败：${response.status} ${await response.text()}`)
  return response.json() as Promise<T>
}

async function rawAdminRequest(path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, { ...init, headers: { 'Content-Type': 'application/json', Cookie: 'proma_marketplace_session=test-token', Origin: 'http://localhost:4173', 'Sec-Fetch-Site': 'same-site', ...init?.headers } })
}

async function uploadAndValidate(version: string): Promise<MarketplaceCreateSubmissionResult> {
  currentUser = editor
  const zip = packageZip(version)
  const created = await adminRequest<MarketplaceCreateSubmissionResult>('/api/v1/admin/submissions', {
    method: 'POST',
    body: JSON.stringify({ fileName: `integration-skill-${version}.zip`, size: zip.byteLength, idempotencyKey: randomUUID() }),
  })
  await objects.putPackage(quarantinePackageKey(created.submission.id), zip)
  await adminRequest<MarketplaceSubmissionSummary>(`/api/v1/admin/submissions/${created.submission.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ sha256: createHash('sha256').update(zip).digest('hex') }),
  })
  expect(await new MarketplaceValidationRunner(new PostgresValidationRepository(databaseUrl), objects).runOnce()).toBe(true)
  return created
}

async function publicRequest<T>(path: string): Promise<T> {
  const response = await app.request(path)
  if (!response.ok) throw new Error(`公共请求失败：${response.status}`)
  return response.json() as Promise<T>
}

function packageZip(version: string): Uint8Array {
  const zip = new AdmZip()
  zip.addFile('SKILL.md', Buffer.from(`---
schema_version: 1
name: integration-skill
display_name: 原始名称
description: 用于验证真实 PostgreSQL 管理发布闭环的完整测试 Skill。
version: ${version}
author:
  handle: proma-editor
  name: Proma 编辑部
category: productivity
license: MIT
permissions:
  network: false
  shell: false
  filesystem:
    read: false
    write: none
---
# 集成测试
`))
  zip.addFile('examples/examples.json', Buffer.from(JSON.stringify([{
    title: '完整案例', summary: '验证案例持久化', featured: true, userRequest: '执行测试',
    steps: [{ title: '执行', summary: '完成链路' }], finalOutputMarkdown: '# 完成', assetUrls: [],
  }])))
  return zip.toBuffer()
}

function withDatabase(source: string, database: string): string {
  const url = new URL(source)
  url.pathname = `/${database}`
  return url.toString()
}
