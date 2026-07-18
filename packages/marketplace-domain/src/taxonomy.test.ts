import { describe, expect, test } from 'bun:test'
import { normalizeMarketplaceTaxonomyName } from './index'

describe('Marketplace 分类标签名称规范化', () => {
  test('Given 全角字符、混合空白与大小写 When 规范化 Then 展示名稳定且唯一键大小写无关', () => {
    expect(normalizeMarketplaceTaxonomyName('  ＡＩ\n\t 工具  ')).toEqual({
      name: 'AI 工具',
      normalizedName: 'ai 工具',
    })
  })

  test('Given 只有空白的名称 When 规范化 Then 拒绝无意义分类或标签', () => {
    expect(() => normalizeMarketplaceTaxonomyName('　\n ')).toThrow('TAXONOMY_NAME_REQUIRED')
  })
})
