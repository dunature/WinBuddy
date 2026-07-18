export const MARKETPLACE_DEFAULT_PAGE_SIZE = 16
export const MARKETPLACE_MAX_PAGE_SIZE = 50
export const MARKETPLACE_MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

export const MARKETPLACE_SKILL_STATUSES = ['draft', 'published', 'unpublished', 'archived'] as const
export const MARKETPLACE_VERSION_STATUSES = [
  'created',
  'validation_failed',
  'pending_review',
  'approved',
  'rejected',
  'published',
  'unpublished',
  'archived',
] as const

export type MarketplaceSkillStatus = typeof MARKETPLACE_SKILL_STATUSES[number]
export type MarketplaceVersionStatus = typeof MARKETPLACE_VERSION_STATUSES[number]

export interface MarketplaceDraftSkillState {
  status: 'draft'
  currentPublishedVersionId: null
}

export interface MarketplaceCandidateVersionState {
  status: 'created'
  currentPublishedVersionId: string | null
}

const identifierPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const semVerIdentifierPattern = /^[0-9A-Za-z-]+$/

export function isMarketplaceIdentifier(value: string): boolean {
  return value.length <= 64 && identifierPattern.test(value)
}

function isSemVerNumber(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value)
}

export function isMarketplaceSemVer(value: string): boolean {
  if (!value || value.length > 128) return false
  const buildParts = value.split('+')
  if (buildParts.length > 2) return false
  const [versionAndPrerelease, build] = buildParts
  if (!versionAndPrerelease) return false
  if (build !== undefined && (!build || build.split('.').some((part) => !semVerIdentifierPattern.test(part)))) {
    return false
  }

  const prereleaseSeparator = versionAndPrerelease.indexOf('-')
  const core = prereleaseSeparator === -1
    ? versionAndPrerelease
    : versionAndPrerelease.slice(0, prereleaseSeparator)
  const prerelease = prereleaseSeparator === -1
    ? undefined
    : versionAndPrerelease.slice(prereleaseSeparator + 1)
  const coreParts = core.split('.')
  if (coreParts.length !== 3 || coreParts.some((part) => !isSemVerNumber(part))) return false
  if (prerelease !== undefined) {
    if (!prerelease) return false
    const identifiers = prerelease.split('.')
    if (identifiers.some((part) => !semVerIdentifierPattern.test(part)
      || (/^\d+$/.test(part) && !isSemVerNumber(part)))) return false
  }
  return true
}

export function createMarketplaceDraftSkillState(): MarketplaceDraftSkillState {
  return { status: 'draft', currentPublishedVersionId: null }
}

export function createMarketplaceCandidateVersionState(
  currentPublishedVersionId: string | null,
): MarketplaceCandidateVersionState {
  return { status: 'created', currentPublishedVersionId }
}

export interface MarketplacePaginationInput {
  page?: string | number | null
  pageSize?: string | number | null
}

export interface MarketplacePagination {
  page: number
  pageSize: number
}

function positiveInteger(value: string | number | null | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeMarketplacePagination(input: MarketplacePaginationInput): MarketplacePagination {
  return {
    page: positiveInteger(input.page, 1),
    pageSize: Math.min(MARKETPLACE_MAX_PAGE_SIZE, positiveInteger(input.pageSize, MARKETPLACE_DEFAULT_PAGE_SIZE)),
  }
}

interface MarketplaceStoredFile {
  path: string
  size: number
}

interface MutableFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  children: Map<string, MutableFileNode>
}

export interface MarketplaceDomainFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  children?: MarketplaceDomainFileNode[]
}

function publicFileNode(node: MutableFileNode): MarketplaceDomainFileNode {
  if (node.type === 'file') {
    return { path: node.path, name: node.name, type: 'file', size: node.size }
  }
  const children = [...node.children.values()]
    .sort((left, right) => left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)
    .map(publicFileNode)
  return { path: node.path, name: node.name, type: 'directory', size: 0, children }
}

export function buildMarketplaceFileTree(files: readonly MarketplaceStoredFile[]): MarketplaceDomainFileNode[] {
  const roots = new Map<string, MutableFileNode>()

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let siblings = roots
    let currentPath = ''
    for (const [index, name] of parts.entries()) {
      currentPath = currentPath ? `${currentPath}/${name}` : name
      const isFile = index === parts.length - 1
      let node = siblings.get(name)
      if (!node) {
        node = {
          path: currentPath,
          name,
          type: isFile ? 'file' : 'directory',
          size: isFile ? file.size : 0,
          children: new Map(),
        }
        siblings.set(name, node)
      }
      siblings = node.children
    }
  }

  return [...roots.values()]
    .sort((left, right) => left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)
    .map(publicFileNode)
}
