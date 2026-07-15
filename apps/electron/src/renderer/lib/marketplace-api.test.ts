import { describe, expect, test } from 'bun:test'
import { buildElectronMarketplaceSearchPath } from './marketplace-api'

describe('buildElectronMarketplaceSearchPath', () => {
  test('编码筛选并忽略默认项', () => {
    expect(buildElectronMarketplaceSearchPath({ query: '研究 助手', scope: 'all', sort: 'popular' }))
      .toBe('/skills?query=%E7%A0%94%E7%A9%B6+%E5%8A%A9%E6%89%8B&pageSize=24')
  })

  test('保留社区、分类、排序和分页', () => {
    expect(buildElectronMarketplaceSearchPath({ scope: 'community', category: 'coding', sort: 'recent', page: 2, pageSize: 12 }))
      .toBe('/skills?scope=community&category=coding&sort=recent&page=2&pageSize=12')
  })
})
