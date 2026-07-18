import { describe, expect, test } from 'bun:test'
import {
  MARKETPLACE_ZIP_LIMITS,
  validateMarketplacePackage,
  type MarketplaceZipEntryDescriptor,
} from './index'

const validSkillMd = `---
name: daily-briefing
description: 自动生成每日简报
version: 1.0.0
---
# 每日简报
`

function entry(
  path: string,
  overrides: Partial<MarketplaceZipEntryDescriptor> = {},
): MarketplaceZipEntryDescriptor {
  return {
    path,
    kind: 'file',
    compressedSize: 128,
    uncompressedSize: 512,
    ...overrides,
  }
}

function validate(entries: MarketplaceZipEntryDescriptor[], archiveSize = 1024) {
  return validateMarketplacePackage({
    archiveSize,
    entries,
    skillMdContent: validSkillMd,
    expectedIdentifier: 'daily-briefing',
    expectedVersion: '1.0.0',
  })
}

describe('技能市场 ZIP 包领域校验', () => {
  test('Given 合法单根 Skill 包 When 校验 Then 返回解析后的 manifest 与全部通过报告', () => {
    const result = validate([
      entry('daily-briefing/SKILL.md'),
      entry('daily-briefing/references/guide.md'),
      entry('daily-briefing/scripts/run.ts'),
    ])

    expect(result.passed).toBe(true)
    expect(result.rootDirectory).toBe('daily-briefing')
    expect(result.fileCount).toBe(3)
    expect(result.manifest).toEqual({
      identifier: 'daily-briefing',
      description: '自动生成每日简报',
      version: '1.0.0',
    })
    expect(result.checks.every((check) => check.passed)).toBe(true)
  })

  test('Given 路径穿越、重复路径和链接条目 When 校验 Then 按具体文件返回稳定失败码', () => {
    const cases: Array<[MarketplaceZipEntryDescriptor[], string, string | undefined]> = [
      [[entry('/daily-briefing/SKILL.md')], 'ZIP_ABSOLUTE_PATH', '/daily-briefing/SKILL.md'],
      [[entry('C:\\daily-briefing\\SKILL.md')], 'ZIP_DRIVE_PATH', 'C:\\daily-briefing\\SKILL.md'],
      [[entry('daily-briefing/../escape.txt')], 'ZIP_PARENT_PATH', 'daily-briefing/../escape.txt'],
      [[entry('daily-briefing/SKILL.md'), entry('daily-briefing//SKILL.md')], 'ZIP_DUPLICATE_PATH', 'daily-briefing//SKILL.md'],
      [[entry('daily-briefing/SKILL.md'), entry('daily-briefing/link', { kind: 'symlink' })], 'ZIP_SYMLINK', 'daily-briefing/link'],
      [[entry('daily-briefing/SKILL.md'), entry('daily-briefing/link', { kind: 'hardlink' })], 'ZIP_HARDLINK', 'daily-briefing/link'],
    ]

    for (const [entries, code, path] of cases) {
      const result = validate(entries)
      expect(result.passed).toBe(false)
      expect(result.checks).toContainEqual(expect.objectContaining({ passed: false, code, path }))
    }
  })

  test('Given ZIP 各项限制的边界值 When 校验 Then 等于上限通过而超过上限失败', () => {
    const exactDepthPath = `daily-briefing/${['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('/')}/file.txt`
    const exactLimitEntries = [
      entry('daily-briefing/SKILL.md', { compressedSize: 1, uncompressedSize: 1 }),
      entry(exactDepthPath, {
        compressedSize: Math.ceil(MARKETPLACE_ZIP_LIMITS.singleFileBytes / MARKETPLACE_ZIP_LIMITS.compressionRatio),
        uncompressedSize: MARKETPLACE_ZIP_LIMITS.singleFileBytes,
      }),
      ...Array.from({ length: MARKETPLACE_ZIP_LIMITS.fileCount - 2 }, (_, index) => (
        entry(`daily-briefing/files/${index}.txt`, { compressedSize: 1, uncompressedSize: 1 })
      )),
    ]
    const exact = validate(exactLimitEntries, MARKETPLACE_ZIP_LIMITS.archiveBytes)
    expect(exact.passed).toBe(true)

    const failures: Array<[MarketplaceZipEntryDescriptor[], number, string]> = [
      [[entry('daily-briefing/SKILL.md')], MARKETPLACE_ZIP_LIMITS.archiveBytes + 1, 'ZIP_ARCHIVE_TOO_LARGE'],
      [[entry('daily-briefing/SKILL.md'), ...Array.from({ length: MARKETPLACE_ZIP_LIMITS.fileCount }, (_, index) => entry(`daily-briefing/${index}.txt`))], 1024, 'ZIP_TOO_MANY_FILES'],
      [[entry('daily-briefing/SKILL.md'), entry('daily-briefing/large.bin', { uncompressedSize: MARKETPLACE_ZIP_LIMITS.singleFileBytes + 1 })], 1024, 'ZIP_FILE_TOO_LARGE'],
      [[entry('daily-briefing/SKILL.md'), entry('daily-briefing/bomb.bin', { compressedSize: 1, uncompressedSize: MARKETPLACE_ZIP_LIMITS.compressionRatio + 1 })], 1024, 'ZIP_COMPRESSION_RATIO_EXCEEDED'],
      [[entry('daily-briefing/SKILL.md'), entry('daily-briefing/a/b/c/d/e/f/g/h/file.txt')], 1024, 'ZIP_DEPTH_EXCEEDED'],
      [[entry('daily-briefing/SKILL.md'), ...Array.from({ length: 6 }, (_, index) => entry(`daily-briefing/${index}.bin`, { compressedSize: 1024, uncompressedSize: 10 * 1024 * 1024 }))], 1024, 'ZIP_EXPANDED_SIZE_EXCEEDED'],
    ]

    for (const [entries, archiveSize, code] of failures) {
      const result = validate(entries, archiveSize)
      expect(result.passed).toBe(false)
      expect(result.checks.some((check) => !check.passed && check.code === code)).toBe(true)
    }
  })

  test('Given 根目录、SKILL.md 或 frontmatter 与候选版本不一致 When 校验 Then 明确拒绝 manifest', () => {
    const wrongRoot = validateMarketplacePackage({
      archiveSize: 1024,
      entries: [entry('other-skill/SKILL.md')],
      skillMdContent: validSkillMd,
      expectedIdentifier: 'daily-briefing',
      expectedVersion: '1.0.0',
    })
    expect(wrongRoot.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_ROOT_MISMATCH', passed: false }))

    const multipleRoots = validate([entry('daily-briefing/SKILL.md'), entry('other/file.md')])
    expect(multipleRoots.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_MULTIPLE_ROOTS', passed: false }))

    const missingSkillMd = validate([entry('daily-briefing/README.md')])
    expect(missingSkillMd.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_MD_MISSING', passed: false }))

    const skillMdDirectory = validate([entry('daily-briefing/SKILL.md/', { kind: 'directory' })])
    expect(skillMdDirectory.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_MD_MISSING', passed: false }))

    const mismatch = validateMarketplacePackage({
      archiveSize: 1024,
      entries: [entry('daily-briefing/SKILL.md')],
      skillMdContent: validSkillMd.replace('name: daily-briefing', 'name: other-skill').replace('version: 1.0.0', 'version: 2.0.0'),
      expectedIdentifier: 'daily-briefing',
      expectedVersion: '1.0.0',
    })
    expect(mismatch.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_IDENTIFIER_MISMATCH', passed: false }))
    expect(mismatch.checks).toContainEqual(expect.objectContaining({ code: 'SKILL_VERSION_MISMATCH', passed: false }))
  })
})
