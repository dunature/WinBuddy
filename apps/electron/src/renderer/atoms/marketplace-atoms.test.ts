import { describe, expect, test } from 'bun:test'
import { initialMarketplaceState, toMarketplaceListQuery, withMarketplaceInstallState } from './marketplace-atoms'
import type { MarketplaceInstallState } from '@proma/shared'

describe('技能市场查询状态', () => {
  test('Given 未整理的筛选状态 When 转换为目录查询 Then 去除空白并保留分页条件', () => {
    const query = toMarketplaceListQuery({
      ...initialMarketplaceState,
      query: '  研究  ',
      category: 'research',
      featured: true,
      sort: 'latest',
      page: 3,
    })

    expect(query).toEqual({
      query: '研究',
      category: 'research',
      featured: true,
      sort: 'latest',
      page: 3,
      pageSize: 16,
    })
  })

  test('Given 空筛选状态 When 转换为目录查询 Then 不传递无意义筛选字段', () => {
    expect(toMarketplaceListQuery(initialMarketplaceState)).toEqual({
      sort: 'hot',
      page: 1,
      pageSize: 16,
    })
  })
})

test('Given 多个安装进度 When 写入 Jotai Map Then 按 installId 独立保存最新状态', () => {
  const first: MarketplaceInstallState = {
    installId: 'install-1', action: 'install', phase: 'downloading', workspaceSlug: 'research',
    marketplaceSkillId: 'skill-1', version: '1.0.0', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:01.000Z',
  }
  const second: MarketplaceInstallState = {
    ...first, installId: 'install-2', marketplaceSkillId: 'skill-2', phase: 'queued',
  }
  const completed = { ...first, phase: 'completed' as const, updatedAt: '2026-07-18T00:00:02.000Z' }

  const tasks = withMarketplaceInstallState(withMarketplaceInstallState(withMarketplaceInstallState(new Map(), first), second), completed)

  expect(tasks.size).toBe(2)
  expect(tasks.get('install-1')?.phase).toBe('completed')
  expect(tasks.get('install-2')?.phase).toBe('queued')
})
