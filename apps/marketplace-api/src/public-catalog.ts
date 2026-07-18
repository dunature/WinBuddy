import { and, count, desc, eq, ilike, inArray, isNotNull, or, type SQL } from 'drizzle-orm'
import { buildMarketplaceFileTree, normalizeMarketplacePagination } from '@proma/marketplace-domain'
import type {
  MarketplaceCategory,
  MarketplaceInstallManifest,
  MarketplaceListQuery,
  MarketplaceSkillFile,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  MarketplaceVersionSummary,
} from '@proma/shared'
import type { MarketplaceDatabase } from './database/client'
import { categories, skills, skillVersions, versionFiles } from './database/schema'

export interface PublicSkillList {
  items: MarketplaceSkillSummary[]
  page: {
    number: number
    size: number
    total: number
    pages: number
  }
}

function publicSkillConditions(query: Partial<MarketplaceListQuery>): SQL[] {
  const conditions: SQL[] = [
    eq(skills.status, 'published'),
    isNotNull(skills.currentPublishedVersionId),
    eq(skillVersions.id, skills.currentPublishedVersionId),
  ]
  const needle = query.query?.trim()
  if (needle) {
    const search = or(
      ilike(skills.name, `%${needle}%`),
      ilike(skills.identifier, `%${needle}%`),
      ilike(skills.tagline, `%${needle}%`),
    )
    if (search) conditions.push(search)
  }
  if (query.category) conditions.push(eq(skills.categoryId, query.category))
  if (query.featured === true) conditions.push(eq(skills.featured, true))
  return conditions
}

export async function listPublicCategories(database: MarketplaceDatabase): Promise<MarketplaceCategory[]> {
  return database.db
    .select({ id: categories.id, name: categories.name, icon: categories.icon })
    .from(categories)
    .orderBy(categories.name)
}

export async function listPublicSkills(
  database: MarketplaceDatabase,
  query: Partial<MarketplaceListQuery>,
): Promise<PublicSkillList> {
  const pagination = normalizeMarketplacePagination({ page: query.page, pageSize: query.pageSize })
  const conditions = publicSkillConditions(query)
  const where = and(...conditions)
  const order = query.sort === 'latest'
    ? [desc(skillVersions.publishedAt), desc(skills.identifier)]
    : [desc(skills.installs), desc(skills.identifier)]

  const [rows, totals] = await Promise.all([
    database.db
      .select({
        id: skills.id,
        identifier: skills.identifier,
        name: skills.name,
        tagline: skills.tagline,
        authorName: skills.authorName,
        category: skills.categoryId,
        tags: skills.tags,
        icon: skills.icon,
        featured: skills.featured,
        installs: skills.installs,
        latestVersion: skillVersions.version,
        updatedAt: skillVersions.publishedAt,
      })
      .from(skills)
      .innerJoin(skillVersions, eq(skillVersions.id, skills.currentPublishedVersionId))
      .where(where)
      .orderBy(...order)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize),
    database.db
      .select({ total: count() })
      .from(skills)
      .innerJoin(skillVersions, eq(skillVersions.id, skills.currentPublishedVersionId))
      .where(where),
  ])

  const total = totals[0]?.total ?? 0
  return {
    items: rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt?.toISOString() ?? '',
    })),
    page: {
      number: pagination.page,
      size: pagination.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
  }
}

export async function listPublicVersions(
  database: MarketplaceDatabase,
  skillId: string,
): Promise<MarketplaceVersionSummary[]> {
  const rows = await database.db
    .select({
      id: skillVersions.id,
      version: skillVersions.version,
      changelog: skillVersions.changelog,
      sha256: skillVersions.sha256,
      size: skillVersions.size,
      fileCount: skillVersions.fileCount,
      publishedAt: skillVersions.publishedAt,
    })
    .from(skillVersions)
    .where(and(
      eq(skillVersions.skillId, skillId),
      isNotNull(skillVersions.publishedAt),
      inArray(skillVersions.status, ['published', 'unpublished']),
    ))
    .orderBy(desc(skillVersions.publishedAt))

  const storedFiles = rows.length === 0
    ? []
    : await database.db
      .select({ versionId: versionFiles.versionId, path: versionFiles.path, size: versionFiles.size })
      .from(versionFiles)
      .where(inArray(versionFiles.versionId, rows.map((row) => row.id)))

  return rows.map((row) => ({
    version: row.version,
    changelog: row.changelog,
    sha256: row.sha256,
    size: row.size,
    fileCount: row.fileCount,
    publishedAt: row.publishedAt?.toISOString() ?? '',
    files: buildMarketplaceFileTree(storedFiles.filter((file) => file.versionId === row.id)),
  }))
}

