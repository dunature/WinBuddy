export const MARKETPLACE_DEFAULT_PAGE_SIZE = 16
export const MARKETPLACE_MAX_PAGE_SIZE = 50
export const MARKETPLACE_MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

export const MARKETPLACE_ZIP_LIMITS = Object.freeze({
  archiveBytes: 20 * 1024 * 1024,
  fileCount: 500,
  singleFileBytes: 10 * 1024 * 1024,
  expandedBytes: 50 * 1024 * 1024,
  directoryDepth: 8,
  compressionRatio: 100,
})

export type MarketplaceZipEntryKind = 'file' | 'directory' | 'symlink' | 'hardlink' | 'special'

export interface MarketplaceZipEntryDescriptor {
  path: string
  kind: MarketplaceZipEntryKind
  compressedSize: number
  uncompressedSize: number
}

export type MarketplacePackageValidationRule =
  | 'archive_size'
  | 'file_count'
  | 'single_file_size'
  | 'expanded_size'
  | 'compression_ratio'
  | 'path_safety'
  | 'entry_type'
  | 'directory_depth'
  | 'skill_root'
  | 'skill_md'
  | 'manifest'

export interface MarketplacePackageValidationCheck {
  rule: MarketplacePackageValidationRule
  passed: boolean
  code: string
  message: string
  path?: string
}

export interface MarketplaceSkillPackageManifest {
  identifier: string
  description: string
  version: string
}

export interface MarketplacePackageValidationInput {
  archiveSize: number
  entries: MarketplaceZipEntryDescriptor[]
  skillMdContent?: string
  expectedIdentifier: string
  expectedVersion: string
}

export interface MarketplacePackageValidationResult {
  passed: boolean
  checks: MarketplacePackageValidationCheck[]
  rootDirectory: string | null
  fileCount: number
  expandedSize: number
  manifest: MarketplaceSkillPackageManifest | null
}

const validationRules: Array<{
  rule: MarketplacePackageValidationRule
  code: string
  message: string
}> = [
  { rule: 'archive_size', code: 'ZIP_ARCHIVE_SIZE_OK', message: '压缩包大小符合限制' },
  { rule: 'file_count', code: 'ZIP_FILE_COUNT_OK', message: '文件数量符合限制' },
  { rule: 'single_file_size', code: 'ZIP_FILE_SIZE_OK', message: '单文件大小符合限制' },
  { rule: 'expanded_size', code: 'ZIP_EXPANDED_SIZE_OK', message: '解压后总大小符合限制' },
  { rule: 'compression_ratio', code: 'ZIP_COMPRESSION_RATIO_OK', message: '压缩比符合限制' },
  { rule: 'path_safety', code: 'ZIP_PATHS_SAFE', message: '所有文件路径安全' },
  { rule: 'entry_type', code: 'ZIP_ENTRY_TYPES_SAFE', message: '未发现链接或特殊文件' },
  { rule: 'directory_depth', code: 'ZIP_DEPTH_OK', message: '目录深度符合限制' },
  { rule: 'skill_root', code: 'SKILL_ROOT_OK', message: 'Skill 根目录唯一且与 identifier 一致' },
  { rule: 'skill_md', code: 'SKILL_MD_OK', message: '存在唯一根 SKILL.md' },
  { rule: 'manifest', code: 'SKILL_MANIFEST_OK', message: 'SKILL.md manifest 与候选版本一致' },
]

interface NormalizedMarketplaceZipPath {
  normalized: string
  segments: string[]
}

function normalizeMarketplaceZipPath(
  path: string,
): NormalizedMarketplaceZipPath | MarketplacePackageValidationCheck {
  if (path.includes('\0')) {
    return { rule: 'path_safety', passed: false, code: 'ZIP_NUL_PATH', message: '路径包含 NUL 字符', path }
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return { rule: 'path_safety', passed: false, code: 'ZIP_DRIVE_PATH', message: '禁止 Windows 盘符路径', path }
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    return { rule: 'path_safety', passed: false, code: 'ZIP_ABSOLUTE_PATH', message: '禁止绝对路径', path }
  }
  const rawSegments = path.replaceAll('\\', '/').split('/')
  if (rawSegments.includes('..')) {
    return { rule: 'path_safety', passed: false, code: 'ZIP_PARENT_PATH', message: '禁止父目录路径', path }
  }
  const segments = rawSegments.filter((segment) => segment && segment !== '.')
  if (segments.length === 0) {
    return { rule: 'path_safety', passed: false, code: 'ZIP_EMPTY_PATH', message: '路径不能为空', path }
  }
  return { normalized: segments.join('/').normalize('NFC'), segments }
}

function unquoteFrontmatterValue(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value.at(-1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
  }
  return value
}

