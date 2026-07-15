import type {
  MarketplaceErrorCode,
  MarketplacePermissionSet,
  MarketplaceSkillVersion,
} from './marketplace'

export interface MarketplaceSkillSource {
  schemaVersion: 1
  sourceType: 'marketplace'
  marketplaceSkillId: string
  slug: string
  version: string
  sha256: string
  installedAt: string
}

export interface MarketplaceCreateInstallInput {
  skillId: string
  slug: string
  version: string
  workspaceSlug: string
}

export interface MarketplaceCreateInstallResult {
  installId: string
  skillId: string
  slug: string
  version: string
  workspaceSlug: string
}

export interface MarketplaceInstallConflict {
  kind: 'unmanaged' | 'locally-modified' | 'downgrade' | 'different-source'
  slug: string
  localVersion?: string
  marketplaceVersion: string
  changedFiles: string[]
  localSource?: MarketplaceSkillSource
}

export interface MarketplaceInstallError {
  code: MarketplaceErrorCode
  message: string
  retryable: boolean
  requestId?: string
}

export type MarketplaceInstallVerificationStep = 'hash' | 'package' | 'manifest'

export type MarketplaceInstallState =
  | { status: 'idle'; installId: string }
  | { status: 'downloading'; installId: string; received: number; total?: number }
  | { status: 'verifying'; installId: string; step: MarketplaceInstallVerificationStep }
  | { status: 'conflict'; installId: string; conflict: MarketplaceInstallConflict }
  | { status: 'committing'; installId: string }
  | { status: 'success'; installId: string; slug: string; version: string; workspaceSlug: string }
  | { status: 'error'; installId: string; error: MarketplaceInstallError }
  | { status: 'cancelled'; installId: string }

export interface MarketplaceStartInstallInput {
  installId: string
}

export interface MarketplaceCancelInstallInput {
  installId: string
}

export interface MarketplaceResolveConflictInput {
  installId: string
  resolution: 'cancel' | 'backup-and-replace'
}

export interface MarketplaceInstalledSourceInput {
  workspaceSlug: string
  skillSlug: string
}

export interface MarketplaceCheckUpdatesInput {
  workspaceSlug: string
}

export interface MarketplaceAvailableUpdate {
  slug: string
  currentVersion: string
  latestVersion: MarketplaceSkillVersion
  permissionsAdded: Array<keyof MarketplacePermissionSet | 'filesystem.write'>
}

export const MARKETPLACE_IPC_CHANNELS = {
  CREATE_INSTALL: 'marketplace:create-install-session',
  START_INSTALL: 'marketplace:start-install',
  CANCEL_INSTALL: 'marketplace:cancel-install',
  RESOLVE_CONFLICT: 'marketplace:resolve-conflict',
  INSTALL_PROGRESS: 'marketplace:install-progress',
  GET_INSTALLED_SOURCE: 'marketplace:get-installed-source',
  CHECK_UPDATES: 'marketplace:check-updates',
} as const

export type MarketplaceIpcChannel = (typeof MARKETPLACE_IPC_CHANNELS)[keyof typeof MARKETPLACE_IPC_CHANNELS]
