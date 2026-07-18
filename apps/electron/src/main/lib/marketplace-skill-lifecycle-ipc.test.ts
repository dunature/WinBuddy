import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKETPLACE_IPC_CHANNELS } from '@proma/shared'
import { MarketplaceSkillLifecycle } from './marketplace-skill-lifecycle'
import { registerMarketplaceSkillLifecycleIpc } from './marketplace-skill-lifecycle-ipc'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Given lifecycle IPC, When renderer disables by marketplace ID, Then handler returns trusted state', () => {
  const root = mkdtempSync(join(tmpdir(), 'proma-marketplace-lifecycle-ipc-'))
  const skillsDirectory = join(root, 'skills')
  const inactiveSkillsDirectory = join(root, 'skills-inactive')
  const skillDirectory = join(skillsDirectory, 'trusted-skill')
  mkdirSync(skillDirectory, { recursive: true })
  mkdirSync(inactiveSkillsDirectory)
  writeFileSync(join(skillDirectory, 'SKILL.md'), '---\nname: trusted-skill\n---\n')
  writeFileSync(join(skillDirectory, '.source.json'), JSON.stringify({
    kind: 'marketplace',
    marketplaceSkillId: 'marketplace-1',
    identifier: 'trusted-skill',
    installedVersion: '1.0.0',
    contentHash: 'trusted-hash',
    installedAt: '2026-07-18T00:00:00.000Z',
  }))
  temporaryDirectories.push(root)

  const lifecycle = new MarketplaceSkillLifecycle({
    resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
  })
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  registerMarketplaceSkillLifecycleIpc(
    (channel, handler) => handlers.set(channel, handler),
    lifecycle,
  )

  const statusHandler = handlers.get(MARKETPLACE_IPC_CHANNELS.GET_INSTALLED_SKILL)
  expect(statusHandler?.({
    workspaceSlug: 'workspace-a',
    marketplaceSkillId: 'marketplace-1',
  })).toEqual({
    marketplaceSkillId: 'marketplace-1',
    identifier: 'trusted-skill',
    installedVersion: '1.0.0',
    contentHash: 'trusted-hash',
    installedAt: '2026-07-18T00:00:00.000Z',
    enabled: true,
  })

  const listHandler = handlers.get(MARKETPLACE_IPC_CHANNELS.LIST_INSTALLED_SKILLS)
  expect(listHandler?.('workspace-a')).toEqual([{
    marketplaceSkillId: 'marketplace-1',
    identifier: 'trusted-skill',
    installedVersion: '1.0.0',
    contentHash: 'trusted-hash',
    installedAt: '2026-07-18T00:00:00.000Z',
    enabled: true,
  }])

  const handler = handlers.get(MARKETPLACE_IPC_CHANNELS.SET_INSTALLED_SKILL_ENABLED)
  expect(handler?.({
    workspaceSlug: 'workspace-a',
    marketplaceSkillId: 'marketplace-1',
    enabled: false,
  })).toEqual({
    marketplaceSkillId: 'marketplace-1',
    identifier: 'trusted-skill',
    installedVersion: '1.0.0',
    contentHash: 'trusted-hash',
    installedAt: '2026-07-18T00:00:00.000Z',
    enabled: false,
  })

  const uninstallHandler = handlers.get(MARKETPLACE_IPC_CHANNELS.UNINSTALL_SKILL)
  expect(uninstallHandler?.({
    workspaceSlug: 'workspace-a',
    marketplaceSkillId: 'marketplace-1',
  })).toEqual({
    marketplaceSkillId: 'marketplace-1',
    identifier: 'trusted-skill',
    installedVersion: '1.0.0',
    contentHash: 'trusted-hash',
    installedAt: '2026-07-18T00:00:00.000Z',
    enabled: false,
  })
  expect(listHandler?.('workspace-a')).toEqual([])
})
