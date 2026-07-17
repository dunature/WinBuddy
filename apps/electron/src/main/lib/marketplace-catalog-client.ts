import type {
  MarketplaceCategory,
  MarketplaceFileNode,
  MarketplaceListQuery,
  MarketplacePage,
  MarketplaceSkillDetail,
  MarketplaceSkillFile,
  MarketplaceSkillSummary,
  MarketplaceVersionSummary,
} from '@proma/shared'

export interface MarketplaceCatalogClient {
  listCategories(): Promise<MarketplaceCategory[]>
  listSkills(query: MarketplaceListQuery): Promise<MarketplacePage<MarketplaceSkillSummary>>
  getSkill(identifier: string): Promise<MarketplaceSkillDetail>
  getSkillFile(identifier: string, version: string, path: string): Promise<MarketplaceSkillFile>
}

interface FixtureVersion extends MarketplaceVersionSummary {
  contents: Record<string, string>
}

interface FixtureSkill extends Omit<MarketplaceSkillDetail, 'versions'> {
  versions: FixtureVersion[]
}

const categories: MarketplaceCategory[] = [
  { id: 'research', name: '研究分析', icon: 'search' },
  { id: 'docs', name: '文档创作', icon: 'file-text' },
  { id: 'coding', name: '开发工具', icon: 'code' },
]

function file(path: string, size: number): MarketplaceFileNode {
  return { path, name: path.split('/').at(-1) ?? path, type: 'file', size }
}

function directory(path: string, children: MarketplaceFileNode[]): MarketplaceFileNode {
  return { path, name: path.split('/').at(-1) ?? path, type: 'directory', size: 0, children }
}

function version(
  value: string,
  publishedAt: string,
  changelog: string,
  skillMd: string,
): FixtureVersion {
  const files = [
    file('SKILL.md', new TextEncoder().encode(skillMd).byteLength),
    directory('references', [file('references/guide.md', 248)]),
  ]
  return {
    version: value,
    changelog,
    sha256: `sha256:${value.replaceAll('.', '').padEnd(64, '0')}`,
    size: 42_000,
    fileCount: 2,
    publishedAt,
    files,
    contents: {
      'SKILL.md': skillMd,
      'references/guide.md': '# 使用指南\n\n这是用于市场只读预览的示例资源。',
    },
  }
}

const fixtureSkills: FixtureSkill[] = [
  {
    id: 'skill-deep-research',
    identifier: 'deep-research',
    name: '深度研究助手',
    tagline: '从多来源收集证据并生成带引用的研究报告',
    description: '面向行业、公司和专题研究的完整工作流，强调来源边界与可追溯引用。',
    authorName: 'Proma Labs',
    authorUrl: 'https://www.feiyangclaw.com',
    category: 'research',
    tags: ['研究', '报告', '引用'],
    icon: 'search',
    featured: true,
    installs: 28_936,
    latestVersion: '1.2.0',
    updatedAt: '2026-07-16T08:00:00.000Z',
    versions: [
      version('1.2.0', '2026-07-16T08:00:00.000Z', '改进引用校验与来源索引。', '# Deep Research\n\n生成可追溯、带引用的深度研究报告。'),
      version('1.1.0', '2026-06-28T08:00:00.000Z', '增加中文研究模板。', '# Deep Research\n\n生成结构化研究报告。'),
    ],
  },
  {
    id: 'skill-market-intelligence',
    identifier: 'market-intelligence',
    name: '市场情报雷达',
    tagline: '持续整理行业动态、竞争格局与关键事件',
    description: '将公开信息整理为可复用的市场情报卡片。',
    authorName: 'Proma Community',
    category: 'research',
    tags: ['行业', '情报'],
    icon: 'radar',
    featured: true,
    installs: 11_823,
    latestVersion: '1.0.0',
    updatedAt: '2026-07-10T08:00:00.000Z',
    versions: [version('1.0.0', '2026-07-10T08:00:00.000Z', '首个公开版本。', '# Market Intelligence\n\n整理市场与竞争情报。')],
  },
  {
    id: 'skill-slides-studio',
    identifier: 'slides-studio',
    name: '演示文稿工作室',
    tagline: '把内容快速组织成清晰、美观的演示文稿',
    description: '提供大纲、版式和演讲叙事建议。',
    authorName: 'Proma Labs',
    category: 'docs',
    tags: ['PPT', '演示'],
    icon: 'presentation',
    featured: true,
    installs: 23_876,
    latestVersion: '2.0.1',
    updatedAt: '2026-07-12T08:00:00.000Z',
    versions: [version('2.0.1', '2026-07-12T08:00:00.000Z', '优化演示结构。', '# Slides Studio\n\n创建清晰的演示文稿。')],
  },
  {
    id: 'skill-code-review',
    identifier: 'code-review',
    name: '代码审查助手',
    tagline: '聚焦正确性、安全性和可维护性的代码审查',
    description: '输出按优先级排序、可操作的审查意见。',
    authorName: 'Proma Community',
    category: 'coding',
    tags: ['Review', '质量'],
    icon: 'git-pull-request',
    featured: false,
    installs: 15_220,
    latestVersion: '1.4.0',
    updatedAt: '2026-07-14T08:00:00.000Z',
    versions: [version('1.4.0', '2026-07-14T08:00:00.000Z', '增加安全检查清单。', '# Code Review\n\n审查代码正确性与安全风险。')],
  },
]

