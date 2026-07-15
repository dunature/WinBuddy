import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { compareMarketplaceVersions } from '@proma/marketplace-domain'
import type { MarketplaceInstallConflict, MarketplaceSkillSource } from '@proma/shared'

const SOURCE_FILE = '.proma-source.json'

interface UnknownSkillSource {
  sourceType?: string
}

export interface MarketplaceConflictCheckInput {
  slug: string
  marketplaceSkillId: string
  marketplaceVersion: string
  marketplaceSha256: string
  targetDir: string
}

export type MarketplaceConflictCheckResult = MarketplaceInstallConflict | 'already-installed' | null

export function readMarketplaceSkillSource(skillDir: string): MarketplaceSkillSource | undefined {
  const sourcePath = join(skillDir, SOURCE_FILE)
  if (!existsSync(sourcePath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as UnknownSkillSource
    return isMarketplaceSource(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function collectMarketplaceFileHashes(rootDir: string): Record<string, string> {
  const hashes: Record<string, string> = {}
  walk(rootDir, rootDir, hashes)
  return hashes
}

export function detectMarketplaceInstallConflict(input: MarketplaceConflictCheckInput): MarketplaceConflictCheckResult {
  if (!existsSync(input.targetDir)) return null
  const sourcePath = join(input.targetDir, SOURCE_FILE)
  if (!existsSync(sourcePath)) return conflict('unmanaged', input)
  let rawSource: UnknownSkillSource
  try {
    rawSource = JSON.parse(readFileSync(sourcePath, 'utf8')) as UnknownSkillSource
  } catch {
    return conflict('different-source', input)
  }
  if (!isMarketplaceSource(rawSource)) return conflict('different-source', input)
  const source = rawSource
  if (source.marketplaceSkillId !== input.marketplaceSkillId || source.slug !== input.slug) return conflict('different-source', input, source)
  const changedFiles = source.files ? diffFileHashes(source.files, collectMarketplaceFileHashes(input.targetDir)) : []
  if (changedFiles.length > 0) return conflict('locally-modified', input, source, changedFiles)
  if (compareMarketplaceVersions(input.marketplaceVersion, source.version) < 0) return conflict('downgrade', input, source)
  if (input.marketplaceVersion === source.version && input.marketplaceSha256 === source.sha256) return 'already-installed'
  return null
}

export function diffFileHashes(expected: Record<string, string>, actual: Record<string, string>): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((path) => expected[path] !== actual[path])
    .sort()
}

function walk(rootDir: string, currentDir: string, output: Record<string, string>): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === SOURCE_FILE) continue
    const absolutePath = join(currentDir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walk(rootDir, absolutePath, output)
    else if (entry.isFile() && statSync(absolutePath).size <= 10 * 1024 * 1024) {
      output[relative(rootDir, absolutePath).replace(/\\/g, '/')] = createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
    }
  }
}

function conflict(kind: MarketplaceInstallConflict['kind'], input: MarketplaceConflictCheckInput, source?: MarketplaceSkillSource, changedFiles: string[] = []): MarketplaceInstallConflict {
  return { kind, slug: input.slug, localVersion: source?.version, marketplaceVersion: input.marketplaceVersion, changedFiles, localSource: source }
}

function isMarketplaceSource(source: UnknownSkillSource): source is MarketplaceSkillSource {
  const candidate = source as Partial<MarketplaceSkillSource>
  return candidate.sourceType === 'marketplace'
    && candidate.schemaVersion === 1
    && typeof candidate.marketplaceSkillId === 'string'
    && typeof candidate.slug === 'string'
    && typeof candidate.version === 'string'
    && typeof candidate.sha256 === 'string'
    && typeof candidate.installedAt === 'string'
}
