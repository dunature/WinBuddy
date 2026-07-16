import { describe, expect, test } from 'bun:test'

const MARKETPLACE_LOG_SOURCES = [
  '../apps/marketplace-api/src/app.ts',
  '../apps/marketplace-api/src/worker.ts',
  '../apps/marketplace-api/src/reviews/review-service.ts',
  '../apps/electron/src/main/lib/marketplace-installer.ts',
  '../apps/electron/src/main/lib/marketplace-updates.ts',
  '../apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx',
  '../apps/electron/src/renderer/components/agent-skills/MarketplaceBrowser.tsx',
]

describe('Marketplace 源码隐私审查', () => {
  test('Marketplace warning/error 必须经过日志净化函数', async () => {
    for (const path of MARKETPLACE_LOG_SOURCES) {
      const source = await Bun.file(new URL(path, import.meta.url)).text()
      const logCalls = source.split('\n').filter((line) => /console\.(warn|error)\(/.test(line) && /Marketplace|社区市场|formatMarketplaceLog/.test(line))
      expect(logCalls.length, path).toBeGreaterThan(0)
      for (const call of logCalls) expect(call, path).toContain('formatMarketplaceLog')
    }
  })
})