function publicVersion(version: FixtureVersion): MarketplaceVersionSummary {
  const { contents: _contents, ...summary } = version
  return summary
}

function publicSkill(skill: FixtureSkill): MarketplaceSkillDetail {
  return {
    ...skill,
    versions: skill.versions.map(publicVersion),
  }
}

class FixtureMarketplaceCatalogClient implements MarketplaceCatalogClient {
  async listCategories(): Promise<MarketplaceCategory[]> {
    return categories.map((category) => ({ ...category }))
  }

  async listSkills(query: MarketplaceListQuery): Promise<MarketplacePage<MarketplaceSkillSummary>> {
    const needle = query.query?.trim().toLocaleLowerCase()
    const filtered = fixtureSkills
      .filter((skill) => !needle || [skill.name, skill.identifier, skill.tagline].some((value) => value.toLocaleLowerCase().includes(needle)))
      .filter((skill) => !query.category || skill.category === query.category)
      .filter((skill) => query.featured !== true || skill.featured)
      .sort((left, right) => query.sort === 'latest'
        ? right.updatedAt.localeCompare(left.updatedAt)
        : right.installs - left.installs)

    const pageSize = Math.min(50, Math.max(1, query.pageSize))
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const page = Math.min(pages, Math.max(1, query.page))
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize).map(({ description: _description, authorUrl: _authorUrl, versions: _versions, ...summary }) => summary)

    return {
      items,
      page: { number: page, size: pageSize, total: filtered.length, pages },
    }
  }

  async getSkill(identifier: string): Promise<MarketplaceSkillDetail> {
    const skill = fixtureSkills.find((item) => item.identifier === identifier)
    if (!skill) throw new Error(`技能不存在: ${identifier}`)
    return publicSkill(skill)
  }

  async getSkillFile(identifier: string, versionValue: string, path: string): Promise<MarketplaceSkillFile> {
    const skill = fixtureSkills.find((item) => item.identifier === identifier)
    const selectedVersion = skill?.versions.find((item) => item.version === versionValue)
    const content = selectedVersion?.contents[path]
    if (!skill || !selectedVersion || content === undefined) {
      throw new Error(`技能文件不存在: ${identifier}@${versionValue}/${path}`)
    }
    const size = new TextEncoder().encode(content).byteLength
    if (size > 1024 * 1024) throw new Error('文本文件超过 1 MB，无法预览')
    return { path, size, content, isText: true }
  }
}

class UnavailableMarketplaceCatalogClient implements MarketplaceCatalogClient {
  private unavailable(): never {
    throw new Error('技能市场服务暂不可用，请稍后重试')
  }

  async listCategories(): Promise<MarketplaceCategory[]> { return this.unavailable() }
  async listSkills(_query: MarketplaceListQuery): Promise<MarketplacePage<MarketplaceSkillSummary>> { return this.unavailable() }
  async getSkill(_identifier: string): Promise<MarketplaceSkillDetail> { return this.unavailable() }
  async getSkillFile(_identifier: string, _version: string, _path: string): Promise<MarketplaceSkillFile> { return this.unavailable() }
}

export function createFixtureMarketplaceCatalogClient(): MarketplaceCatalogClient {
  return new FixtureMarketplaceCatalogClient()
}

export interface MarketplaceCatalogClientOptions {
  enableFixture?: boolean
}

export function createMarketplaceCatalogClient(options: MarketplaceCatalogClientOptions = {}): MarketplaceCatalogClient {
  const fixtureEnabled = options.enableFixture
    ?? (process.env.PROMA_MARKETPLACE_FIXTURE === '1' || process.env.NODE_ENV === 'test')
  return fixtureEnabled ? createFixtureMarketplaceCatalogClient() : new UnavailableMarketplaceCatalogClient()
}
