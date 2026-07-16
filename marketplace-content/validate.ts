import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSubmissionPackage } from '../apps/marketplace-api/src/validation/validation-runner.ts'
import { marketplaceContentCatalog } from './catalog.ts'
import { buildMarketplaceContentPackages } from './package.ts'

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'proma-marketplace-content-validation-'))

try {
  const packages = buildMarketplaceContentPackages(temporaryDirectory)
  const failures: string[] = []
  for (const candidate of packages) {
    const result = await validateSubmissionPackage(readFileSync(candidate.zipPath))
    const errors = result.issues.filter((issue) => issue.severity === 'error')
    const entry = marketplaceContentCatalog.find((item) => item.slug === candidate.slug)
    if (errors.length > 0 || !entry || candidate.exampleCount < 1 || (entry.priority === 'P0' && candidate.exampleCount !== 3)) {
      failures.push(`${candidate.slug}: ${errors.map((issue) => issue.code).join(', ') || '案例数量不符合要求'}`)
    }
  }
  if (packages.length !== 15 || failures.length > 0) throw new Error(`Marketplace 内容校验失败：${failures.join('; ')}`)
  console.log('Marketplace 15 个真实首发包已通过线上同源 Validator')
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
