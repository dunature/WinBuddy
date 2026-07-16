import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSubmissionPackage } from '../apps/marketplace-api/src/validation/validation-runner.ts'
import { marketplaceContentCatalog } from './catalog.ts'
import { buildMarketplaceContentPackages } from './package.ts'

describe('Marketplace 首发内容包', () => {
  test('15 个真实 ZIP 均通过线上同源校验', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'proma-marketplace-content-test-'))
    try {
      const packages = buildMarketplaceContentPackages(directory)
      expect(packages).toHaveLength(15)
      for (const candidate of packages) {
        const result = await validateSubmissionPackage(readFileSync(candidate.zipPath))
        expect(result.issues.filter((issue) => issue.severity === 'error'), candidate.slug).toEqual([])
        expect(result.examples).toHaveLength(candidate.exampleCount)
        const entry = marketplaceContentCatalog.find((item) => item.slug === candidate.slug)
        expect(candidate.exampleCount).toBe(entry?.priority === 'P0' ? 3 : 1)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
