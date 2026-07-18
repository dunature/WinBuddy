import { describe, expect, test } from 'bun:test'
import { initialMarketplaceState, toMarketplaceListQuery } from './marketplace-atoms'

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
