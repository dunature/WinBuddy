import { existsSync, lstatSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MarketplaceInstalledSkill,
  MarketplaceInstalledSkillRequest,
  MarketplaceSkillImportSource,
  MarketplaceToggleInstalledSkillRequest,
} from '@proma/shared'
import { rmSyncWithRetry } from './fs-retry'

interface WorkspaceDirectories {
  skillsDirectory: string
  inactiveSkillsDirectory: string
}

export interface MarketplaceSkillLifecycleOptions {
  resolveWorkspaceDirectories(workspaceSlug: string): WorkspaceDirectories
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readMarketplaceSource(skillDirectory: string): MarketplaceSkillImportSource | undefined {
  try {
    const sourcePath = join(skillDirectory, '.source.json')
    const sourceStat = lstatSync(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) return undefined
    const value = JSON.parse(readFileSync(sourcePath, 'utf8')) as unknown
    if (!isRecord(value) || value.kind !== 'marketplace') return undefined
    const fields = [
      'marketplaceSkillId',
      'identifier',
      'installedVersion',
      'contentHash',
      'installedAt',
    ] as const
    if (!fields.every((field) => typeof value[field] === 'string' && value[field].length > 0)) {
      return undefined
    }
    return {
      kind: 'marketplace',
      marketplaceSkillId: value.marketplaceSkillId as string,
      identifier: value.identifier as string,
      installedVersion: value.installedVersion as string,
      contentHash: value.contentHash as string,
      installedAt: value.installedAt as string,
    }
  } catch {
    return undefined
  }
}

function scanDirectory(directory: string, enabled: boolean): MarketplaceInstalledSkill[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) return []
    const skillDirectory = join(directory, entry.name)
    const skillMarkdown = join(skillDirectory, 'SKILL.md')
    if (!existsSync(skillMarkdown) || !lstatSync(skillMarkdown).isFile()) return []
    const source = readMarketplaceSource(skillDirectory)
    if (!source || source.identifier !== entry.name) return []
    return [{
      marketplaceSkillId: source.marketplaceSkillId,
      identifier: source.identifier,
      installedVersion: source.installedVersion,
      contentHash: source.contentHash,
      installedAt: source.installedAt,
      enabled,
    }]
  })
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function assertLifecycleRequest(request: MarketplaceInstalledSkillRequest): void {
  if (
    typeof request?.workspaceSlug !== 'string'
    || request.workspaceSlug.length === 0
    || typeof request.marketplaceSkillId !== 'string'
    || request.marketplaceSkillId.length === 0
  ) {
    throw new Error('市场 Skill 生命周期请求无效')
  }
}

export class MarketplaceSkillLifecycle {
  constructor(private readonly options: MarketplaceSkillLifecycleOptions) {}

  listInstalled(workspaceSlug: string): MarketplaceInstalledSkill[] {
    if (typeof workspaceSlug !== 'string' || workspaceSlug.length === 0) {
      throw new Error('市场 Skill 生命周期请求无效')
    }
    const directories = this.options.resolveWorkspaceDirectories(workspaceSlug)
    return [
      ...scanDirectory(directories.skillsDirectory, true),
      ...scanDirectory(directories.inactiveSkillsDirectory, false),
    ]
  }

  getInstalled(request: MarketplaceInstalledSkillRequest): MarketplaceInstalledSkill | undefined {
    assertLifecycleRequest(request)
    const matches = this.listInstalled(request.workspaceSlug)
      .filter((skill) => skill.marketplaceSkillId === request.marketplaceSkillId)
    if (matches.length > 1) throw new Error('检测到重复的市场 Skill，无法安全读取状态')
    return matches[0]
  }

  setEnabled(request: MarketplaceToggleInstalledSkillRequest): MarketplaceInstalledSkill {
    assertLifecycleRequest(request)
    if (typeof request.enabled !== 'boolean') {
      throw new Error('市场 Skill 生命周期请求无效')
    }
    const directories = this.options.resolveWorkspaceDirectories(request.workspaceSlug)
    const installed = this.getUniqueInstalled(request)
    if (installed.enabled === request.enabled) return installed
    const sourceParent = installed.enabled
      ? directories.skillsDirectory
      : directories.inactiveSkillsDirectory
    const targetParent = request.enabled
      ? directories.skillsDirectory
      : directories.inactiveSkillsDirectory
    const source = join(sourceParent, installed.identifier)
    const target = join(targetParent, installed.identifier)
    const sourceStat = lstatSync(source)
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new Error('市场 Skill 目标目录无效')
    }
    if (entryExists(target)) throw new Error('目标目录已存在同名 Skill')

    renameSync(source, target)
    return { ...installed, enabled: request.enabled }
  }

  uninstall(request: MarketplaceInstalledSkillRequest): MarketplaceInstalledSkill {
    assertLifecycleRequest(request)
    const directories = this.options.resolveWorkspaceDirectories(request.workspaceSlug)
    const installed = this.getUniqueInstalled(request)
    const parent = installed.enabled
      ? directories.skillsDirectory
      : directories.inactiveSkillsDirectory
    const target = join(parent, installed.identifier)
    const targetStat = lstatSync(target)
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
      throw new Error('市场 Skill 目标目录无效')
    }

    rmSyncWithRetry(target, { recursive: true, force: false })
    return installed
  }

  private getUniqueInstalled(request: MarketplaceInstalledSkillRequest): MarketplaceInstalledSkill {
    const installed = this.getInstalled(request)
    if (!installed) throw new Error('未找到对应的市场 Skill')
    return installed
  }
}
