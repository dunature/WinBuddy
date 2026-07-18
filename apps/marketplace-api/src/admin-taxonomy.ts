import { randomUUID } from 'node:crypto'
import { normalizeMarketplaceTaxonomyName } from '@proma/marketplace-domain'
import type { MarketplaceAdminCategory, MarketplaceAdminTag } from '@proma/shared'
import type { TransactionSql } from 'postgres'
import type { MarketplaceAdminWriteContext } from './admin-drafts'
import type { MarketplaceDatabase } from './database/client'

export class MarketplaceAdminTaxonomyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409,
    readonly details?: { referenceCount: number },
  ) {
    super(message)
    this.name = 'MarketplaceAdminTaxonomyError'
  }
}

export interface CreateMarketplaceCategoryInput {
  name: string
  icon: string
}

export interface UpdateMarketplaceCategoryInput {
  revision: number
  name?: string
  icon?: string
}

export interface CreateMarketplaceTagInput {
  name: string
}

export interface UpdateMarketplaceTagInput {
  revision: number
  name: string
}

interface CategoryRow {
  id: string
  name: string
  normalized_name: string
  icon: string
  revision: number
  reference_count: number
  created_at: Date | string
  updated_at: Date | string
}

interface TagRow {
  id: string
  name: string
  normalized_name: string
  revision: number
  reference_count: number
  created_at: Date | string
  updated_at: Date | string
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toCategory(row: CategoryRow): MarketplaceAdminCategory {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    icon: row.icon,
    revision: row.revision,
    referenceCount: row.reference_count,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function toTag(row: TagRow): MarketplaceAdminTag {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    revision: row.revision,
    referenceCount: row.reference_count,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function insertAudit(
  transaction: TransactionSql,
  context: MarketplaceAdminWriteContext,
  action: string,
  beforeState: object | null,
  afterState: object | null,
  reason: string,
): Promise<void> {
  await transaction`
    INSERT INTO audit_entries (
      id, actor_id, actor_identifier, action, request_id, before_state, after_state, reason
    ) VALUES (
      ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username}, ${action}, ${context.requestId},
      ${beforeState ? JSON.stringify(beforeState) : null}::jsonb,
      ${afterState ? JSON.stringify(afterState) : null}::jsonb,
      ${reason}
    )
  `
}

export async function listMarketplaceAdminCategories(
  database: MarketplaceDatabase,
): Promise<MarketplaceAdminCategory[]> {
  const rows = await database.sql<CategoryRow[]>`
    SELECT categories.id, categories.name, categories.normalized_name, categories.icon,
      categories.revision, categories.created_at, categories.updated_at,
      COUNT(skills.id)::integer AS reference_count
    FROM categories
    LEFT JOIN skills ON skills.category_id = categories.id AND skills.deleted_at IS NULL
    GROUP BY categories.id
    ORDER BY categories.normalized_name, categories.id
  `
  return rows.map(toCategory)
}

export async function listMarketplaceAdminTags(
  database: MarketplaceDatabase,
): Promise<MarketplaceAdminTag[]> {
  const rows = await database.sql<TagRow[]>`
    SELECT tags.id, tags.name, tags.normalized_name, tags.revision, tags.created_at, tags.updated_at,
      COUNT(skills.id)::integer AS reference_count
    FROM tags
    LEFT JOIN skill_tags ON skill_tags.tag_id = tags.id
    LEFT JOIN skills ON skills.id = skill_tags.skill_id AND skills.deleted_at IS NULL
    GROUP BY tags.id
    ORDER BY tags.normalized_name, tags.id
  `
  return rows.map(toTag)
}

export async function createMarketplaceAdminCategory(
  database: MarketplaceDatabase,
  input: CreateMarketplaceCategoryInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminCategory> {
  const id = randomUUID()
  const normalized = normalizeMarketplaceTaxonomyName(input.name)
  try {
    await database.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO categories (id, name, normalized_name, icon)
        VALUES (${id}, ${normalized.name}, ${normalized.normalizedName}, ${input.icon})
      `
      await insertAudit(transaction, context, 'category.created', null, {
        id, name: normalized.name, normalizedName: normalized.normalizedName, icon: input.icon, revision: 1,
      }, '管理员创建分类')
    })
  } catch (error) {
    if (postgresErrorCode(error) === '23505') {
      throw new MarketplaceAdminTaxonomyError('CATEGORY_NAME_CONFLICT', '规范化后的分类名称已存在', 409)
    }
    throw error
  }
  const category = (await listMarketplaceAdminCategories(database)).find((item) => item.id === id)
  if (!category) throw new Error('分类创建后无法读取')
  return category
}

export async function createMarketplaceAdminTag(
  database: MarketplaceDatabase,
  input: CreateMarketplaceTagInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminTag> {
  const id = randomUUID()
  const normalized = normalizeMarketplaceTaxonomyName(input.name)
  try {
    await database.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO tags (id, name, normalized_name)
        VALUES (${id}, ${normalized.name}, ${normalized.normalizedName})
      `
      await insertAudit(transaction, context, 'tag.created', null, {
        id, name: normalized.name, normalizedName: normalized.normalizedName, revision: 1,
      }, '管理员创建标签')
    })
  } catch (error) {
    if (postgresErrorCode(error) === '23505') {
      throw new MarketplaceAdminTaxonomyError('TAG_NAME_CONFLICT', '规范化后的标签名称已存在', 409)
    }
    throw error
  }
  const tag = (await listMarketplaceAdminTags(database)).find((item) => item.id === id)
  if (!tag) throw new Error('标签创建后无法读取')
  return tag
}

export async function updateMarketplaceAdminCategory(
  database: MarketplaceDatabase,
  categoryId: string,
  input: UpdateMarketplaceCategoryInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminCategory> {
  try {
    await database.sql.begin(async (transaction) => {
      const rows = await transaction<Omit<CategoryRow, 'reference_count'>[]>`
        SELECT id, name, normalized_name, icon, revision, created_at, updated_at
        FROM categories WHERE id = ${categoryId} FOR UPDATE
      `
      const current = rows[0]
      if (!current) throw new MarketplaceAdminTaxonomyError('CATEGORY_NOT_FOUND', '分类不存在', 404)
      if (current.revision !== input.revision) {
        throw new MarketplaceAdminTaxonomyError('CATEGORY_REVISION_CONFLICT', '分类已被更新，请刷新后重试', 409)
      }
      const normalized = input.name ? normalizeMarketplaceTaxonomyName(input.name) : null
      const next = {
        name: normalized?.name ?? current.name,
        normalizedName: normalized?.normalizedName ?? current.normalized_name,
        icon: input.icon ?? current.icon,
        revision: current.revision + 1,
      }
      await transaction`
        UPDATE categories SET name = ${next.name}, normalized_name = ${next.normalizedName},
          icon = ${next.icon}, revision = revision + 1, updated_at = now()
        WHERE id = ${categoryId}
      `
      await insertAudit(transaction, context, 'category.updated', {
        id: categoryId, name: current.name, normalizedName: current.normalized_name,
        icon: current.icon, revision: current.revision,
      }, { id: categoryId, ...next }, '管理员重命名或更新分类')
    })
  } catch (error) {
    if (error instanceof MarketplaceAdminTaxonomyError) throw error
    if (postgresErrorCode(error) === '23505') {
      throw new MarketplaceAdminTaxonomyError('CATEGORY_NAME_CONFLICT', '规范化后的分类名称已存在', 409)
    }
    throw error
  }
  const category = (await listMarketplaceAdminCategories(database)).find((item) => item.id === categoryId)
  if (!category) throw new Error('分类更新后无法读取')
  return category
}

export async function updateMarketplaceAdminTag(
  database: MarketplaceDatabase,
  tagId: string,
  input: UpdateMarketplaceTagInput,
  context: MarketplaceAdminWriteContext,
): Promise<MarketplaceAdminTag> {
  const normalized = normalizeMarketplaceTaxonomyName(input.name)
  try {
    await database.sql.begin(async (transaction) => {
      const rows = await transaction<Omit<TagRow, 'reference_count'>[]>`
        SELECT id, name, normalized_name, revision, created_at, updated_at
        FROM tags WHERE id = ${tagId} FOR UPDATE
      `
      const current = rows[0]
      if (!current) throw new MarketplaceAdminTaxonomyError('TAG_NOT_FOUND', '标签不存在', 404)
      if (current.revision !== input.revision) {
        throw new MarketplaceAdminTaxonomyError('TAG_REVISION_CONFLICT', '标签已被更新，请刷新后重试', 409)
      }
      const afterState = {
        id: tagId, name: normalized.name, normalizedName: normalized.normalizedName, revision: current.revision + 1,
      }
      await transaction`
        UPDATE tags SET name = ${normalized.name}, normalized_name = ${normalized.normalizedName},
          revision = revision + 1, updated_at = now()
        WHERE id = ${tagId}
      `
      await insertAudit(transaction, context, 'tag.updated', {
        id: tagId, name: current.name, normalizedName: current.normalized_name, revision: current.revision,
      }, afterState, '管理员重命名标签')
    })
  } catch (error) {
    if (error instanceof MarketplaceAdminTaxonomyError) throw error
    if (postgresErrorCode(error) === '23505') {
      throw new MarketplaceAdminTaxonomyError('TAG_NAME_CONFLICT', '规范化后的标签名称已存在', 409)
    }
    throw error
  }
  const tag = (await listMarketplaceAdminTags(database)).find((item) => item.id === tagId)
  if (!tag) throw new Error('标签更新后无法读取')
  return tag
}

export async function deleteMarketplaceAdminCategory(
  database: MarketplaceDatabase,
  categoryId: string,
  revision: number,
  context: MarketplaceAdminWriteContext,
): Promise<void> {
  await database.sql.begin(async (transaction) => {
    const rows = await transaction<Omit<CategoryRow, 'reference_count'>[]>`
      SELECT id, name, normalized_name, icon, revision, created_at, updated_at
      FROM categories WHERE id = ${categoryId} FOR UPDATE
    `
    const current = rows[0]
    if (!current) throw new MarketplaceAdminTaxonomyError('CATEGORY_NOT_FOUND', '分类不存在', 404)
    if (current.revision !== revision) {
      throw new MarketplaceAdminTaxonomyError('CATEGORY_REVISION_CONFLICT', '分类已被更新，请刷新后重试', 409)
    }
    const references = await transaction<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM skills
      WHERE category_id = ${categoryId} AND deleted_at IS NULL
    `
    const referenceCount = references[0]?.count ?? 0
    if (referenceCount > 0) {
      throw new MarketplaceAdminTaxonomyError('CATEGORY_IN_USE', '分类仍被 Skill 使用，不能删除', 409, { referenceCount })
    }
    await transaction`DELETE FROM categories WHERE id = ${categoryId}`
    await insertAudit(transaction, context, 'category.deleted', {
      id: categoryId, name: current.name, normalizedName: current.normalized_name,
      icon: current.icon, revision: current.revision,
    }, null, '管理员删除未使用分类')
  })
}

export async function deleteMarketplaceAdminTag(
  database: MarketplaceDatabase,
  tagId: string,
  revision: number,
  context: MarketplaceAdminWriteContext,
): Promise<void> {
  await database.sql.begin(async (transaction) => {
    const rows = await transaction<Omit<TagRow, 'reference_count'>[]>`
      SELECT id, name, normalized_name, revision, created_at, updated_at
      FROM tags WHERE id = ${tagId} FOR UPDATE
    `
    const current = rows[0]
    if (!current) throw new MarketplaceAdminTaxonomyError('TAG_NOT_FOUND', '标签不存在', 404)
    if (current.revision !== revision) {
      throw new MarketplaceAdminTaxonomyError('TAG_REVISION_CONFLICT', '标签已被更新，请刷新后重试', 409)
    }
    const references = await transaction<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM skill_tags
      INNER JOIN skills ON skills.id = skill_tags.skill_id
      WHERE skill_tags.tag_id = ${tagId} AND skills.deleted_at IS NULL
    `
    const referenceCount = references[0]?.count ?? 0
    if (referenceCount > 0) {
      throw new MarketplaceAdminTaxonomyError('TAG_IN_USE', '标签仍被 Skill 使用，不能删除', 409, { referenceCount })
    }
    await transaction`DELETE FROM skill_tags WHERE tag_id = ${tagId}`
    await transaction`DELETE FROM tags WHERE id = ${tagId}`
    await insertAudit(transaction, context, 'tag.deleted', {
      id: tagId, name: current.name, normalizedName: current.normalized_name, revision: current.revision,
    }, null, '管理员删除未使用标签')
  })
}
