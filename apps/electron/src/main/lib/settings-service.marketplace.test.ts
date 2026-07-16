import { describe, expect, test } from 'bun:test'
import { migrateLegacyMarketplaceSettings } from './settings-service'

describe('Marketplace 旧设置迁移', () => {
  test('旧总开关只迁移 browse/install，community 保持关闭', () => {
    expect(migrateLegacyMarketplaceSettings({ marketplaceEnabled: true })).toEqual({
      marketplaceEnabled: true,
      marketplaceBrowseEnabled: true,
      marketplaceInstallEnabled: true,
      marketplaceCommunityEnabled: false,
    })
  })

  test('存在新开关时不重复覆盖用户选择', () => {
    const settings = { marketplaceEnabled: true, marketplaceBrowseEnabled: false }
    expect(migrateLegacyMarketplaceSettings(settings)).toBe(settings)
  })
})
