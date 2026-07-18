/** 技能市场分类。 */
export interface MarketplaceCategory {
  id: string
  name: string
  icon: string
}

export type MarketplaceSort = 'hot' | 'latest'

export interface MarketplaceListQuery {
  query?: string
  category?: string
  featured?: boolean
  sort: MarketplaceSort
  page: number
  pageSize: number
}

export interface MarketplacePageInfo {
  number: number
  size: number
  total: number
  pages: number
}

export interface MarketplacePage<T> {
  items: T[]
  page: MarketplacePageInfo
}

export interface MarketplaceApiSuccess<T> {
  data: T
  requestId: string
}

export interface MarketplaceApiPage<T> {
  data: T[]
  page: MarketplacePageInfo
  requestId: string
}

export interface MarketplaceApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
  requestId: string
}

export interface MarketplaceSkillSummary {
  id: string
  identifier: string
  name: string
  tagline: string
  authorName: string
  category: string
  tags: string[]
  icon: string
  featured: boolean
  installs: number
  latestVersion: string
  updatedAt: string
}

export interface MarketplaceFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  children?: MarketplaceFileNode[]
}

export interface MarketplaceVersionSummary {
  version: string
  changelog: string
  sha256: string
  size: number
  fileCount: number
  publishedAt: string
  files: MarketplaceFileNode[]
}

export interface MarketplaceSkillDetail extends MarketplaceSkillSummary {
  description: string
  authorUrl?: string
  versions: MarketplaceVersionSummary[]
}

export interface MarketplaceSkillFile {
  path: string
  size: number
  content?: string
  isText: boolean
}

export interface MarketplaceInstallManifest {
  marketplaceSkillId: string
  identifier: string
  version: string
  sha256: string
  size: number
  fileCount: number
  files: MarketplaceFileNode[]
  downloadUrl?: string
}

export interface MarketplaceAdminIdentity {
  username: string
  mustChangePassword: boolean
}

export interface MarketplaceAdminSession {
  admin: MarketplaceAdminIdentity
  csrfToken: string
}

export type MarketplaceSkillStatus = 'draft' | 'published' | 'unpublished' | 'archived'
export type MarketplaceVersionStatus =
  | 'created'
  | 'validation_failed'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'unpublished'
  | 'archived'

export interface MarketplaceAdminVersion {
  id: string
  skillId: string
  version: string
  changelog: string
  status: MarketplaceVersionStatus
  revision: number
  createdAt: string
  updatedAt: string
}

export interface MarketplaceAdminSkillSummary {
  id: string
  identifier: string
  name: string
  tagline: string
  description: string
  authorName: string
  authorUrl?: string
  categoryId: string
  tags: string[]
  icon: string
  featured: boolean
  status: MarketplaceSkillStatus
  currentPublishedVersionId: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface MarketplaceAdminSkillDetail extends MarketplaceAdminSkillSummary {
  versions: MarketplaceAdminVersion[]
}

export const MARKETPLACE_IPC_CHANNELS = {
  LIST_CATEGORIES: 'marketplace:list-categories',
  LIST_SKILLS: 'marketplace:list-skills',
  GET_SKILL: 'marketplace:get-skill',
  GET_SKILL_FILE: 'marketplace:get-skill-file',
} as const
