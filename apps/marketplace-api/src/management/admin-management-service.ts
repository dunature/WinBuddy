import postgres from 'postgres'
import type { MarketplaceAdminSkillSummary, MarketplaceAdminVersionSummary, MarketplaceAuditEntry, MarketplaceSkillStatus } from '@proma/shared'
import { SubmissionError } from '../submissions/submission-service.ts'

export class AdminManagementService {
  private readonly sql: postgres.Sql

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl)
  }

  async listSkills(query?: string): Promise<MarketplaceAdminSkillSummary[]> {
    const pattern = query?.trim() ? `%${query.trim()}%` : undefined
    const rows = await this.sql<Array<{ id: string; slug: string; display_name: string; author_handle: string; category_slug: string; version: string; status: MarketplaceSkillStatus; install_count: number; updated_at: Date }>>`
      SELECT s.id, s.slug, s.display_name, a.handle author_handle, s.category_slug, v.version, v.status, s.install_count, s.updated_at
      FROM marketplace_skills s JOIN marketplace_authors a ON a.id=s.author_id JOIN marketplace_versions v ON v.id=s.latest_published_version_id
      WHERE ${pattern ? this.sql`(s.slug ILIKE ${pattern} OR s.display_name ILIKE ${pattern} OR a.handle ILIKE ${pattern})` : this.sql`true`}
      ORDER BY s.updated_at DESC`
    return rows.map((row) => ({ id: row.id, slug: row.slug, displayName: row.display_name, authorHandle: row.author_handle, category: row.category_slug, version: row.version, status: row.status, installCount: Number(row.install_count), updatedAt: row.updated_at.toISOString() }))
  }

  async listVersions(skillId: string): Promise<MarketplaceAdminVersionSummary[]> {
    const rows = await this.sql<Array<{ id: string; version: string; status: MarketplaceSkillStatus; sha256: string; created_at: Date; published_at: Date | null }>>`
      SELECT id, version, status, sha256, created_at, published_at FROM marketplace_versions WHERE skill_id=${skillId} ORDER BY created_at DESC`
    return rows.map((row) => ({ id: row.id, version: row.version, status: row.status, sha256: row.sha256, createdAt: row.created_at.toISOString(), ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}) }))
  }

  async lifecycle(skillId: string, action: 'unlist' | 'republish' | 'archive', reason: string, actor: string): Promise<void> {
    if (!reason.trim()) throw new SubmissionError('VALIDATION_FAILED', '操作原因不能为空', 400)
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ latest_published_version_id: string | null; status: MarketplaceSkillStatus | null }[]>`
        SELECT s.latest_published_version_id, v.status
        FROM marketplace_skills s JOIN marketplace_versions v ON v.id=s.latest_published_version_id
        WHERE s.id=${skillId} FOR UPDATE OF s, v`
      const current = rows[0]
      if (!current?.latest_published_version_id || !current.status) throw new SubmissionError('SKILL_NOT_FOUND', '找不到该 Skill 的公开版本', 404)
      const target = lifecycleTarget(current.status, action)
      if (target === current.status) return
      await transaction`UPDATE marketplace_versions SET status=${target} WHERE id=${current.latest_published_version_id}`
      await transaction`UPDATE marketplace_skills SET updated_at=now() WHERE id=${skillId}`
      await transaction`INSERT INTO marketplace_audit_logs(actor, action, skill_id, details) VALUES(${actor}, ${`skill.${action}`}, ${skillId}, ${transaction.json({ reason: reason.trim(), from: current.status, to: target })})`
    })
  }

  async audit(skillId?: string): Promise<MarketplaceAuditEntry[]> {
    const rows = await this.sql<Array<{ id: string; actor: string; action: string; skill_id: string | null; details: unknown; created_at: Date }>>`
      SELECT id, actor, action, skill_id, details, created_at FROM marketplace_audit_logs
      WHERE ${skillId ? this.sql`skill_id=${skillId}` : this.sql`true`} ORDER BY created_at DESC LIMIT 200`
    return rows.map((row) => ({ id: row.id, actor: row.actor, action: row.action, ...(row.skill_id ? { skillId: row.skill_id } : {}), ...(record(row.details) ? { details: record(row.details) } : {}), createdAt: row.created_at.toISOString() }))
  }
}

export function lifecycleTarget(current: MarketplaceSkillStatus, action: 'unlist' | 'republish' | 'archive'): MarketplaceSkillStatus {
  if (current === 'archived' && action === 'republish') throw new SubmissionError('LIFECYCLE_STATE_CONFLICT', '已归档版本不能重新发布', 409)
  if (action === 'unlist') {
    if (current !== 'published' && current !== 'unlisted') throw new SubmissionError('LIFECYCLE_STATE_CONFLICT', '当前版本不能下架', 409)
    return 'unlisted'
  }
  if (action === 'republish') {
    if (current !== 'unlisted' && current !== 'published') throw new SubmissionError('LIFECYCLE_STATE_CONFLICT', '只有已下架版本可以重新发布', 409)
    return 'published'
  }
  return 'archived'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