export function parseMarketplaceSkillPackageManifest(content: string): MarketplaceSkillPackageManifest | null {
  const source = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/)
  if (!match?.[1]) return null

  const values: Record<string, string> = {}
  let currentKey = ''
  let folded = false
  for (const line of match[1].split(/\r?\n/)) {
    if (!/^\s/.test(line)) {
      const separator = line.indexOf(':')
      if (separator < 1) {
        currentKey = ''
        continue
      }
      const key = line.slice(0, separator).trim()
      const rawValue = line.slice(separator + 1).trim()
      if (!['name', 'description', 'version'].includes(key)) {
        currentKey = ''
        continue
      }
      if (rawValue === '|' || rawValue === '>') {
        currentKey = key
        folded = rawValue === '>'
        values[key] = ''
      } else {
        currentKey = ''
        folded = false
        values[key] = unquoteFrontmatterValue(rawValue)
      }
      continue
    }
    if (!currentKey) continue
    const value = line.trim()
    if (!value) continue
    values[currentKey] = values[currentKey]
      ? `${values[currentKey]}${folded ? ' ' : '\n'}${value}`
      : value
  }

  const identifier = values.name?.trim()
  const description = values.description?.trim()
  const version = values.version?.trim()
  if (!identifier || !description || !version) return null
  return { identifier, description, version }
}

export function validateMarketplacePackage(
  input: MarketplacePackageValidationInput,
): MarketplacePackageValidationResult {
  const failures: MarketplacePackageValidationCheck[] = []
  const normalizedEntries: Array<NormalizedMarketplaceZipPath & { kind: MarketplaceZipEntryKind }> = []
  const seenPaths = new Set<string>()
  const fileEntries = input.entries.filter((entry) => entry.kind !== 'directory')
  const expandedSize = fileEntries.reduce((total, entry) => total + entry.uncompressedSize, 0)

  if (input.archiveSize > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
    failures.push({ rule: 'archive_size', passed: false, code: 'ZIP_ARCHIVE_TOO_LARGE', message: 'ZIP 不能超过 20 MB' })
  }
  if (fileEntries.length > MARKETPLACE_ZIP_LIMITS.fileCount) {
    failures.push({ rule: 'file_count', passed: false, code: 'ZIP_TOO_MANY_FILES', message: 'ZIP 不能超过 500 个文件' })
  }
  if (expandedSize > MARKETPLACE_ZIP_LIMITS.expandedBytes) {
    failures.push({ rule: 'expanded_size', passed: false, code: 'ZIP_EXPANDED_SIZE_EXCEEDED', message: '解压后总大小不能超过 50 MB' })
  }

  for (const entry of input.entries) {
    const normalized = normalizeMarketplaceZipPath(entry.path)
    if ('passed' in normalized) {
      failures.push(normalized)
    } else {
      const comparablePath = normalized.normalized.toLocaleLowerCase('en-US')
      if (seenPaths.has(comparablePath)) {
        failures.push({
          rule: 'path_safety',
          passed: false,
          code: 'ZIP_DUPLICATE_PATH',
          message: '规范化后存在重复路径',
          path: entry.path,
        })
      } else {
        seenPaths.add(comparablePath)
      }
      normalizedEntries.push({ ...normalized, kind: entry.kind })
      if (normalized.segments.length - 1 > MARKETPLACE_ZIP_LIMITS.directoryDepth) {
        failures.push({
          rule: 'directory_depth',
          passed: false,
          code: 'ZIP_DEPTH_EXCEEDED',
          message: '目录深度不能超过 8 层',
          path: entry.path,
        })
      }
    }

    if (entry.kind === 'symlink') {
      failures.push({ rule: 'entry_type', passed: false, code: 'ZIP_SYMLINK', message: '禁止符号链接', path: entry.path })
    } else if (entry.kind === 'hardlink') {
      failures.push({ rule: 'entry_type', passed: false, code: 'ZIP_HARDLINK', message: '禁止硬链接', path: entry.path })
    } else if (entry.kind === 'special') {
      failures.push({ rule: 'entry_type', passed: false, code: 'ZIP_SPECIAL_ENTRY', message: '禁止特殊文件', path: entry.path })
    }

    if (entry.kind !== 'directory' && entry.uncompressedSize > MARKETPLACE_ZIP_LIMITS.singleFileBytes) {
      failures.push({
        rule: 'single_file_size',
        passed: false,
        code: 'ZIP_FILE_TOO_LARGE',
        message: '单文件不能超过 10 MB',
        path: entry.path,
      })
    }
    const ratio = entry.uncompressedSize === 0
      ? 0
      : entry.compressedSize === 0 ? Number.POSITIVE_INFINITY : entry.uncompressedSize / entry.compressedSize
    if (entry.kind !== 'directory' && ratio > MARKETPLACE_ZIP_LIMITS.compressionRatio) {
      failures.push({
        rule: 'compression_ratio',
        passed: false,
        code: 'ZIP_COMPRESSION_RATIO_EXCEEDED',
        message: '单文件压缩比不能超过 100',
        path: entry.path,
      })
    }
  }

  const rootDirectories = new Set(normalizedEntries.map((entry) => entry.segments[0]).filter(Boolean))
  const rootDirectory = rootDirectories.size === 1 ? [...rootDirectories][0]! : null
  if (rootDirectories.size > 1) {
    failures.push({ rule: 'skill_root', passed: false, code: 'SKILL_MULTIPLE_ROOTS', message: 'ZIP 必须只有一个 Skill 根目录' })
  } else if (!rootDirectory || rootDirectory !== input.expectedIdentifier) {
    failures.push({ rule: 'skill_root', passed: false, code: 'SKILL_ROOT_MISMATCH', message: 'Skill 根目录必须与 identifier 一致' })
  }

  const skillMdPath = rootDirectory ? `${rootDirectory}/SKILL.md` : ''
  const skillMdEntries = normalizedEntries.filter((entry) => (
    entry.kind === 'file' && entry.normalized === skillMdPath
  ))
  if (skillMdEntries.length === 0) {
    failures.push({ rule: 'skill_md', passed: false, code: 'SKILL_MD_MISSING', message: 'Skill 根目录必须包含 SKILL.md' })
  } else if (skillMdEntries.length > 1) {
    failures.push({ rule: 'skill_md', passed: false, code: 'SKILL_MD_DUPLICATE', message: 'Skill 根目录只能有一个 SKILL.md' })
  }

  const manifest = input.skillMdContent
    ? parseMarketplaceSkillPackageManifest(input.skillMdContent)
    : null
  if (!manifest) {
    failures.push({ rule: 'manifest', passed: false, code: 'SKILL_MANIFEST_INVALID', message: 'SKILL.md frontmatter 必须包含 name、description 和 version' })
  } else {
    if (manifest.identifier !== input.expectedIdentifier) {
      failures.push({ rule: 'manifest', passed: false, code: 'SKILL_IDENTIFIER_MISMATCH', message: 'SKILL.md name 必须与 identifier 一致', path: skillMdPath || undefined })
    }
    if (manifest.version !== input.expectedVersion || !isMarketplaceSemVer(manifest.version)) {
      failures.push({ rule: 'manifest', passed: false, code: 'SKILL_VERSION_MISMATCH', message: 'SKILL.md version 必须与候选版本一致', path: skillMdPath || undefined })
    }
  }

  const failedRules = new Set(failures.map((check) => check.rule))
  const checks = [
    ...validationRules.filter((check) => !failedRules.has(check.rule)).map((check) => ({ ...check, passed: true })),
    ...failures,
  ]
  return {
    passed: failures.length === 0,
    checks,
    rootDirectory,
    fileCount: fileEntries.length,
    expandedSize,
    manifest,
  }
}

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

