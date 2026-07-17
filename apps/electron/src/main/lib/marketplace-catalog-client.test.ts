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
    const client = createMarketplaceCatalogClient({ enableFixture: false })

    expect(client.listCategories()).rejects.toThrow('技能市场服务暂不可用')
  })
})
