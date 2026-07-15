import type {
  MarketplaceCategory,
  MarketplaceExample,
  MarketplaceFileContent,
  MarketplaceFileNode,
  MarketplaceInstallEventInput,
  MarketplacePaginatedResponse,
  MarketplaceSearchParams,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
} from '@proma/shared'

export interface MarketplacePackageRecord {
  skillId: string
  slug: string
  version: string
  sha256: string
  size: number
  objectKey: string
}

export interface MarketplaceRepository {
  listCategories(): Promise<MarketplaceCategory[]>
  listSkills(params: Required<Pick<MarketplaceSearchParams, 'scope' | 'sort' | 'page' | 'pageSize'>> & MarketplaceSearchParams): Promise<MarketplacePaginatedResponse<MarketplaceSkillSummary>>
  getSkill(slug: string): Promise<MarketplaceSkillDetail | undefined>
  listFiles(slug: string, version: string): Promise<MarketplaceFileNode[] | undefined>
  getFile(slug: string, version: string, path: string): Promise<MarketplaceFileContent | undefined>
  listExamples(slug: string, version: string): Promise<MarketplaceExample[] | undefined>
  getPackage(slug: string, version: string): Promise<MarketplacePackageRecord | undefined>
  recordInstallEvent(input: MarketplaceInstallEventInput): Promise<boolean>
}