export async function getPublicSkill(
  database: MarketplaceDatabase,
  identifier: string,
): Promise<MarketplaceSkillDetail | null> {
  const rows = await database.db
    .select({
      id: skills.id,
      identifier: skills.identifier,
      name: skills.name,
      tagline: skills.tagline,
      description: skills.description,
      authorName: skills.authorName,
      authorUrl: skills.authorUrl,
      category: skills.categoryId,
      tags: skills.tags,
      icon: skills.icon,
      featured: skills.featured,
      installs: skills.installs,
      latestVersion: skillVersions.version,
      updatedAt: skillVersions.publishedAt,
    })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.currentPublishedVersionId))
    .where(and(
      eq(skills.identifier, identifier),
      eq(skills.status, 'published'),
      isNotNull(skills.currentPublishedVersionId),
    ))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    authorName: row.authorName,
    ...(row.authorUrl ? { authorUrl: row.authorUrl } : {}),
    category: row.category,
    tags: row.tags,
    icon: row.icon,
    featured: row.featured,
    installs: row.installs,
    latestVersion: row.latestVersion,
    updatedAt: row.updatedAt?.toISOString() ?? '',
    versions: await listPublicVersions(database, row.id),
  }
}

interface PublicVersionRecord {
  skillId: string
  identifier: string
  versionId: string
  version: string
  sha256: string
  size: number
  fileCount: number
}

async function getPublicVersionRecord(
  database: MarketplaceDatabase,
  selector: { identifier: string } | { skillId: string },
  version: string,
): Promise<PublicVersionRecord | null> {
  const rows = await database.db
    .select({
      skillId: skills.id,
      identifier: skills.identifier,
      versionId: skillVersions.id,
      version: skillVersions.version,
      sha256: skillVersions.sha256,
      size: skillVersions.size,
      fileCount: skillVersions.fileCount,
    })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.skillId, skills.id))
    .where(and(
      'identifier' in selector ? eq(skills.identifier, selector.identifier) : eq(skills.id, selector.skillId),
      eq(skills.status, 'published'),
      isNotNull(skills.currentPublishedVersionId),
      eq(skillVersions.version, version),
      isNotNull(skillVersions.publishedAt),
      inArray(skillVersions.status, ['published', 'unpublished']),
    ))
    .limit(1)
  return rows[0] ?? null
}

export async function getPublicSkillFile(
  database: MarketplaceDatabase,
  identifier: string,
  version: string,
  path: string,
): Promise<MarketplaceSkillFile | null> {
  const versionRecord = await getPublicVersionRecord(database, { identifier }, version)
  if (!versionRecord) return null
  const rows = await database.db
    .select({ path: versionFiles.path, size: versionFiles.size, isText: versionFiles.isText, content: versionFiles.content })
    .from(versionFiles)
    .where(and(eq(versionFiles.versionId, versionRecord.versionId), eq(versionFiles.path, path)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    path: row.path,
    size: row.size,
    isText: row.isText,
    ...(row.isText && row.content !== null ? { content: row.content } : {}),
  }
}

export async function getPublicInstallManifest(
  database: MarketplaceDatabase,
  identifier: string,
  version: string,
  downloadUrlFactory?: (identifier: string, version: string) => string,
): Promise<MarketplaceInstallManifest | null> {
  const versionRecord = await getPublicVersionRecord(database, { identifier }, version)
  return versionRecord
    ? buildPublicInstallManifest(database, versionRecord, downloadUrlFactory)
    : null
}

export async function getPublicInstallManifestBySkillId(
  database: MarketplaceDatabase,
  skillId: string,
  version: string,
  downloadUrlFactory?: (identifier: string, version: string) => string,
): Promise<MarketplaceInstallManifest | null> {
  const versionRecord = await getPublicVersionRecord(database, { skillId }, version)
  return versionRecord
    ? buildPublicInstallManifest(database, versionRecord, downloadUrlFactory)
    : null
}

async function buildPublicInstallManifest(
  database: MarketplaceDatabase,
  versionRecord: PublicVersionRecord,
  downloadUrlFactory?: (identifier: string, version: string) => string,
): Promise<MarketplaceInstallManifest> {
  const files = await database.db
    .select({ path: versionFiles.path, size: versionFiles.size })
    .from(versionFiles)
    .where(eq(versionFiles.versionId, versionRecord.versionId))
  return {
    marketplaceSkillId: versionRecord.skillId,
    identifier: versionRecord.identifier,
    version: versionRecord.version,
    sha256: versionRecord.sha256,
    size: versionRecord.size,
    fileCount: versionRecord.fileCount,
    files: buildMarketplaceFileTree(files),
    ...(downloadUrlFactory
      ? { downloadUrl: downloadUrlFactory(versionRecord.identifier, versionRecord.version) }
      : {}),
  }
}
