export const MARKETPLACE_CATEGORIES = [
  'research',
  'productivity',
  'content',
  'design',
  'data-ai',
  'devops',
  'writing',
] as const

export type MarketplaceCategorySlug = (typeof MARKETPLACE_CATEGORIES)[number]

export interface SkillManifestAuthor {
  handle: string
  name: string
}

export interface SkillManifestFilesystemPermission {
  read: boolean
  write: 'none' | 'output-only' | 'workspace'
}

export interface SkillManifestPermissions {
  network: boolean
  filesystem: SkillManifestFilesystemPermission
  shell: boolean
}

export interface SkillManifestCompatibility {
  proma?: string
}

export interface SkillManifestDependency {
  name: string
  version: string
}

export interface SkillManifestDependencies {
  skills?: SkillManifestDependency[]
}

export interface SkillManifestV1 {
  schema_version: 1
  name: string
  display_name: string
  description: string
  version: string
  author: SkillManifestAuthor
  category: MarketplaceCategorySlug
  license: string
  permissions: SkillManifestPermissions
  tags?: string[]
  icon?: string
  trigger_keywords?: string[]
  homepage?: string
  repository?: string
  documentation?: string
  compatibility?: SkillManifestCompatibility
  dependencies?: SkillManifestDependencies
  deprecated?: boolean
  replacement?: string
}

export type ManifestIssueSeverity = 'error' | 'warning'

export interface ManifestIssue {
  code: string
  message: string
  severity: ManifestIssueSeverity
  path?: string
  line?: number
  column?: number
}

export interface ParseManifestResult {
  manifest?: SkillManifestV1
  body: string
  issues: ManifestIssue[]
}
