import { describe, expect, test } from 'bun:test'
import {
  readCatalogRoute,
  readDetailRoute,
  writeCatalogRoute,
  writeDetailRoute,
} from './route-state'

describe('公开技能市场 URL 状态', () => {
  test('Given 搜索筛选排序和分页 When 读取再写入目录 URL Then 状态可分享且默认值不产生噪声', () => {
    const route = readCatalogRoute(new URLSearchParams('q=%E7%A0%94%E7%A9%B6&category=research&featured=1&sort=latest&page=3'))

    expect(route).toEqual({ query: '研究', category: 'research', featured: true, sort: 'latest', page: 3 })
    expect(writeCatalogRoute(route).toString()).toBe('q=%E7%A0%94%E7%A9%B6&category=research&featured=1&sort=latest&page=3')
    expect(writeCatalogRoute({ query: '', category: '', featured: false, sort: 'hot', page: 1 }).toString()).toBe('')
  })

  test('Given 文件与历史版本详情 URL When 恢复状态 Then 默认文件为 SKILL.md 且保留版本', () => {
    expect(readDetailRoute(new URLSearchParams('tab=files&version=1.1.0'))).toEqual({
      tab: 'files',
      file: 'SKILL.md',
      version: '1.1.0',
    })
    expect(writeDetailRoute({ tab: 'files', file: 'references/guide.md', version: '1.1.0' }).toString())
      .toBe('tab=files&file=references%2Fguide.md&version=1.1.0')
  })
})
