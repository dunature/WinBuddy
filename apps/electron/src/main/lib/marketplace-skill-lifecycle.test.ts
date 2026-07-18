import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketplaceSkillLifecycle } from './marketplace-skill-lifecycle'

const temporaryDirectories: string[] = []

function createWorkspace(): {
  root: string
  skillsDirectory: string
  inactiveSkillsDirectory: string
} {
  const root = mkdtempSync(join(tmpdir(), 'proma-marketplace-lifecycle-'))
  const skillsDirectory = join(root, 'skills')
  const inactiveSkillsDirectory = join(root, 'skills-inactive')
  mkdirSync(skillsDirectory)
  mkdirSync(inactiveSkillsDirectory)
  temporaryDirectories.push(root)
  return { root, skillsDirectory, inactiveSkillsDirectory }
}

function writeMarketplaceSkill(
  parentDirectory: string,
  input: {
    marketplaceSkillId: string
    identifier: string
    installedVersion: string
    contentHash: string
    installedAt: string
  },
): void {
  const skillDirectory = join(parentDirectory, input.identifier)
  mkdirSync(skillDirectory)
  writeFileSync(join(skillDirectory, 'SKILL.md'), `---\nname: ${input.identifier}\n---\n`)
  writeFileSync(join(skillDirectory, '.source.json'), JSON.stringify({
    kind: 'marketplace',
    ...input,
  }))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MarketplaceSkillLifecycle', () => {
  test('Given active and inactive marketplace Skills, When listing, Then returns trusted installed state', () => {
    const workspace = createWorkspace()
    writeMarketplaceSkill(workspace.skillsDirectory, {
      marketplaceSkillId: 'skill-active',
      identifier: 'active-skill',
      installedVersion: '1.2.3',
      contentHash: 'active-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    })
    writeMarketplaceSkill(workspace.inactiveSkillsDirectory, {
      marketplaceSkillId: 'skill-inactive',
      identifier: 'inactive-skill',
      installedVersion: '2.0.0',
      contentHash: 'inactive-hash',
      installedAt: '2026-07-18T01:00:00.000Z',
    })
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(lifecycle.listInstalled('workspace-a')).toEqual([
      {
        marketplaceSkillId: 'skill-active',
        identifier: 'active-skill',
        installedVersion: '1.2.3',
        contentHash: 'active-hash',
        installedAt: '2026-07-18T00:00:00.000Z',
        enabled: true,
      },
      {
        marketplaceSkillId: 'skill-inactive',
        identifier: 'inactive-skill',
        installedVersion: '2.0.0',
        contentHash: 'inactive-hash',
        installedAt: '2026-07-18T01:00:00.000Z',
        enabled: false,
      },
    ])
  })

  test('Given an enabled marketplace Skill, When disabling by marketplace ID, Then moves only the trusted target', () => {
    const workspace = createWorkspace()
    writeMarketplaceSkill(workspace.skillsDirectory, {
      marketplaceSkillId: 'skill-active',
      identifier: 'active-skill',
      installedVersion: '1.2.3',
      contentHash: 'active-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    })
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(lifecycle.setEnabled({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'skill-active',
      enabled: false,
    })).toEqual({
      marketplaceSkillId: 'skill-active',
      identifier: 'active-skill',
      installedVersion: '1.2.3',
      contentHash: 'active-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
      enabled: false,
    })
    expect(existsSync(join(workspace.skillsDirectory, 'active-skill'))).toBe(false)
    expect(existsSync(join(workspace.inactiveSkillsDirectory, 'active-skill'))).toBe(true)
  })

  test('Given a disabled marketplace Skill, When uninstalling by marketplace ID, Then removes the verified directory', () => {
    const workspace = createWorkspace()
    writeMarketplaceSkill(workspace.inactiveSkillsDirectory, {
      marketplaceSkillId: 'skill-inactive',
      identifier: 'inactive-skill',
      installedVersion: '2.0.0',
      contentHash: 'inactive-hash',
      installedAt: '2026-07-18T01:00:00.000Z',
    })
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(lifecycle.uninstall({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'skill-inactive',
    })).toEqual({
      marketplaceSkillId: 'skill-inactive',
      identifier: 'inactive-skill',
      installedVersion: '2.0.0',
      contentHash: 'inactive-hash',
      installedAt: '2026-07-18T01:00:00.000Z',
      enabled: false,
    })
    expect(existsSync(join(workspace.inactiveSkillsDirectory, 'inactive-skill'))).toBe(false)
  })

  test('Given a marketplace ID, When reading installed status, Then returns only the matching trusted Skill', () => {
    const workspace = createWorkspace()
    writeMarketplaceSkill(workspace.skillsDirectory, {
      marketplaceSkillId: 'skill-active',
      identifier: 'active-skill',
      installedVersion: '1.2.3',
      contentHash: 'active-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    })
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(lifecycle.getInstalled({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'skill-active',
    })?.identifier).toBe('active-skill')
    expect(lifecycle.getInstalled({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'not-installed',
    })).toBeUndefined()
  })

  test('Given a different marketplace ID, When uninstalling, Then preserves the installed Skill', () => {
    const workspace = createWorkspace()
    writeMarketplaceSkill(workspace.skillsDirectory, {
      marketplaceSkillId: 'installed-id',
      identifier: 'installed-skill',
      installedVersion: '1.0.0',
      contentHash: 'installed-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    })
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(() => lifecycle.uninstall({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'different-id',
    })).toThrow('未找到对应的市场 Skill')
    expect(existsSync(join(workspace.skillsDirectory, 'installed-skill'))).toBe(true)
  })

  test('Given a workspace-source Skill, When marketplace uninstall is requested, Then never deletes it', () => {
    const workspace = createWorkspace()
    const skillDirectory = join(workspace.skillsDirectory, 'workspace-skill')
    mkdirSync(skillDirectory)
    writeFileSync(join(skillDirectory, 'SKILL.md'), '---\nname: workspace-skill\n---\n')
    writeFileSync(join(skillDirectory, '.source.json'), JSON.stringify({
      kind: 'workspace',
      sourceWorkspaceSlug: 'source-workspace',
      sourceWorkspaceName: '来源工作区',
      importedAt: '2026-07-18T00:00:00.000Z',
      sourceVersion: '1.0.0',
    }))
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(() => lifecycle.uninstall({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'workspace-skill',
    })).toThrow('未找到对应的市场 Skill')
    expect(existsSync(skillDirectory)).toBe(true)
  })

  test('Given duplicate targets for one marketplace ID, When changing state, Then refuses the ambiguous operation', () => {
    const workspace = createWorkspace()
    for (const [parentDirectory, identifier] of [
      [workspace.skillsDirectory, 'active-copy'],
      [workspace.inactiveSkillsDirectory, 'inactive-copy'],
    ] as const) {
      writeMarketplaceSkill(parentDirectory, {
        marketplaceSkillId: 'duplicate-id',
        identifier,
        installedVersion: '1.0.0',
        contentHash: `${identifier}-hash`,
        installedAt: '2026-07-18T00:00:00.000Z',
      })
    }
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(() => lifecycle.setEnabled({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'duplicate-id',
      enabled: false,
    })).toThrow('检测到重复的市场 Skill')
    expect(existsSync(join(workspace.skillsDirectory, 'active-copy'))).toBe(true)
    expect(existsSync(join(workspace.inactiveSkillsDirectory, 'inactive-copy'))).toBe(true)
  })

  test('Given malformed IPC input, When changing state, Then rejects before touching the Skill', () => {
    const workspace = createWorkspace()
    writeMarketplaceSkill(workspace.skillsDirectory, {
      marketplaceSkillId: 'installed-id',
      identifier: 'installed-skill',
      installedVersion: '1.0.0',
      contentHash: 'installed-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    })
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(() => lifecycle.setEnabled({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'installed-id',
      enabled: 'false' as unknown as boolean,
    })).toThrow('市场 Skill 生命周期请求无效')
    expect(existsSync(join(workspace.skillsDirectory, 'installed-skill'))).toBe(true)
  })

  test.skipIf(process.platform === 'win32')('Given symlinked source metadata, When listing, Then never trusts or removes the target', () => {
    const workspace = createWorkspace()
    const skillDirectory = join(workspace.skillsDirectory, 'linked-source')
    const externalSource = join(workspace.root, 'external-source.json')
    mkdirSync(skillDirectory)
    writeFileSync(join(skillDirectory, 'SKILL.md'), '---\nname: linked-source\n---\n')
    writeFileSync(externalSource, JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'linked-id',
      identifier: 'linked-source',
      installedVersion: '1.0.0',
      contentHash: 'linked-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    }))
    symlinkSync(externalSource, join(skillDirectory, '.source.json'))
    const lifecycle = new MarketplaceSkillLifecycle({
      resolveWorkspaceDirectories: () => workspace,
    })

    expect(lifecycle.listInstalled('workspace-a')).toEqual([])
    expect(() => lifecycle.uninstall({
      workspaceSlug: 'workspace-a',
      marketplaceSkillId: 'linked-id',
    })).toThrow('未找到对应的市场 Skill')
    expect(existsSync(skillDirectory)).toBe(true)
  })
})
