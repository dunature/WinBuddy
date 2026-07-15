import postgres from 'postgres'
import type {
  MarketplaceCategory,
  MarketplaceExample,
  MarketplaceFileContent,
  MarketplaceFileKind,
  MarketplaceFileNode,
  MarketplaceInstallEventInput,
  MarketplacePaginatedResponse,
  MarketplacePermissionSet,
  MarketplaceSearchParams,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
} from '@proma/shared'
import type { MarketplacePackageRecord, MarketplaceRepository } from './marketplace-repository.ts'

interface SkillRow {
  id: string
  slug: string
  display_name: string
  description: string
  install_count: number
  updated_at: Date
  author_id: string
  author_handle: string
  author_name: string
  author_official: boolean
  category_slug: string
  category_name: string
  category_description: string | null
  category_order: number
  version_id: string
  version: string
  guide_markdown: string
  changelog: string | null
  sha256: string
  package_size: number
  manifest: unknown
  published_at: Date | null
}

interface CountRow { count: number }
interface CategoryRow { slug: string; name: string; description: string | null; order_index: number }
interface FileRow { path: string; kind: MarketplaceFileKind; size: number; content: string | null; object_key: string | null }
interface ExampleRow { id: string; title: string; summary: string; featured: boolean; content: unknown }
interface PackageRow { skill_id: string; slug: string; version: string; sha256: string; package_size: number; object_key: string }

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function mapSkill(row: SkillRow): MarketplaceSkillDetail {
  const manifest = record(row.manifest)
  const permissionRecord = record(manifest.permissions)
  const filesystemRecord = record(permissionRecord.filesystem)
  const writePermission: MarketplacePermissionSet['filesystem']['write'] = filesystemRecord.write === 'workspace' || filesystemRecord.write === 'output-only'
    ? filesystemRecord.write
    : 'none'
  const permissions = {
    network: permissionRecord.network === true,
    filesystem: {
      read: filesystemRecord.read === true,
      write: writePermission,
    },
    shell: permissionRecord.shell === true,
  }
  const currentVersion: MarketplaceSkillDetail['currentVersion'] = {
    id: row.version_id,
    version: row.version,
    status: 'published',
    ...(row.changelog ? { changelog: row.changelog } : {}),
    sha256: row.sha256,
    packageSize: Number(row.package_size),
    permissions,
    ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}),
  }
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    author: { id: row.author_id, handle: row.author_handle, name: row.author_name, official: row.author_official },
    category: { slug: row.category_slug, name: row.category_name, ...(row.category_description ? { description: row.category_description } : {}), order: row.category_order },
    tags: stringArray(manifest.tags),
    version: row.version,
    installCount: Number(row.install_count),
    updatedAt: row.updated_at.toISOString(),
    guideMarkdown: row.guide_markdown,
    currentVersion,
    versions: [currentVersion],
    triggerKeywords: stringArray(manifest.trigger_keywords),
    ...(typeof manifest.repository === 'string' ? { repository: manifest.repository } : {}),
    ...(typeof manifest.homepage === 'string' ? { homepage: manifest.homepage } : {}),
  }
}

const PUBLIC_SKILL_SELECT = `
  SELECT s.id, s.slug, s.display_name, s.description, s.install_count, s.updated_at,
    a.id AS author_id, a.handle AS author_handle, a.name AS author_name, a.official AS author_official,
    c.slug AS category_slug, c.name AS category_name, c.description AS category_description, c.order_index AS category_order,
    v.id AS version_id, v.version, v.guide_markdown, v.changelog, v.sha256, v.package_size, v.manifest, v.published_at
  FROM marketplace_skills s
  JOIN marketplace_authors a ON a.id = s.author_id
  JOIN marketplace_categories c ON c.slug = s.category_slug
  JOIN marketplace_versions v ON v.id = s.latest_published_version_id
  WHERE v.status = 'published'`

