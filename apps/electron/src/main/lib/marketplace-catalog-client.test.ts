import { describe, expect, test } from 'bun:test'
import { createFixtureMarketplaceCatalogClient, createMarketplaceCatalogClient } from './marketplace-catalog-client'

describe('MarketplaceCatalogClient', () => {
  test('Given 技能名称或 identifier When 搜索目录 Then 只返回匹配的已发布 Skill', async () => {
    const client = createFixtureMarketplaceCatalogClient()

    const byName = await client.listSkills({ query: '研究', page: 1, pageSize: 16, sort: 'hot' })
    const byIdentifier = await client.listSkills({ query: 'slides', page: 1, pageSize: 16, sort: 'hot' })

    expect(byName.items.map((skill) => skill.identifier)).toEqual(['deep-research'])
    expect(byIdentifier.items.map((skill) => skill.identifier)).toEqual(['slides-studio'])
  })

  test('Given 分类、精选和排序条件 When 查询目录 Then 返回稳定分页结果', async () => {
    const client = createFixtureMarketplaceCatalogClient()

    const result = await client.listSkills({
      category: 'research',
      featured: true,
      page: 1,
      pageSize: 1,
      sort: 'latest',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.identifier).toBe('deep-research')
    expect(result.page).toEqual({ number: 1, size: 1, total: 2, pages: 2 })
  })

  test('Given Skill identifier When 读取详情和文件 Then 返回对应版本内容', async () => {
    const client = createFixtureMarketplaceCatalogClient()

    const detail = await client.getSkill('deep-research')
    const file = await client.getSkillFile('deep-research', '1.2.0', 'SKILL.md')

    expect(detail.latestVersion).toBe('1.2.0')
    expect(detail.versions.map((version) => version.version)).toEqual(['1.2.0', '1.1.0'])
    expect(file.path).toBe('SKILL.md')
    expect(file.content).toContain('# Deep Research')
  })

  test('Given 未知 Skill When 读取详情 Then 返回中文错误', async () => {
    const client = createFixtureMarketplaceCatalogClient()

    expect(client.getSkill('missing-skill')).rejects.toThrow('技能不存在')
  })

  test('Given 生产环境未连接真实 API When 读取目录 Then 不回退到 fixture', async () => {
    const client = createMarketplaceCatalogClient({
      enableFixture: false,
      runtime: 'production',
      apiBaseUrl: 'https://marketplace.invalid/api/v1',
      fetchFn: async () => { throw new Error('offline') },
    })

    expect(client.listCategories()).rejects.toThrow('技能市场服务暂不可用')
  })

  test('Given fixture 被显式请求 When 判断运行环境 Then 仅开发环境启用', async () => {
    const developmentClient = createMarketplaceCatalogClient({ enableFixture: true, runtime: 'development' })
    const productionClient = createMarketplaceCatalogClient({
      enableFixture: true,
      runtime: 'production',
      apiBaseUrl: 'https://marketplace.invalid/api/v1',
      fetchFn: async () => { throw new Error('offline') },
    })

    expect((await developmentClient.listCategories()).length).toBeGreaterThan(0)
    expect(productionClient.listCategories()).rejects.toThrow('技能市场服务暂不可用')
  })

  test('Given 真实 API 可用 When 主进程读取目录详情和文件 Then 映射统一 envelope 且保留查询条件', async () => {
    const requestedUrls: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requestedUrls.push(url.toString())
        if (url.pathname.endsWith('/categories')) {
          return Response.json({ data: [{ id: 'research', name: '研究分析', icon: 'search' }], requestId: 'req-1' })
        }
        if (url.pathname.endsWith('/skills')) {
          return Response.json({
            data: [{
              id: 'skill-1', identifier: 'deep-research', name: '深度研究助手', tagline: '研究',
              authorName: 'Proma Labs', category: 'research', tags: ['研究'], icon: 'search',
              featured: true, installs: 10, latestVersion: '1.0.0', updatedAt: '2026-07-18T00:00:00.000Z',
            }],
            page: { number: 2, size: 16, total: 17, pages: 2 },
            requestId: 'req-2',
          })
        }
        if (url.pathname.endsWith('/file')) {
          return Response.json({ data: { path: 'SKILL.md', size: 10, content: '# Skill', isText: true }, requestId: 'req-4' })
        }
        if (url.pathname.endsWith('/manifest')) {
          return Response.json({
            data: {
              marketplaceSkillId: 'skill-1', identifier: 'deep-research', version: '1.0.0',
              sha256: 'a'.repeat(64), size: 100, fileCount: 1, files: [], downloadUrl: 'https://download.test/package.zip',
            },
            requestId: 'req-5',
          })
        }
        return Response.json({
          data: {
            id: 'skill-1', identifier: 'deep-research', name: '深度研究助手', tagline: '研究', description: '说明',
            authorName: 'Proma Labs', category: 'research', tags: ['研究'], icon: 'search', featured: true,
            installs: 10, latestVersion: '1.0.0', updatedAt: '2026-07-18T00:00:00.000Z', versions: [],
          },
          requestId: 'req-3',
        })
      },
    })

    try {
      const client = createMarketplaceCatalogClient({
        enableFixture: false,
        runtime: 'production',
        apiBaseUrl: `${server.url.origin}/api/v1`,
      })

      expect(await client.listCategories()).toEqual([{ id: 'research', name: '研究分析', icon: 'search' }])
      expect(await client.listSkills({ query: '研究', category: 'research', featured: true, sort: 'latest', page: 2, pageSize: 16 }))
        .toMatchObject({ page: { number: 2, size: 16 }, items: [{ identifier: 'deep-research' }] })
      expect((await client.getSkill('deep-research')).description).toBe('说明')
      expect((await client.getSkillFile('deep-research', '1.0.0', 'SKILL.md')).content).toBe('# Skill')
      expect((await client.getInstallManifest('skill-1', '1.0.0')).identifier).toBe('deep-research')
      expect(requestedUrls[1]).toContain('q=%E7%A0%94%E7%A9%B6')
      expect(requestedUrls[1]).toContain('featured=1')
      expect(requestedUrls[3]).toContain('path=SKILL.md')
      expect(requestedUrls[4]).toContain('/marketplace/skills/by-id/skill-1/versions/1.0.0/manifest')
    } finally {
      server.stop(true)
    }
  })
})
