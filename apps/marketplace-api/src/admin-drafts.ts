import { randomUUID } from 'node:crypto'
import {
  createMarketplaceCandidateVersionState,
  createMarketplaceDraftSkillState,
  getMarketplaceSkillGovernance,
  getMarketplaceVersionGovernance,
  normalizeMarketplacePagination,
} from '@proma/marketplace-domain'
import type {
  MarketplaceAdminSkillDetail,
  MarketplaceAdminSkillSummary,
  MarketplaceAdminVersion,
  MarketplaceSkillStatus,
  MarketplaceVersionStatus,
} from '@proma/shared'
import type { Sql, TransactionSql } from 'postgres'
import type { AuthenticatedAdminSession } from './admin-auth'
import type { MarketplaceDatabase } from './database/client'

export class MarketplaceAdminDraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'MarketplaceAdminDraftError'
  }
}

export interface CreateMarketplaceAdminSkillInput {
  identifier: string
  name: string
  tagline: string
  description: string
  authorName: string
  authorUrl?: string
  categoryId: string
  tagIds?: string[]
  tags?: string[]
  icon: string
  featured: boolean
}

export interface UpdateMarketplaceAdminSkillInput {
  revision: number
  identifier?: string
  name?: string
  tagline?: string
  description?: string
  authorName?: string
  authorUrl?: string | null
  categoryId?: string
  tagIds?: string[]
  tags?: string[]
  icon?: string
  featured?: boolean
}

export interface CreateMarketplaceAdminVersionInput {
  version: string
  changelog: string
}

export interface UpdateMarketplaceAdminVersionInput {
  revision: number
  version?: string
  changelog?: string
}

export interface MarketplaceAdminWriteContext {
  actor: AuthenticatedAdminSession
  requestId: string
}

interface SkillRow {
  id: string
  identifier: string
  name: string
  tagline: string
  description: string
  author_name: string
  author_url: string | null
  category_id: string
  tag_ids: string[]
  tags: string[]
  icon: string
  featured: boolean
  status: MarketplaceSkillStatus
  current_published_version_id: string | null
  revision: number
  created_at: Date | string
  updated_at: Date | string
}

interface VersionRow {
  id: string
  skill_id: string
  version: string
  changelog: string
  status: MarketplaceVersionStatus
  revision: number
  created_at: Date | string
  updated_at: Date | string
}