export class PostgresMarketplaceRepository implements MarketplaceRepository {
  private readonly sql: postgres.Sql

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl)
  }

  async listCategories(): Promise<MarketplaceCategory[]> {
    const rows = await this.sql<CategoryRow[]>`SELECT slug, name, description, order_index FROM marketplace_categories ORDER BY order_index`
    return rows.map((row) => ({ slug: row.slug, name: row.name, ...(row.description ? { description: row.description } : {}), order: row.order_index }))
  }

  async listSkills(params: Required<Pick<MarketplaceSearchParams, 'scope' | 'sort' | 'page' | 'pageSize'>> & MarketplaceSearchParams): Promise<MarketplacePaginatedResponse<MarketplaceSkillSummary>> {
    const scopeOfficial = params.scope === 'official' ? true : params.scope === 'community' ? false : undefined
    const query = params.query?.trim() ? `%${params.query.trim()}%` : undefined
    const offset = (params.page - 1) * params.pageSize
    const filters = this.sql`
      ${scopeOfficial === undefined ? this.sql`` : this.sql`AND a.official = ${scopeOfficial}`}
      ${params.category ? this.sql`AND c.slug = ${params.category}` : this.sql``}
      ${query ? this.sql`AND (s.display_name ILIKE ${query} OR s.description ILIKE ${query} OR a.handle ILIKE ${query})` : this.sql``}
    `
    const rows = await this.sql<SkillRow[]>`${this.sql.unsafe(PUBLIC_SKILL_SELECT)} ${filters}
      ORDER BY ${params.sort === 'recent' ? this.sql`s.updated_at DESC` : this.sql`s.install_count DESC, s.slug ASC`}
      LIMIT ${params.pageSize} OFFSET ${offset}`
    const counts = await this.sql<CountRow[]>`SELECT count(*)::int AS count FROM marketplace_skills s
      JOIN marketplace_authors a ON a.id = s.author_id
      JOIN marketplace_categories c ON c.slug = s.category_slug
      JOIN marketplace_versions v ON v.id = s.latest_published_version_id
      WHERE v.status = 'published' ${filters}`
    const total = counts[0]?.count ?? 0
    return { items: rows.map(mapSkill), page: params.page, pageSize: params.pageSize, total, totalPages: Math.ceil(total / params.pageSize) }
  }

  async getSkill(slug: string): Promise<MarketplaceSkillDetail | undefined> {
    const rows = await this.sql<SkillRow[]>`${this.sql.unsafe(PUBLIC_SKILL_SELECT)} AND s.slug = ${slug} LIMIT 1`
    return rows[0] ? mapSkill(rows[0]) : undefined
  }

  async listFiles(slug: string, version: string): Promise<MarketplaceFileNode[] | undefined> {
    const rows = await this.fileRows(slug, version)
    return rows ? buildFileTree(rows) : undefined
  }

  async getFile(slug: string, version: string, path: string): Promise<MarketplaceFileContent | undefined> {
    const rows = await this.fileRows(slug, version)
    const row = rows?.find((item) => item.path === path)
    if (!row || row.kind === 'directory') return undefined
    return { path: row.path, kind: row.kind, size: Number(row.size), ...(row.content ? { content: row.content } : {}), truncated: false }
  }

  async listExamples(slug: string, version: string): Promise<MarketplaceExample[] | undefined> {
    const rows = await this.sql<ExampleRow[]>`SELECT e.id, e.title, e.summary, e.featured, e.content
      FROM marketplace_examples e JOIN marketplace_versions v ON v.id = e.version_id JOIN marketplace_skills s ON s.id = v.skill_id
      WHERE s.slug = ${slug} AND v.version = ${version} AND v.status = 'published'
        AND s.latest_published_version_id = v.id ORDER BY e.featured DESC, e.title`
    if (rows.length === 0 && !await this.versionExists(slug, version)) return undefined
    return rows.map((row) => {
      const content = record(row.content)
      return {
        id: row.id,
        title: row.title,
        summary: row.summary,
        featured: row.featured,
        userRequest: typeof content.userRequest === 'string' ? content.userRequest : '',
        steps: Array.isArray(content.steps) ? content.steps.filter(isExampleStep) : [],
        finalOutputMarkdown: typeof content.finalOutputMarkdown === 'string' ? content.finalOutputMarkdown : '',
        assetUrls: stringArray(content.assetUrls),
      }
    })
  }

  async getPackage(slug: string, version: string): Promise<MarketplacePackageRecord | undefined> {
    const rows = await this.sql<PackageRow[]>`SELECT s.id AS skill_id, s.slug, v.version, v.sha256, v.package_size, v.object_key
      FROM marketplace_versions v JOIN marketplace_skills s ON s.id = v.skill_id
      WHERE s.slug = ${slug} AND v.version = ${version} AND v.status = 'published' AND s.latest_published_version_id = v.id LIMIT 1`
    const row = rows[0]
    return row ? { skillId: row.skill_id, slug: row.slug, version: row.version, sha256: row.sha256, size: Number(row.package_size), objectKey: row.object_key } : undefined
  }

  async recordInstallEvent(input: MarketplaceInstallEventInput): Promise<boolean> {
    const rows = await this.sql<{ event_id: string }[]>`INSERT INTO marketplace_install_events
      (event_id, skill_id, version, platform, app_version, installed_at)
      VALUES (${input.eventId}, ${input.skillId}, ${input.version}, ${input.platform}, ${input.appVersion}, ${input.installedAt})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`
    if (rows.length > 0) await this.sql`UPDATE marketplace_skills SET install_count = install_count + 1 WHERE id = ${input.skillId}`
    return rows.length > 0
  }

  private async fileRows(slug: string, version: string): Promise<FileRow[] | undefined> {
    const rows = await this.sql<FileRow[]>`SELECT f.path, f.kind, f.size, f.content, f.object_key
      FROM marketplace_files f JOIN marketplace_versions v ON v.id = f.version_id JOIN marketplace_skills s ON s.id = v.skill_id
      WHERE s.slug = ${slug} AND v.version = ${version} AND v.status = 'published'
        AND s.latest_published_version_id = v.id ORDER BY f.path`
    if (rows.length === 0 && !await this.versionExists(slug, version)) return undefined
    return [...rows]
  }

  private async versionExists(slug: string, version: string): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`SELECT EXISTS(
      SELECT 1 FROM marketplace_versions v JOIN marketplace_skills s ON s.id = v.skill_id
      WHERE s.slug = ${slug} AND v.version = ${version} AND v.status = 'published'
        AND s.latest_published_version_id = v.id
    ) AS exists`
    return rows[0]?.exists === true
  }
}

function isExampleStep(value: unknown): value is MarketplaceExample['steps'][number] {
  const item = record(value)
  return typeof item.title === 'string' && typeof item.summary === 'string'
}

function buildFileTree(rows: FileRow[]): MarketplaceFileNode[] {
  const roots: MarketplaceFileNode[] = []
  const directories = new Map<string, MarketplaceFileNode>()
  for (const row of rows) {
    const parts = row.path.split('/')
    let parent = roots
    let currentPath = ''
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLeaf = index === parts.length - 1
      if (isLeaf) {
        parent.push({ path: row.path, name: part, kind: row.kind, size: Number(row.size) })
        return
      }
      let directory = directories.get(currentPath)
      if (!directory) {
        directory = { path: currentPath, name: part, kind: 'directory', children: [] }
        directories.set(currentPath, directory)
        parent.push(directory)
      }
      parent = directory.children ?? []
    })
  }
  return roots
}
