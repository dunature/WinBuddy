import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compareMarketplaceVersions } from '@proma/marketplace-domain'
import { formatMarketplaceLog, type MarketplaceAvailableUpdate, type MarketplacePermissionSet, type MarketplaceSkillDetail, type MarketplaceSkillSource } from '@proma/shared'
import { getWorkspaceSkillsDir } from './config-paths'
import { listAgentWorkspaces } from './agent-workspace-manager'
import { readMarketplaceSkillSource } from './marketplace-source'
import { getSettings } from './settings-service'

const DEFAULT_API_URL = 'https://marketplace.proma.ai/api/v1'

export function getInstalledMarketplaceSource(workspaceSlug: string, skillSlug: string): MarketplaceSkillSource | undefined {
  assertWorkspace(workspaceSlug)
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(skillSlug)) return undefined
  return readMarketplaceSkillSource(join(getWorkspaceSkillsDir(workspaceSlug), skillSlug))
}

export async function checkMarketplaceUpdates(workspaceSlug: string): Promise<MarketplaceAvailableUpdate[]> {
  assertWorkspace(workspaceSlug)
  const skillsDir = getWorkspaceSkillsDir(workspaceSlug)
  if (!existsSync(skillsDir)) return []
  const sources = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMarketplaceSkillSource(join(skillsDir, entry.name)))
    .filter((source): source is MarketplaceSkillSource => source !== undefined)
  const updates = await Promise.all(sources.map(checkSourceUpdate))
  return updates.filter((update): update is MarketplaceAvailableUpdate => update !== undefined)
}

async function checkSourceUpdate(source: MarketplaceSkillSource): Promise<MarketplaceAvailableUpdate | undefined> {
  try {
    const baseUrl = (getSettings().marketplaceApiUrl || DEFAULT_API_URL).replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/skills/${encodeURIComponent(source.slug)}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } })
    if (!response.ok) return undefined
    const detail = await response.json() as MarketplaceSkillDetail
    if (compareMarketplaceVersions(detail.currentVersion.version, source.version) <= 0) return undefined
    return { slug: source.slug, currentVersion: source.version, latestVersion: detail.currentVersion, permissionsAdded: addedPermissions(source.permissions, detail.currentVersion.permissions) }
  } catch {
    console.warn(formatMarketplaceLog('更新检查失败', { skillId: source.marketplaceSkillId, version: source.version, errorCode: 'UPDATE_CHECK_FAILED', result: 'failed' }))
    return undefined
  }
}

export function addedPermissions(previous: MarketplacePermissionSet | undefined, next: MarketplacePermissionSet): MarketplaceAvailableUpdate['permissionsAdded'] {
  const before = previous ?? { network: false, filesystem: { read: false, write: 'none' }, shell: false }
  const added: MarketplaceAvailableUpdate['permissionsAdded'] = []
  if (!before.network && next.network) added.push('network')
  if (!before.filesystem.read && next.filesystem.read) added.push('filesystem')
  if (!before.shell && next.shell) added.push('shell')
  if (writeRank(next.filesystem.write) > writeRank(before.filesystem.write)) added.push('filesystem.write')
  return added
}

function writeRank(value: MarketplacePermissionSet['filesystem']['write']): number {
  return value === 'workspace' ? 2 : value === 'output-only' ? 1 : 0
}

function assertWorkspace(workspaceSlug: string): void {
  if (!listAgentWorkspaces().some((workspace) => workspace.slug === workspaceSlug)) throw Object.assign(new Error('目标工作区不存在'), { code: 'WORKSPACE_NOT_FOUND' })
}
