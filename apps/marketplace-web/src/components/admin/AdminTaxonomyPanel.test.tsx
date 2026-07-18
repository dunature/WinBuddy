import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminTaxonomyPanel } from './AdminTaxonomyPanel'

test('Given 分类标签均为空 When 渲染管理面板 Then 提供明确空态与创建入口', () => {
  const html = renderToStaticMarkup(
    <AdminTaxonomyPanel
      categories={[]}
      tags={[]}
      csrfToken="csrf"
      onChanged={() => undefined}
    />,
  )

  expect(html).toContain('分类管理')
  expect(html).toContain('暂无分类')
  expect(html).toContain('标签管理')
  expect(html).toContain('暂无标签')
  expect(html).toContain('创建分类')
  expect(html).toContain('创建标签')
})
