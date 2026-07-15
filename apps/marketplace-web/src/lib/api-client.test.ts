import { describe, expect, test } from 'bun:test'
import { buildMarketplaceSearchPath } from './api-client.ts'

describe('buildMarketplaceSearchPath', () => {
  test('只序列化有意义的筛选并正确编码中文', () => {
    expect(buildMarketplaceSearchPath({
      query: '深度 研究',
      scope: 'official',
      category: 'research',
      sort: 'recent',
      page: 2,
      pageSize: 12,
    })).toBe('/skills?query=%E6%B7%B1%E5%BA%A6+%E7%A0%94%E7%A9%B6&scope=official&category=research&sort=recent&page=2&pageSize=12')
  })

  test('默认筛选保持简洁 URL', () => {
    expect(buildMarketplaceSearchPath({ scope: 'all', sort: 'popular', page: 1 })).toBe('/skills')
  })
})
