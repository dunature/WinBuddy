import { describe, expect, test } from 'bun:test'
import { safeMarketplaceAssetUrl, safeMarketplaceLink } from './safe-url.ts'

describe('Marketplace URL 安全', () => {
  test('拒绝脚本、data 和凭证协议', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
      expect(safeMarketplaceLink(value)).toBeUndefined()
      expect(safeMarketplaceAssetUrl(value)).toBeUndefined()
    }
    expect(safeMarketplaceLink('https://example.com/guide')).toBe('https://example.com/guide')
    expect(safeMarketplaceLink('/docs/guide')).toBe('/docs/guide')
  })
})
