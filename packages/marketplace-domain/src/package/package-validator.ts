export interface MarketplacePackageEntry {
  path: string
  compressedSize: number
  uncompressedSize: number
  isDirectory?: boolean
  isSymbolicLink?: boolean
}

export interface MarketplacePackageLimits {
  maxFiles: number
  maxSingleFileBytes: number
  maxTotalUncompressedBytes: number
  maxCompressionRatio: number
}

export interface MarketplacePackageIssue {
  code: string
  message: string
  path?: string
}

export interface ValidateMarketplacePackageResult {
  normalizedEntries: Array<MarketplacePackageEntry & { normalizedPath: string }>
  issues: MarketplacePackageIssue[]
}

export const DEFAULT_MARKETPLACE_PACKAGE_LIMITS: MarketplacePackageLimits = {
  maxFiles: 500,
  maxSingleFileBytes: 10 * 1024 * 1024,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 100,
}

const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules', '__MACOSX', '.cache'])
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function packageIssue(code: string, message: string, path?: string): MarketplacePackageIssue {
  return { code, message, ...(path ? { path } : {}) }
}

export function normalizeMarketplacePackagePath(path: string): string | undefined {
  if (!path || path.includes('\0')) return undefined
  const slashPath = path.replace(/\\/g, '/')
  if (slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath)) return undefined

  const segments = slashPath.split('/').filter((segment, index, all) => segment !== '' || index === all.length - 1)
  const normalized: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return undefined
    normalized.push(segment)
  }
  return normalized.join('/')
}

export function validateMarketplacePackageEntries(
  entries: MarketplacePackageEntry[],
  limits: MarketplacePackageLimits = DEFAULT_MARKETPLACE_PACKAGE_LIMITS,
): ValidateMarketplacePackageResult {
  const issues: MarketplacePackageIssue[] = []
  const normalizedEntries: ValidateMarketplacePackageResult['normalizedEntries'] = []
  const exactPaths = new Set<string>()
  const foldedPaths = new Map<string, string>()
  let fileCount = 0
  let totalUncompressedBytes = 0

  for (const entry of entries) {
    const normalizedPath = normalizeMarketplacePackagePath(entry.path)
    if (!normalizedPath) {
      issues.push(packageIssue('PACKAGE_PATH_UNSAFE', '包内路径包含绝对路径、盘符或目录穿越', entry.path))
      continue
    }

    const segments = normalizedPath.split('/')
    if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
      issues.push(packageIssue('PACKAGE_PATH_BLOCKED', '包内路径包含禁止目录', normalizedPath))
    }
    if (segments.some((segment) => WINDOWS_RESERVED_NAME.test(segment))) {
      issues.push(packageIssue('PACKAGE_WINDOWS_RESERVED_PATH', '包内路径包含 Windows 保留名称', normalizedPath))
    }
    if (entry.isSymbolicLink) {
      issues.push(packageIssue('PACKAGE_SYMLINK_UNSAFE', '市场 Skill 包不允许符号链接', normalizedPath))
    }

    if (exactPaths.has(normalizedPath)) {
      issues.push(packageIssue('PACKAGE_DUPLICATE_PATH', '包内存在重复路径', normalizedPath))
    }
    exactPaths.add(normalizedPath)

    const folded = normalizedPath.toLocaleLowerCase('en-US')
    const previousFoldedPath = foldedPaths.get(folded)
    if (previousFoldedPath && previousFoldedPath !== normalizedPath) {
      issues.push(packageIssue('PACKAGE_CASE_CONFLICT', `路径与 ${previousFoldedPath} 存在大小写冲突`, normalizedPath))
    }
    foldedPaths.set(folded, normalizedPath)

    if (!entry.isDirectory) {
      fileCount += 1
      totalUncompressedBytes += entry.uncompressedSize
      if (entry.uncompressedSize > limits.maxSingleFileBytes) {
        issues.push(packageIssue('PACKAGE_FILE_TOO_LARGE', '单个文件超过大小限制', normalizedPath))
      }
      const ratio = entry.compressedSize === 0
        ? (entry.uncompressedSize === 0 ? 1 : Number.POSITIVE_INFINITY)
        : entry.uncompressedSize / entry.compressedSize
      if (ratio > limits.maxCompressionRatio) {
        issues.push(packageIssue('PACKAGE_COMPRESSION_RATIO_EXCEEDED', '文件压缩比超过安全限制', normalizedPath))
      }
    }

    normalizedEntries.push({ ...entry, normalizedPath })
  }

  if (fileCount > limits.maxFiles) {
    issues.push(packageIssue('PACKAGE_FILE_COUNT_EXCEEDED', `文件数量超过 ${limits.maxFiles} 个`))
  }
  if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
    issues.push(packageIssue('PACKAGE_TOTAL_SIZE_EXCEEDED', '总解压体积超过安全限制'))
  }

  return { normalizedEntries, issues }
}
