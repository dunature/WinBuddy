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
import type { MarketplacePackageRecord, MarketplaceRepository } from './marketplace-repository.ts'

export interface MemoryMarketplaceData {
  categories: MarketplaceCategory[]
  skills: MarketplaceSkillDetail[]
  files: Record<string, { tree: MarketplaceFileNode[]; contents: MarketplaceFileContent[] }>
  examples: Record<string, MarketplaceExample[]>
  packages: MarketplacePackageRecord[]
}

export class MemoryMarketplaceRepository implements MarketplaceRepository {
  private readonly eventIds = new Set<string>()

  constructor(private readonly data: MemoryMarketplaceData) {}

  async listCategories(): Promise<MarketplaceCategory[]> {
    return [...this.data.categories].sort((left, right) => left.order - right.order)
  }

  async listSkills(params: Required<Pick<MarketplaceSearchParams, 'scope' | 'sort' | 'page' | 'pageSize'>> & MarketplaceSearchParams): Promise<MarketplacePaginatedResponse<MarketplaceSkillSummary>> {
    const query = params.query?.trim().toLocaleLowerCase() ?? ''
    const filtered = this.data.skills
      .filter((skill) => params.scope === 'all' || (params.scope === 'official') === skill.author.official)
      .filter((skill) => !params.category || skill.category.slug === params.category)
      .filter((skill) => !query || `${skill.displayName} ${skill.description} ${skill.author.handle} ${skill.tags.join(' ')}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => params.sort === 'recent'
        ? right.updatedAt.localeCompare(left.updatedAt)
        : right.installCount - left.installCount || left.slug.localeCompare(right.slug))
    const start = (params.page - 1) * params.pageSize
    return {
      items: filtered.slice(start, start + params.pageSize),
      page: params.page,
      pageSize: params.pageSize,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / params.pageSize),
    }
  }

  async getSkill(slug: string): Promise<MarketplaceSkillDetail | undefined> {
    return this.data.skills.find((skill) => skill.slug === slug)
  }

  async listFiles(slug: string, version: string): Promise<MarketplaceFileNode[] | undefined> {
    return this.data.files[`${slug}@${version}`]?.tree
  }

  async getFile(slug: string, version: string, path: string): Promise<MarketplaceFileContent | undefined> {
    return this.data.files[`${slug}@${version}`]?.contents.find((file) => file.path === path)
  }

  async listExamples(slug: string, version: string): Promise<MarketplaceExample[] | undefined> {
    return this.data.examples[`${slug}@${version}`]
  }

  async getPackage(slug: string, version: string): Promise<MarketplacePackageRecord | undefined> {
    return this.data.packages.find((item) => item.slug === slug && item.version === version)
  }

  async recordInstallEvent(input: MarketplaceInstallEventInput): Promise<boolean> {
    if (this.eventIds.has(input.eventId)) return false
    this.eventIds.add(input.eventId)
    return true
  }
}
