import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarketplaceSkillSource } from '@proma/shared'
import { collectMarketplaceFileHashes, detectMarketplaceInstallConflict } from './marketplace-source'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Marketplace 本地冲突检测', () => {
  test('无来源同名目录视为 unmanaged', () => {
    const targetDir = makeSkill()
    expect(check(targetDir)).toEqual(expect.objectContaining({ kind: 'unmanaged' }))
  })

  test('识别文件修改、新增和删除', () => {
    const targetDir = makeSkill()
    const source = sourceFor(targetDir)
    writeFileSync(join(targetDir, '.proma-source.json'), JSON.stringify(source))
    writeFileSync(join(targetDir, 'SKILL.md'), 'changed')
    writeFileSync(join(targetDir, 'new.md'), 'new')
    expect(check(targetDir)).toEqual(expect.objectContaining({ kind: 'locally-modified', changedFiles: ['SKILL.md', 'new.md'] }))
  })

  test('未修改的高版本阻止降级，同版本同 hash 幂等', () => {
    const targetDir = makeSkill()
    writeFileSync(join(targetDir, '.proma-source.json'), JSON.stringify({ ...sourceFor(targetDir), version: '2.0.0' }))
    expect(check(targetDir)).toEqual(expect.objectContaining({ kind: 'downgrade' }))
    writeFileSync(join(targetDir, '.proma-source.json'), JSON.stringify(sourceFor(targetDir)))
    expect(check(targetDir)).toBe('already-installed')
  })
})

function makeSkill(): string {
  const root = mkdtempSync(join(tmpdir(), 'proma-conflict-'))
  roots.push(root)
  const target = join(root, 'research')
  mkdirSync(target)
  writeFileSync(join(target, 'SKILL.md'), 'original')
  return target
}

function sourceFor(targetDir: string): MarketplaceSkillSource {
  return { schemaVersion: 1, sourceType: 'marketplace', marketplaceSkillId: 'skill-1', slug: 'research', version: '1.0.0', sha256: 'abc', installedAt: '2026-07-15T00:00:00.000Z', files: collectMarketplaceFileHashes(targetDir) }
}

function check(targetDir: string) {
  return detectMarketplaceInstallConflict({ slug: 'research', marketplaceSkillId: 'skill-1', marketplaceVersion: '1.0.0', marketplaceSha256: 'abc', targetDir })
}
