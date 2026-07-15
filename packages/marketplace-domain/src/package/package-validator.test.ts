import { describe, expect, test } from 'bun:test'
import {
  normalizeMarketplacePackagePath,
  validateMarketplacePackageEntries,
  type MarketplacePackageEntry,
} from './package-validator.ts'

function entry(path: string, overrides: Partial<MarketplacePackageEntry> = {}): MarketplacePackageEntry {
  return { path, compressedSize: 50, uncompressedSize: 100, ...overrides }
}

describe('normalizeMarketplacePackagePath', () => {
  test('统一 Windows 分隔符', () => {
    expect(normalizeMarketplacePackagePath('templates\\report.md')).toBe('templates/report.md')
  })

  test('拒绝 POSIX、Windows 绝对路径和 traversal', () => {
    for (const path of ['/etc/passwd', 'C:\\secret.txt', '../secret', 'a/../../secret']) {
      expect(normalizeMarketplacePackagePath(path)).toBeUndefined()
    }
  })
})

describe('validateMarketplacePackageEntries', () => {
  test('接受安全的普通 Skill 包', () => {
    const result = validateMarketplacePackageEntries([
      entry('SKILL.md'),
      entry('LICENSE'),
      entry('templates/report.md'),
    ])
    expect(result.issues).toEqual([])
  })

  test('阻止 symlink、禁止目录和 Windows 保留名', () => {
    const result = validateMarketplacePackageEntries([
      entry('scripts/link', { isSymbolicLink: true }),
      entry('.git/config'),
      entry('templates/CON.txt'),
    ])
    expect(result.issues.map((item) => item.code)).toEqual([
      'PACKAGE_SYMLINK_UNSAFE',
      'PACKAGE_PATH_BLOCKED',
      'PACKAGE_WINDOWS_RESERVED_PATH',
    ])
  })

  test('检测重复路径与大小写冲突', () => {
    const result = validateMarketplacePackageEntries([
      entry('references/Guide.md'),
      entry('references/Guide.md'),
      entry('references/guide.md'),
    ])
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'PACKAGE_DUPLICATE_PATH' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'PACKAGE_CASE_CONFLICT' }))
  })

  test('检测单文件、总大小、文件数量和压缩比', () => {
    const result = validateMarketplacePackageEntries([
      entry('a.txt', { compressedSize: 1, uncompressedSize: 101 }),
      entry('b.txt', { compressedSize: 1, uncompressedSize: 60 }),
    ], {
      maxFiles: 1,
      maxSingleFileBytes: 100,
      maxTotalUncompressedBytes: 150,
      maxCompressionRatio: 50,
    })
    const codes = result.issues.map((item) => item.code)
    expect(codes).toContain('PACKAGE_FILE_TOO_LARGE')
    expect(codes).toContain('PACKAGE_COMPRESSION_RATIO_EXCEEDED')
    expect(codes).toContain('PACKAGE_FILE_COUNT_EXCEEDED')
    expect(codes).toContain('PACKAGE_TOTAL_SIZE_EXCEEDED')
  })
})
