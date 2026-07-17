import { describe, expect, test } from 'bun:test'
import {
  createMarketplaceMemoryEntries,
  readMarketplaceCatalogRoute,
  readMarketplaceDetailRoute,
  writeMarketplaceCatalogRoute,
  writeMarketplaceDetailRoute,
} from './marketplace-route'

describe('技能市场内部路由', () => {
  test('Given 已分享的目录路由 When 恢复查询状态 Then 保留搜索筛选排序和分页', () => {
    const route = readMarketplaceCatalogRoute(new URLSearchParams({
      q: '研究',
      category: 'research',
      featured: '1',
      sort: 'latest',
      page: '3',
    }))

    expect(route).toEqual({
      query: '研究',
      category: 'research',
      featured: true,
      sort: 'latest',
      page: 3,
    })
  })

  test('Given 目录筛选状态 When 写入内部路由 Then 仅保留非默认参数', () => {
    const searchParams = writeMarketplaceCatalogRoute({
      query: '研究',
      category: '',
      featured: true,
      sort: 'hot',
      page: 1,
    })

    expect(searchParams.toString()).toBe('q=%E7%A0%94%E7%A9%B6&featured=1')
  })

  test('Given 未选择文件的文件路由 When 恢复详情状态 Then 默认预览 SKILL.md', () => {
    const route = readMarketplaceDetailRoute(new URLSearchParams({
      tab: 'files',
      version: '1.2.0',
    }))

    expect(route).toEqual({
      tab: 'files',
      file: 'SKILL.md',
      version: '1.2.0',
    })
  })

  test('Given SKILL.md 路由携带旧文件 When 恢复详情状态 Then 仍只预览 SKILL.md', () => {
    const route = readMarketplaceDetailRoute(new URLSearchParams({
      tab: 'skill-md',
      file: 'prompts/old.md',
    }))

    expect(route.file).toBe('SKILL.md')
  })

  test('Given SKILL.md Tab 带旧文件 When 写入详情路由 Then 丢弃无关文件参数', () => {
    const searchParams = writeMarketplaceDetailRoute({
      tab: 'skill-md',
      file: 'prompts/old.md',
      version: '1.1.0',
    })

    expect(searchParams.toString()).toBe('tab=skill-md&version=1.1.0')
  })

  test('Given 历史版本文件状态 When 写入详情路由 Then 可恢复 Tab 文件和版本', () => {
    const searchParams = writeMarketplaceDetailRoute({
      tab: 'files',
      file: 'prompts/research.md',
      version: '1.1.0',
    })

    expect(searchParams.toString()).toBe('tab=files&file=prompts%2Fresearch.md&version=1.1.0')
  })

  test('Given 从详情恢复市场 When 创建内存历史 Then 返回操作仍回到原目录筛选', () => {
    const entries = createMarketplaceMemoryEntries(
      { query: '研究', category: '', featured: false, sort: 'hot', page: 2 },
      {
        identifier: 'research-helper',
        route: { tab: 'files', file: 'SKILL.md', version: '1.1.0' },
      },
    )

    expect(entries).toEqual([
      '/?q=%E7%A0%94%E7%A9%B6&page=2',
      '/skills/research-helper?tab=files&version=1.1.0',
    ])
  })
})