interface VersionWithSkillRow extends VersionRow {
  skill_status: MarketplaceSkillStatus
  current_published_version_id: string | null
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toAdminSkill(row: SkillRow): MarketplaceAdminSkillSummary {
  const governance = getMarketplaceSkillGovernance(row.status)
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    authorName: row.author_name,
    ...(row.author_url ? { authorUrl: row.author_url } : {}),
    categoryId: row.category_id,
    tagIds: row.tag_ids,
    tags: row.tags,
    icon: row.icon,
    featured: row.featured,
    status: row.status,
    ...governance,
    currentPublishedVersionId: row.current_published_version_id,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function toAdminVersion(
  row: VersionRow,
  skill: Pick<SkillRow, 'status' | 'current_published_version_id'>,
): MarketplaceAdminVersion {
  const governance = getMarketplaceVersionGovernance(row.status, {
    versionId: row.id,
    skillStatus: skill.status,
    currentPublishedVersionId: skill.current_published_version_id,
  })
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    changelog: row.changelog,
    status: row.status,
    ...governance,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

type MarketplaceSql = Sql | TransactionSql

function skillSelectColumns(sql: MarketplaceSql) {
  return sql`
    skills.id, skills.identifier, skills.name, skills.tagline, skills.description,
    skills.author_name, skills.author_url, skills.category_id,
    COALESCE(ARRAY(
      SELECT skill_tags.tag_id FROM skill_tags
      INNER JOIN tags ON tags.id = skill_tags.tag_id
      WHERE skill_tags.skill_id = skills.id
      ORDER BY tags.normalized_name, tags.id
    ), '{}'::text[]) AS tag_ids,
    COALESCE(NULLIF(ARRAY(
      SELECT tags.name FROM skill_tags
      INNER JOIN tags ON tags.id = skill_tags.tag_id
      WHERE skill_tags.skill_id = skills.id
      ORDER BY tags.normalized_name, tags.id
    ), '{}'::text[]), skills.tags) AS tags,
    skills.icon, skills.featured, skills.status, skills.current_published_version_id,
    skills.revision, skills.created_at, skills.updated_at
  `
}

async function resolveTagBinding(
  transaction: TransactionSql,
  tagIds: string[],
): Promise<{ ids: string[]; names: string[] }> {
  const uniqueIds = [...new Set(tagIds)]
  if (uniqueIds.length === 0) return { ids: [], names: [] }
  const rows = await transaction<{ id: string; name: string }[]>`
    SELECT id, name FROM tags WHERE id = ANY(${uniqueIds})
    ORDER BY normalized_name, id
    FOR SHARE
  `
  if (rows.length !== uniqueIds.length) {
    throw new MarketplaceAdminDraftError('TAG_NOT_FOUND', '一个或多个标签不存在', 400)
  }
  return { ids: rows.map((row) => row.id), names: rows.map((row) => row.name) }
}

export async function getMarketplaceAdminSkill(
  database: MarketplaceDatabase,
  skillId: string,
): Promise<MarketplaceAdminSkillDetail | null> {
  const rows = await database.sql<SkillRow[]>`
    SELECT ${skillSelectColumns(database.sql)}
    FROM skills
    WHERE id = ${skillId} AND deleted_at IS NULL
    LIMIT 1
  `
  const skill = rows[0]
  if (!skill) return null
  const versions = await database.sql<VersionRow[]>`
    SELECT id, skill_id, version, changelog, status, revision, created_at, updated_at
    FROM skill_versions
    WHERE skill_id = ${skillId}
    ORDER BY created_at DESC, id DESC
  `
  return { ...toAdminSkill(skill), versions: versions.map((version) => toAdminVersion(version, skill)) }
}

export async function getMarketplaceAdminVersion(
  database: MarketplaceDatabase,
  skillId: string,
  versionId: string,
): Promise<MarketplaceAdminVersion | null> {
  const rows = await database.sql<VersionWithSkillRow[]>`
    SELECT versions.id, versions.skill_id, versions.version, versions.changelog, versions.status,
      versions.revision, versions.created_at, versions.updated_at,
      skills.status AS skill_status, skills.current_published_version_id
    FROM skill_versions versions
    INNER JOIN skills ON skills.id = versions.skill_id
    WHERE versions.id = ${versionId} AND versions.skill_id = ${skillId} AND skills.deleted_at IS NULL
    LIMIT 1
  `
  const version = rows[0]
  return version ? toAdminVersion(version, {
    status: version.skill_status,
    current_published_version_id: version.current_published_version_id,
  }) : null
}

export async function listMarketplaceAdminSkills(
  database: MarketplaceDatabase,
  input: {
    page?: string | number | null
    pageSize?: string | number | null
    status?: MarketplaceSkillStatus
  },
): Promise<{ items: MarketplaceAdminSkillSummary[]; page: { number: number; size: number; total: number; pages: number } }> {
  const pagination = normalizeMarketplacePagination(input)
  const [rows, totals] = await Promise.all([
    database.sql<SkillRow[]>`
      SELECT ${skillSelectColumns(database.sql)}
      FROM skills
      WHERE deleted_at IS NULL
        AND (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null})
      ORDER BY updated_at DESC, id DESC
      LIMIT ${pagination.pageSize} OFFSET ${(pagination.page - 1) * pagination.pageSize}
    `,
    database.sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM skills
      WHERE deleted_at IS NULL
        AND (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null})
    `,
  ])
  const total = totals[0]?.count ?? 0
  return {
    items: rows.map(toAdminSkill),
    page: {
      number: pagination.page,
      size: pagination.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
  }
}

export async function createMarketplaceAdminSkill(
  database: MarketplaceDatabase,
  input: CreateMarketplaceAdminSkillInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminSkillDetail> {
  const id = randomUUID()
  const initialState = createMarketplaceDraftSkillState()
  try {
    await database.sql.begin(async (transaction) => {
      const tagBinding = input.tagIds ? await resolveTagBinding(transaction, input.tagIds) : null
      await transaction`
        INSERT INTO skills (
          id, identifier, name, tagline, description, author_name, author_url, category_id,
          tags, icon, featured, status, current_published_version_id
        ) VALUES (
          ${id}, ${input.identifier}, ${input.name}, ${input.tagline}, ${input.description},
          ${input.authorName}, ${input.authorUrl ?? null}, ${input.categoryId}, ${tagBinding?.names ?? input.tags ?? []},
          ${input.icon}, ${input.featured}, ${initialState.status}, ${initialState.currentPublishedVersionId}
        )
      `
      for (const tagId of tagBinding?.ids ?? []) {
        await transaction`INSERT INTO skill_tags (skill_id, tag_id) VALUES (${id}, ${tagId})`
      }
      await transaction`
        INSERT INTO audit_entries (
          id, actor_id, actor_identifier, action, request_id, skill_id, after_state, reason
        ) VALUES (
          ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username}, 'skill.created',
          ${context.requestId}, ${id},
          ${JSON.stringify({ id, identifier: input.identifier, status: initialState.status, revision: 1 })}::jsonb,
          '管理员创建 Skill 草稿'
        )
      `
    })
  } catch (error) {
    const code = postgresErrorCode(error)
    if (code === '23505') {
      throw new MarketplaceAdminDraftError('SKILL_IDENTIFIER_CONFLICT', 'Skill identifier 已存在', 409)
    }
    if (code === '23503') {
      throw new MarketplaceAdminDraftError('CATEGORY_NOT_FOUND', '分类不存在', 400)
    }
    throw error
  }

  const skill = await getMarketplaceAdminSkill(database, id)
  if (!skill) throw new Error('Skill 草稿创建后无法读取')
  return skill
}

export async function updateMarketplaceAdminSkill(
  database: MarketplaceDatabase,
  skillId: string,
  input: UpdateMarketplaceAdminSkillInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminSkillDetail> {
  try {
    await database.sql.begin(async (transaction) => {
      const rows = await transaction<SkillRow[]>`
        SELECT ${skillSelectColumns(transaction)}
        FROM skills
        WHERE id = ${skillId} AND deleted_at IS NULL
        FOR UPDATE
      `
      const current = rows[0]
      if (!current) throw new MarketplaceAdminDraftError('SKILL_NOT_FOUND', 'Skill 不存在', 404)
      if (current.status !== 'draft') {
        throw new MarketplaceAdminDraftError('SKILL_NOT_EDITABLE', '仅草稿 Skill 可以编辑', 409)
      }
      if (current.revision !== input.revision) {
        throw new MarketplaceAdminDraftError('SKILL_REVISION_CONFLICT', 'Skill 已被其他操作更新，请刷新后重试', 409)
      }
      const tagBinding = input.tagIds ? await resolveTagBinding(transaction, input.tagIds) : null

      await transaction`
        UPDATE skills SET
          identifier = COALESCE(${input.identifier ?? null}, identifier),
          name = COALESCE(${input.name ?? null}, name),
          tagline = COALESCE(${input.tagline ?? null}, tagline),
          description = COALESCE(${input.description ?? null}, description),
          author_name = COALESCE(${input.authorName ?? null}, author_name),
          author_url = CASE WHEN ${input.authorUrl !== undefined} THEN ${input.authorUrl ?? null} ELSE author_url END,
          category_id = COALESCE(${input.categoryId ?? null}, category_id),
          tags = CASE
            WHEN ${tagBinding !== null} THEN ${tagBinding?.names ?? []}
            WHEN ${input.tags !== undefined} THEN ${input.tags ?? []}
            ELSE tags
          END,
          icon = COALESCE(${input.icon ?? null}, icon),
          featured = CASE WHEN ${input.featured !== undefined} THEN ${input.featured ?? false} ELSE featured END,
          revision = revision + 1,
          updated_at = now()
        WHERE id = ${skillId}
      `
      if (tagBinding) {
        await transaction`DELETE FROM skill_tags WHERE skill_id = ${skillId}`
        for (const tagId of tagBinding.ids) {
          await transaction`INSERT INTO skill_tags (skill_id, tag_id) VALUES (${skillId}, ${tagId})`
        }
      }
      const afterState = {
        identifier: input.identifier ?? current.identifier,
        name: input.name ?? current.name,
        revision: current.revision + 1,
      }
      await transaction`
        INSERT INTO audit_entries (
          id, actor_id, actor_identifier, action, request_id, skill_id, before_state, after_state, reason
        ) VALUES (
          ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username}, 'skill.updated',
          ${context.requestId}, ${skillId},
          ${JSON.stringify({ identifier: current.identifier, name: current.name, revision: current.revision })}::jsonb,
          ${JSON.stringify(afterState)}::jsonb,
          '管理员更新 Skill 草稿'
        )
      `
    })
  } catch (error) {
    if (error instanceof MarketplaceAdminDraftError) throw error
    const code = postgresErrorCode(error)
    if (code === '23505') {
      throw new MarketplaceAdminDraftError('SKILL_IDENTIFIER_CONFLICT', 'Skill identifier 已存在', 409)
    }
    if (code === '23503') {
      throw new MarketplaceAdminDraftError('CATEGORY_NOT_FOUND', '分类不存在', 400)
    }
    throw error
  }

  const skill = await getMarketplaceAdminSkill(database, skillId)
  if (!skill) throw new Error('Skill 草稿更新后无法读取')
  return skill
}

export async function createMarketplaceAdminVersion(
  database: MarketplaceDatabase,
  skillId: string,
  input: CreateMarketplaceAdminVersionInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminVersion> {
  const versionId = randomUUID()
  try {
    await database.sql.begin(async (transaction) => {
      const skills = await transaction<{
        status: MarketplaceSkillStatus
        current_published_version_id: string | null
      }[]>`
        SELECT status, current_published_version_id
        FROM skills
        WHERE id = ${skillId} AND deleted_at IS NULL
        FOR UPDATE
      `
      const skill = skills[0]
      if (!skill) throw new MarketplaceAdminDraftError('SKILL_NOT_FOUND', 'Skill 不存在', 404)
      if (!getMarketplaceSkillGovernance(skill.status).allowedActions.includes('create_version')) {
        throw new MarketplaceAdminDraftError('SKILL_VERSION_CREATION_NOT_ALLOWED', '当前 Skill 状态不能新建版本', 409)
      }
      const initialState = createMarketplaceCandidateVersionState(skill.current_published_version_id)
      await transaction`
        INSERT INTO skill_versions (
          id, skill_id, version, changelog, sha256, size, file_count, status
        ) VALUES (
          ${versionId}, ${skillId}, ${input.version}, ${input.changelog}, '', 0, 0, ${initialState.status}
        )
      `
      await transaction`
        INSERT INTO audit_entries (
          id, actor_id, actor_identifier, action, request_id, skill_id, version_id,
          before_state, after_state, reason
        ) VALUES (
          ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username}, 'skill_version.created',
          ${context.requestId}, ${skillId}, ${versionId},
          ${JSON.stringify({ currentPublishedVersionId: initialState.currentPublishedVersionId })}::jsonb,
          ${JSON.stringify({
            id: versionId,
            version: input.version,
            status: initialState.status,
            currentPublishedVersionId: initialState.currentPublishedVersionId,
          })}::jsonb,
          '管理员创建候选版本'
        )
      `
    })
  } catch (error) {
    if (error instanceof MarketplaceAdminDraftError) throw error
    if (postgresErrorCode(error) === '23505') {
      throw new MarketplaceAdminDraftError('SKILL_VERSION_CONFLICT', '该 SemVer 版本已存在', 409)
    }
    throw error
  }

  const version = await getMarketplaceAdminVersion(database, skillId, versionId)
  if (!version) throw new Error('候选版本创建后无法读取')
  return version
}

export async function updateMarketplaceAdminVersion(
  database: MarketplaceDatabase,
  skillId: string,
  versionId: string,
  input: UpdateMarketplaceAdminVersionInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminVersion> {
  try {
    await database.sql.begin(async (transaction) => {
      const rows = await transaction<VersionRow[]>`
        SELECT versions.id, versions.skill_id, versions.version, versions.changelog, versions.status,
          versions.revision, versions.created_at, versions.updated_at
        FROM skill_versions versions
        INNER JOIN skills ON skills.id = versions.skill_id
        WHERE versions.id = ${versionId} AND versions.skill_id = ${skillId} AND skills.deleted_at IS NULL
        FOR UPDATE OF versions
      `
      const current = rows[0]
      if (!current) throw new MarketplaceAdminDraftError('VERSION_NOT_FOUND', '候选版本不存在', 404)
      if (!['created', 'validation_failed'].includes(current.status)) {
        throw new MarketplaceAdminDraftError('VERSION_NOT_EDITABLE', '当前状态的版本不能编辑', 409)
      }
      if (current.revision !== input.revision) {
        throw new MarketplaceAdminDraftError('VERSION_REVISION_CONFLICT', '版本已被其他操作更新，请刷新后重试', 409)
      }

      await transaction`
        UPDATE skill_versions SET
          version = COALESCE(${input.version ?? null}, version),
          changelog = COALESCE(${input.changelog ?? null}, changelog),
          revision = revision + 1,
          updated_at = now()
        WHERE id = ${versionId}
      `
      await transaction`
        INSERT INTO audit_entries (
          id, actor_id, actor_identifier, action, request_id, skill_id, version_id,
          before_state, after_state, reason
        ) VALUES (
          ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username}, 'skill_version.updated',
          ${context.requestId}, ${skillId}, ${versionId},
          ${JSON.stringify({ version: current.version, changelog: current.changelog, revision: current.revision })}::jsonb,
          ${JSON.stringify({
            version: input.version ?? current.version,
            changelog: input.changelog ?? current.changelog,
            revision: current.revision + 1,
          })}::jsonb,
          '管理员更新候选版本'
        )
      `
    })
  } catch (error) {
    if (error instanceof MarketplaceAdminDraftError) throw error
    if (postgresErrorCode(error) === '23505') {
      throw new MarketplaceAdminDraftError('SKILL_VERSION_CONFLICT', '该 SemVer 版本已存在', 409)
    }
    throw error
  }

  const version = await getMarketplaceAdminVersion(database, skillId, versionId)
  if (!version) throw new Error('候选版本更新后无法读取')
  return version
}

export async function deleteMarketplaceAdminSkill(
  database: MarketplaceDatabase,
  skillId: string,
  revision: number,
  context: MarketplaceAdminWriteContext,
): Promise<void> {
  await database.sql.begin(async (transaction) => {
    const rows = await transaction<Pick<SkillRow, 'id' | 'identifier' | 'status' | 'revision'>[]>`
      SELECT id, identifier, status, revision
      FROM skills
      WHERE id = ${skillId} AND deleted_at IS NULL
      FOR UPDATE
    `
    const current = rows[0]
    if (!current) throw new MarketplaceAdminDraftError('SKILL_NOT_FOUND', 'Skill 不存在', 404)
    if (current.status !== 'draft') {
      throw new MarketplaceAdminDraftError('SKILL_NOT_DELETABLE', '仅草稿 Skill 可以删除', 409)
    }
    if (current.revision !== revision) {
      throw new MarketplaceAdminDraftError('SKILL_REVISION_CONFLICT', 'Skill 已被其他操作更新，请刷新后重试', 409)
    }
    await transaction`
      UPDATE skills SET
        deleted_at = now(),
        deleted_by = ${context.actor.adminId},
        revision = revision + 1,
        updated_at = now()
      WHERE id = ${skillId}
    `
    await transaction`
      INSERT INTO audit_entries (
        id, actor_id, actor_identifier, action, request_id, skill_id, before_state, after_state, reason
      ) VALUES (
        ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username}, 'skill.deleted',
        ${context.requestId}, ${skillId},
        ${JSON.stringify({ id: current.id, identifier: current.identifier, status: current.status, revision })}::jsonb,
        ${JSON.stringify({ deleted: true, revision: revision + 1 })}::jsonb,
        '管理员软删除 Skill 草稿'
      )
    `
  })
}
