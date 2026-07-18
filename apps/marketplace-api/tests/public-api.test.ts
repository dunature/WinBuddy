import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Sql } from 'postgres'
import type {
  MarketplaceApiError,
  MarketplaceApiPage,
  MarketplaceApiSuccess,
  MarketplaceCategory,
  MarketplaceInstallManifest,
  MarketplaceSkillDetail,
  MarketplaceSkillFile,
  MarketplaceSkillSummary,
  MarketplaceVersionSummary,
} from '@proma/shared'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

function responseRequestId(response: Response): string {
  const requestId = response.headers.get('x-request-id')
  if (!requestId) throw new Error('响应缺少 x-request-id')
  return requestId
}

async function seedPublicCatalog(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO categories (id, name, icon)
    VALUES ('research', '研究分析', 'search'), ('docs', '文档创作', 'file-text')
  `
  await sql`
    INSERT INTO skills (
      id, identifier, name, tagline, description, author_name, category_id,
      tags, icon, featured, installs, status, updated_at
    ) VALUES
      ('skill-public', 'deep-research', '深度研究助手', '生成可追溯的研究报告', '公开说明', 'Proma Labs', 'research',
       ARRAY['研究', '报告'], 'search', true, 100, 'published', '2026-07-16T08:00:00.000Z'),
      ('skill-market', 'market-intelligence', '市场情报雷达', '持续整理行业动态', '市场说明', 'Proma Labs', 'research',
       ARRAY['情报'], 'radar', false, 300, 'published', '2026-07-17T08:00:00.000Z'),
      ('skill-slides', 'slides-studio', '演示文稿工作室', '创建清晰演示', '演示说明', 'Proma Labs', 'docs',
       ARRAY['演示'], 'presentation', true, 200, 'published', '2026-07-18T08:00:00.000Z'),
      ('skill-draft', 'draft-skill', '内部草稿', '不应公开', '草稿说明', 'Proma Labs', 'research',
       ARRAY[]::text[], 'file', false, 0, 'draft', '2026-07-19T08:00:00.000Z')
  `
  await sql`
    INSERT INTO skill_versions (
      id, skill_id, version, changelog, sha256, size, file_count, status, published_at
    ) VALUES
      ('version-current', 'skill-public', '1.2.0', '线上版本', 'sha256-current', 42000, 3, 'published', '2026-07-16T08:00:00.000Z'),
      ('version-history', 'skill-public', '1.1.0', '历史版本', 'sha256-history', 41000, 1, 'unpublished', '2026-06-16T08:00:00.000Z'),
      ('version-candidate', 'skill-public', '1.3.0', '候选版本', 'sha256-candidate', 43000, 2, 'pending_review', NULL),
      ('version-market', 'skill-market', '1.0.0', '情报首版', 'sha256-market', 21000, 1, 'published', '2026-07-17T08:00:00.000Z'),
      ('version-slides', 'skill-slides', '2.0.0', '演示首版', 'sha256-slides', 31000, 1, 'published', '2026-07-18T08:00:00.000Z'),
      ('version-draft', 'skill-draft', '0.1.0', '草稿版本', 'sha256-draft', 1000, 1, 'created', NULL)
  `
  await sql`
    UPDATE skills SET current_published_version_id = CASE id
      WHEN 'skill-public' THEN 'version-current'
      WHEN 'skill-market' THEN 'version-market'
      WHEN 'skill-slides' THEN 'version-slides'
    END
    WHERE id IN ('skill-public', 'skill-market', 'skill-slides')
  `
  await sql`
    INSERT INTO version_files (version_id, path, size, is_text, content)
    VALUES
      ('version-current', 'SKILL.md', 38, true, '# Deep Research\n\n生成可追溯研究报告。'),
      ('version-current', 'references/guide.md', 24, true, '# 使用指南\n\n引用公开来源。'),
      ('version-history', 'SKILL.md', 25, true, '# Deep Research\n\n历史说明。')
  `
  await sql`
    INSERT INTO version_files (version_id, path, size, is_text, content)
    VALUES ('version-current', 'references/large.md', 8, true, ${'x'.repeat(1024 * 1024 + 1)})
  `
}

describe.skipIf(!adminDatabaseUrl)('Marketplace public API（真实 PostgreSQL）', () => {
  let testDatabase: MarketplaceTestDatabase
  let sql: Sql
  let app: ReturnType<typeof createMarketplaceApp>

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    const database = createMarketplaceDatabase(testDatabase.databaseUrl)
    sql = database.sql
    await runMarketplaceMigrations(sql)
    await runMarketplaceMigrations(sql)
    await seedPublicCatalog(sql)
    app = createMarketplaceApp({ database })
  })

  afterAll(async () => {
    await closeSql(sql)
    await testDatabase.close()
  })

  test('Given API 与数据库可用 When 请求健康状态 Then 返回统一 envelope 和 request ID', async () => {
    const healthResponse = await app.request('/api/v1/health')
    const health = await readJson<MarketplaceApiSuccess<{ status: string }>>(healthResponse)
    const readinessResponse = await app.request('/api/v1/readiness')
    const readiness = await readJson<MarketplaceApiSuccess<{ status: string }>>(readinessResponse)

    expect(healthResponse.status).toBe(200)
    expect(health).toEqual({
      data: { status: 'ok' },
      requestId: responseRequestId(healthResponse),
    })
    expect(readinessResponse.status).toBe(200)
    expect(readiness).toEqual({
      data: { status: 'ready' },
      requestId: responseRequestId(readinessResponse),
    })
  })

  test('Given 线上版本、候选版本和无线上指针草稿 When 读取公开目录 Then 只返回当前线上 Skill', async () => {
    const categoriesResponse = await app.request('/api/v1/marketplace/categories')
    const categories = await readJson<MarketplaceApiSuccess<MarketplaceCategory[]>>(categoriesResponse)
    const skillsResponse = await app.request('/api/v1/marketplace/skills')
    const skills = await readJson<MarketplaceApiPage<MarketplaceSkillSummary>>(skillsResponse)

    expect(categories).toEqual({
      data: [
        { id: 'docs', name: '文档创作', icon: 'file-text' },
        { id: 'research', name: '研究分析', icon: 'search' },
      ],
      requestId: responseRequestId(categoriesResponse),
    })
    expect(skills).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({ identifier: 'deep-research', latestVersion: '1.2.0' }),
        expect.objectContaining({ identifier: 'market-intelligence', latestVersion: '1.0.0' }),
        expect.objectContaining({ identifier: 'slides-studio', latestVersion: '2.0.0' }),
      ]),
      page: { number: 1, size: 16, total: 3, pages: 1 },
      requestId: responseRequestId(skillsResponse),
    })
    expect(JSON.stringify(skills)).not.toContain('1.3.0')
    expect(JSON.stringify(skills)).not.toContain('draft-skill')
  })

  test('Given 搜索筛选排序与超大分页 When 查询公开目录 Then 返回稳定结果并将 pageSize 限制为 50', async () => {
    const searchResponse = await app.request('/api/v1/marketplace/skills?q=研究')
    const search = await readJson<MarketplaceApiPage<MarketplaceSkillSummary>>(searchResponse)
    const filterResponse = await app.request('/api/v1/marketplace/skills?category=research&featured=1')
    const filter = await readJson<MarketplaceApiPage<MarketplaceSkillSummary>>(filterResponse)
    const latestResponse = await app.request('/api/v1/marketplace/skills?sort=latest&pageSize=999')
    const latest = await readJson<MarketplaceApiPage<MarketplaceSkillSummary>>(latestResponse)

    expect(search.data.map((skill: { identifier: string }) => skill.identifier)).toEqual(['deep-research'])
    expect(filter.data.map((skill: { identifier: string }) => skill.identifier)).toEqual(['deep-research'])
    expect(latest.data.map((skill: { identifier: string }) => skill.identifier)).toEqual([
      'slides-studio',
      'market-intelligence',
      'deep-research',
    ])
    expect(latest.page).toEqual({ number: 1, size: 50, total: 3, pages: 1 })
  })

  test('Given 当前、历史和候选版本 When 读取详情与版本历史 Then 只公开已发布历史并返回文件树', async () => {
    const detailResponse = await app.request('/api/v1/marketplace/skills/deep-research')
    const detail = await readJson<MarketplaceApiSuccess<MarketplaceSkillDetail>>(detailResponse)
    const versionsResponse = await app.request('/api/v1/marketplace/skills/deep-research/versions')
    const versions = await readJson<MarketplaceApiSuccess<MarketplaceVersionSummary[]>>(versionsResponse)

    expect(detailResponse.status).toBe(200)
    expect(detail.data).toMatchObject({
      identifier: 'deep-research',
      description: '公开说明',
      latestVersion: '1.2.0',
    })
    expect(detail.data.versions.map((version: { version: string }) => version.version)).toEqual(['1.2.0', '1.1.0'])
    expect(detail.data.versions[0]!.files).toEqual([
      { path: 'references', name: 'references', type: 'directory', size: 0, children: [
        { path: 'references/guide.md', name: 'guide.md', type: 'file', size: 24 },
        { path: 'references/large.md', name: 'large.md', type: 'file', size: 8 },
      ] },
      { path: 'SKILL.md', name: 'SKILL.md', type: 'file', size: 38 },
    ])
    expect(versions.data).toEqual(detail.data.versions)
    expect(JSON.stringify(detail)).not.toContain('1.3.0')

    const missingResponse = await app.request('/api/v1/marketplace/skills/not-found')
    expect(missingResponse.status).toBe(404)
    expect(await readJson<MarketplaceApiError>(missingResponse)).toEqual({
      error: { code: 'SKILL_NOT_FOUND', message: '技能不存在' },
      requestId: responseRequestId(missingResponse),
    })
  })

  test('Given 已发布文本文件和安装元数据 When 读取文件与 manifest Then 限制 1 MB 且不泄漏绝对路径', async () => {
    const fileResponse = await app.request('/api/v1/marketplace/skills/deep-research/versions/1.2.0/file?path=SKILL.md')
    const file = await readJson<MarketplaceApiSuccess<MarketplaceSkillFile>>(fileResponse)
    const largeResponse = await app.request('/api/v1/marketplace/skills/deep-research/versions/1.2.0/file?path=references%2Flarge.md')
    const manifestResponse = await app.request('/api/v1/marketplace/skills/deep-research/versions/1.2.0/manifest')
    const manifest = await readJson<MarketplaceApiSuccess<MarketplaceInstallManifest>>(manifestResponse)
    const stableIdManifestResponse = await app.request('/api/v1/marketplace/skills/by-id/skill-public/versions/1.2.0/manifest')
    const stableIdManifest = await readJson<MarketplaceApiSuccess<MarketplaceInstallManifest>>(stableIdManifestResponse)

    expect(fileResponse.status).toBe(200)
    expect(file.data).toEqual({
      path: 'SKILL.md',
      size: 38,
      content: '# Deep Research\n\n生成可追溯研究报告。',
      isText: true,
    })
    expect(largeResponse.status).toBe(413)
    expect(await readJson<MarketplaceApiError>(largeResponse)).toEqual({
      error: { code: 'FILE_TOO_LARGE', message: '文本文件超过 1 MB，无法预览' },
      requestId: responseRequestId(largeResponse),
    })
    expect(manifestResponse.status).toBe(200)
    expect(manifest.data).toMatchObject({
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      version: '1.2.0',
      sha256: 'sha256-current',
      size: 42000,
      fileCount: 3,
    })
    expect(stableIdManifestResponse.status).toBe(200)
    expect(stableIdManifest.data).toEqual(manifest.data)
    expect(JSON.stringify(manifest)).not.toContain('/Users/')
    expect(JSON.stringify(manifest)).not.toContain('content')
  })
})
