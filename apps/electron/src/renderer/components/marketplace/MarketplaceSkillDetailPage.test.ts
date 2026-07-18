import { expect, test } from 'bun:test'
import type { MarketplaceInstalledSkill } from '@proma/shared'
import { canToggleInstalledMarketplaceSkill } from './MarketplaceSkillDetailPage'

const disabledSkill: MarketplaceInstalledSkill = {
  marketplaceSkillId: 'marketplace-1',
  identifier: 'research',
  installedVersion: '1.0.0',
  contentHash: 'trusted-hash',
  installedAt: '2026-07-18T00:00:00.000Z',
  enabled: false,
}

test('Given a disabled installed Skill, When checking the lifecycle action, Then enabling remains available', () => {
  expect(canToggleInstalledMarketplaceSkill(disabledSkill, null)).toBe(true)
  expect(canToggleInstalledMarketplaceSkill(disabledSkill, 'uninstall')).toBe(false)
})
