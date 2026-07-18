import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarketplaceUpdatePreview } from '@proma/shared'
import { MarketplaceUpdateSummary } from './MarketplaceUpdateSummary'

const preview: MarketplaceUpdatePreview = {
  workspaceSlug: 'research',
  marketplaceSkillId: 'skill-public',
  version: '1.2.0',
  identifier: 'deep-research',
  installedVersion: '1.0.0',
  targetVersion: '1.2.0',
  changes: [
    { path: 'SKILL.md', kind: 'modified', beforeSize: 20, afterSize: 30 },
    { path: 'old-only.txt', kind: 'removed', beforeSize: 12 },
    { path: 'references/guide.md', kind: 'added', afterSize: 24 },
  ],
}

test('Given a trusted update preview, When rendering confirmation, Then shows versions changelog and real file changes', () => {
  const html = renderToStaticMarkup(
    <MarketplaceUpdateSummary preview={preview} changelog="改进引用校验" />,
  )

  expect(html).toContain('v1.0.0')
  expect(html).toContain('v1.2.0')
  expect(html).toContain('改进引用校验')
  expect(html).toContain('修改')
  expect(html).toContain('SKILL.md')
  expect(html).toContain('删除')
  expect(html).toContain('old-only.txt')
  expect(html).toContain('新增')
  expect(html).toContain('references/guide.md')
})
