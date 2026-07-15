export type MarketplaceScope = 'all' | 'official' | 'community'
export type MarketplaceSort = 'popular' | 'recent'
export type MarketplaceSkillStatus = 'draft' | 'validating' | 'pending_review' | 'published' | 'rejected' | 'unlisted' | 'archived'
export type MarketplaceFileKind = 'directory' | 'markdown' | 'text' | 'code' | 'json' | 'yaml' | 'image' | 'binary'

export interface MarketplaceApiError {
  code: MarketplaceErrorCode
  message: string
  requestId: string
  details?: Record<string, unknown>
}

export type MarketplaceErrorCode =
  | 'MARKETPLACE_OFFLINE'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_UNAVAILABLE'
  | 'PACKAGE_DOWNLOAD_FAILED'
  | 'PACKAGE_TOO_LARGE'
  | 'PACKAGE_HASH_MISMATCH'
  | 'PACKAGE_INVALID'
  | 'PACKAGE_UNSAFE'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_PERMISSION_DENIED'
  | 'LOCAL_SKILL_CONFLICT'
  | 'INSTALL_CANCELLED'
  | 'INSTALL_COMMIT_FAILED'
  | 'VALIDATION_FAILED'
  | 'VERSION_ALREADY_EXISTS'
  | 'INTERNAL_ERROR'

export interface MarketplaceAuthor {
  id: string
  handle: string
  name: string
  official: boolean
}

export interface MarketplaceCategory {
  slug: string
  name: string
  description?: string
  order: number
}

export interface MarketplacePermissionSet {
  network: boolean
  filesystem: {
    read: boolean
    write: 'none' | 'output-only' | 'workspace'
  }
  shell: boolean
}

export interface MarketplaceSkillVersion {
  id: string
  version: string
  status: MarketplaceSkillStatus
  changelog?: string
  sha256: string
  packageSize: number
  permissions: MarketplacePermissionSet
  publishedAt?: string
}

export interface MarketplaceSkillSummary {
  id: string
  slug: string
  displayName: string
  description: string
  iconUrl?: string
  author: MarketplaceAuthor
  category: MarketplaceCategory
  tags: string[]
  version: string
  installCount: number
  updatedAt: string
}

export interface MarketplaceSkillDetail extends MarketplaceSkillSummary {
  guideMarkdown: string
  currentVersion: MarketplaceSkillVersion
  versions: MarketplaceSkillVersion[]
  triggerKeywords: string[]
  repository?: string
  homepage?: string
}

export interface MarketplaceFileNode {
  path: string
  name: string
  kind: MarketplaceFileKind
  size?: number
  children?: MarketplaceFileNode[]
}

export interface MarketplaceFileContent {
  path: string
  kind: Exclude<MarketplaceFileKind, 'directory'>
  size: number
  content?: string
  assetUrl?: string
  truncated: boolean
}

export interface MarketplaceExampleStep {
  title: string
  summary: string
  toolName?: string
  durationMs?: number
}

export interface MarketplaceExample {
  id: string
  title: string
  summary: string
  featured: boolean
  userRequest: string
  steps: MarketplaceExampleStep[]
  finalOutputMarkdown: string
  assetUrls: string[]
}

export interface MarketplaceSearchParams {
  query?: string
  scope?: MarketplaceScope
  category?: string
  sort?: MarketplaceSort
  page?: number
  pageSize?: number
}

export interface MarketplacePaginatedResponse<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface MarketplacePackageDownload {
  skillId: string
  slug: string
  version: string
  sha256: string
  size: number
  downloadUrl: string
  expiresAt: string
}

export interface MarketplaceInstallEventInput {
  eventId: string
  skillId: string
  version: string
  installedAt: string
  platform: 'darwin' | 'win32' | 'linux'
  appVersion: string
}
