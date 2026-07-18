import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarketplaceVersionSummary } from '@proma/shared'
import { MarketplaceVersionHistory } from './MarketplaceVersionHistory'

const versions: MarketplaceVersionSummary[] = [
  {
    version: '2.0.0',
    changelog: '当前能力',
    sha256: 'latest',
    size: 2048,
    fileCount: 2,
    publishedAt: '2026-07-17T00:00:00.000Z',
    files: [],
  },
  {
    version: '1.0.0',
    changelog: '旧版能力',
    sha256: 'previous',
    size: 1024,
    fileCount: 1,
    publishedAt: '2026-07-16T00:00:00.000Z',
    files: [],
  },
]

describe('技能市场版本历史', () => {
  test('Given 当前版本和历史版本 When 展示版本历史 Then 明确区分当前与非最新版本', () => {
    const html = renderToStaticMarkup(
      <MarketplaceVersionHistory
        versions={versions}
        latestVersion="2.0.0"
        onSelect={() => undefined}
      />,
    )

    expect(html.match(/当前版本|非最新版本/g)?.sort()).toEqual(['当前版本', '非最新版本'])
  })
})