export type MarketplaceGoldenPathAction = 'submit_review' | 'approve' | 'publish'

export interface MarketplaceGoldenPathState {
  action: MarketplaceGoldenPathAction
  versionId: string
  versionStatus: MarketplaceVersionStatus
  skillStatus: MarketplaceSkillStatus
  currentPublishedVersionId: string | null
}

export interface MarketplaceGoldenPathResult {
  changed: boolean
  versionStatus: MarketplaceVersionStatus
  skillStatus: MarketplaceSkillStatus
  currentPublishedVersionId: string | null
}

export class MarketplaceGoldenPathError extends Error {
  constructor(readonly code: 'MARKETPLACE_VERSION_ACTION_NOT_ALLOWED' | 'MARKETPLACE_PUBLISHED_POINTER_MISMATCH') {
    super(code)
    this.name = 'MarketplaceGoldenPathError'
  }
}

const goldenPathTransitions: Record<MarketplaceGoldenPathAction, {
  from: MarketplaceVersionStatus
  to: MarketplaceVersionStatus
}> = {
  submit_review: { from: 'created', to: 'pending_review' },
  approve: { from: 'pending_review', to: 'approved' },
  publish: { from: 'approved', to: 'published' },
}

export function applyMarketplaceGoldenPathAction(
  state: MarketplaceGoldenPathState,
): MarketplaceGoldenPathResult {
  const transition = goldenPathTransitions[state.action]
  if (state.versionStatus === transition.to) {
    if (state.action === 'publish' && state.currentPublishedVersionId !== state.versionId) {
      throw new MarketplaceGoldenPathError('MARKETPLACE_PUBLISHED_POINTER_MISMATCH')
    }
    return {
      changed: false,
      versionStatus: state.versionStatus,
      skillStatus: state.skillStatus,
      currentPublishedVersionId: state.currentPublishedVersionId,
    }
  }
  if (state.versionStatus !== transition.from) {
    throw new MarketplaceGoldenPathError('MARKETPLACE_VERSION_ACTION_NOT_ALLOWED')
  }
  return {
    changed: true,
    versionStatus: transition.to,
    skillStatus: state.action === 'publish' ? 'published' : state.skillStatus,
    currentPublishedVersionId: state.action === 'publish' ? state.versionId : state.currentPublishedVersionId,
  }
}

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
