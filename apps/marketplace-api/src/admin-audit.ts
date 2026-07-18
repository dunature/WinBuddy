import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { normalizeMarketplacePagination } from '@proma/marketplace-domain'
import type { MarketplaceAdminAuditEntry, MarketplacePage } from '@proma/shared'
import type { MarketplaceDatabase } from './database/client'
import { auditEntries, skills, skillVersions } from './database/schema'

export interface MarketplaceAdminAuditFilters {
  skillId?: string
  actor?: string
  action?: string
  from?: Date
  to?: Date
  page?: string
  pageSize?: string
}

export async function listMarketplaceAdminAuditEntries(
  database: MarketplaceDatabase,
  filters: MarketplaceAdminAuditFilters,
): Promise<MarketplacePage<MarketplaceAdminAuditEntry>> {
  const pagination = normalizeMarketplacePagination({ page: filters.page, pageSize: filters.pageSize })
  const conditions: SQL[] = []
  if (filters.skillId) conditions.push(eq(auditEntries.skillId, filters.skillId))
  if (filters.actor) {
    conditions.push(sql`lower(coalesce(${auditEntries.actorIdentifier}, '')) = ${filters.actor.toLowerCase()}`)
  }
  if (filters.action) conditions.push(eq(auditEntries.action, filters.action))
  if (filters.from) conditions.push(gte(auditEntries.createdAt, filters.from))
  if (filters.to) conditions.push(lt(auditEntries.createdAt, filters.to))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, totals] = await Promise.all([
    database.db
      .select({
        id: auditEntries.id,
        actorId: auditEntries.actorId,
        actorIdentifier: auditEntries.actorIdentifier,
        action: auditEntries.action,
        requestId: auditEntries.requestId,
        skillId: auditEntries.skillId,
        skillIdentifier: skills.identifier,
        versionId: auditEntries.versionId,
        version: skillVersions.version,
        beforeState: auditEntries.beforeState,
        afterState: auditEntries.afterState,
        reason: auditEntries.reason,
        createdAt: auditEntries.createdAt,
      })
      .from(auditEntries)
      .leftJoin(skills, eq(skills.id, auditEntries.skillId))
      .leftJoin(skillVersions, eq(skillVersions.id, auditEntries.versionId))
      .where(where)
      .orderBy(desc(auditEntries.createdAt), desc(auditEntries.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize),
    database.db.select({ total: count() }).from(auditEntries).where(where),
  ])
  const total = totals[0]?.total ?? 0
  return {
    items: rows.map((row) => ({
      id: row.id,
      ...(row.actorId ? { actorId: row.actorId } : {}),
      ...(row.actorIdentifier ? { actorIdentifier: row.actorIdentifier } : {}),
      action: row.action,
      requestId: row.requestId,
      ...(row.skillId ? { skillId: row.skillId } : {}),
      ...(row.skillIdentifier ? { skillIdentifier: row.skillIdentifier } : {}),
      ...(row.versionId ? { versionId: row.versionId } : {}),
      ...(row.version ? { version: row.version } : {}),
      beforeState: row.beforeState,
      afterState: row.afterState,
      ...(row.reason ? { reason: row.reason } : {}),
      createdAt: row.createdAt.toISOString(),
    })),
    page: {
      number: pagination.page,
      size: pagination.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
  }
}
