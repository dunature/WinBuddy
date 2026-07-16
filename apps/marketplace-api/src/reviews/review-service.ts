import postgres from 'postgres'
import type { MarketplaceAdminUser, MarketplaceReviewDecisionInput, MarketplaceReviewResult } from '@proma/shared'
import type { MarketplaceObjectStore } from '../object-store/object-store.ts'
import { publishedPackageKey } from '../object-store/object-store.ts'
import { SubmissionError } from '../submissions/submission-service.ts'

interface CandidateRow { id: string; object_key: string; status: string; sha256: string; package_size: number; manifest: Record<string, unknown>; guide_markdown: string; extracted_files: unknown[]; extracted_examples: unknown[] }

export class PostgresReviewService {
  private readonly sql: postgres.Sql
  constructor(databaseUrl: string, private readonly objects: MarketplaceObjectStore) { this.sql = postgres(databaseUrl) }
  async decide(id: string, input: MarketplaceReviewDecisionInput, actor: MarketplaceAdminUser): Promise<MarketplaceReviewResult> {
    if (input.decision === 'reject' && !input.reason?.trim()) throw new SubmissionError('REVIEW_REASON_REQUIRED', '驳回原因不能为空', 400)
    const candidates = await this.sql<CandidateRow[]>`SELECT id, object_key, status, sha256, package_size, manifest, guide_markdown, extracted_files, extracted_examples FROM marketplace_submissions WHERE id=${id} LIMIT 1`
    const candidate = candidates[0]
    if (!candidate) throw new SubmissionError('SUBMISSION_NOT_FOUND', '找不到该审核记录', 404)
    if (candidate.status === 'published' || candidate.status === 'rejected') return { submissionId: id, status: candidate.status }
    if (candidate.status !== 'pending_review' && candidate.status !== 'approved' && candidate.status !== 'publish_failed') throw new SubmissionError('SUBMISSION_STATE_CONFLICT', '当前状态不能审核', 409)
    if (input.decision === 'reject') {
      await this.sql.begin(async (tx) => { await tx`INSERT INTO marketplace_reviews (submission_id, actor, decision, reason) VALUES (${id}, ${actor.githubLogin}, 'reject', ${input.reason!.trim()})`; await tx`UPDATE marketplace_submissions SET status='rejected', updated_at=now() WHERE id=${id}`; await tx`INSERT INTO marketplace_audit_logs (actor, action, details) VALUES (${actor.githubLogin}, 'submission.rejected', ${tx.json({ submissionId: id, reason: input.reason!.trim() })})` })
      return { submissionId: id, status: 'rejected' }
    }
    return this.publish(candidate, actor)
  }
  private async publish(candidate: CandidateRow, actor: MarketplaceAdminUser): Promise<MarketplaceReviewResult> {
    const manifest = candidate.manifest
    const slug = String(manifest.name ?? '')
    const version = String(manifest.version ?? '')
    const author = record(manifest.author)
    const skillRows = await this.sql<{ id: string }[]>`SELECT id FROM marketplace_skills WHERE slug=${slug} LIMIT 1`
    const skillId = skillRows[0]?.id ?? crypto.randomUUID()
    const destination = publishedPackageKey(skillId, version)
    await this.sql`UPDATE marketplace_submissions SET status='publishing', updated_at=now() WHERE id=${candidate.id}`
    try {
      await this.objects.copyObject(candidate.object_key, destination)
      const versionId = await this.sql.begin(async (tx) => {
        const authors = await tx<{ id: string }[]>`INSERT INTO marketplace_authors (handle, name, official) VALUES (${String(author.handle ?? 'proma-editor')}, ${String(author.name ?? 'Proma 编辑部')}, true) ON CONFLICT (handle) DO UPDATE SET name=excluded.name RETURNING id`
        await tx`INSERT INTO marketplace_skills (id, slug, display_name, description, author_id, category_slug) VALUES (${skillId}, ${slug}, ${String(manifest.display_name ?? slug)}, ${String(manifest.description ?? '')}, ${authors[0]!.id}, ${String(manifest.category ?? 'productivity')}) ON CONFLICT (slug) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, author_id=excluded.author_id, category_slug=excluded.category_slug, updated_at=now()`
        const versions = await tx<{ id: string }[]>`INSERT INTO marketplace_versions (skill_id, version, status, guide_markdown, changelog, sha256, package_size, object_key, manifest, published_at) VALUES (${skillId}, ${version}, 'published', ${candidate.guide_markdown}, ${String(manifest.changelog ?? '首次发布')}, ${candidate.sha256}, ${candidate.package_size}, ${destination}, ${tx.json(toJson(manifest))}, now()) ON CONFLICT (skill_id, version) DO UPDATE SET status='published', published_at=now() RETURNING id`
        const versionId = versions[0]!.id
        for (const value of candidate.extracted_files) { const file = record(value); if (typeof file.path === 'string') await tx`INSERT INTO marketplace_files (version_id, path, kind, size, content) VALUES (${versionId}, ${file.path}, ${String(file.kind ?? 'binary')}, ${Number(file.size ?? 0)}, ${typeof file.content === 'string' ? file.content : null}) ON CONFLICT (version_id, path) DO NOTHING` }
        await tx`UPDATE marketplace_skills SET latest_published_version_id=${versionId}, updated_at=now() WHERE id=${skillId}`
        await tx`INSERT INTO marketplace_reviews (submission_id, actor, decision) VALUES (${candidate.id}, ${actor.githubLogin}, 'approve')`
        await tx`UPDATE marketplace_submissions SET status='published', updated_at=now() WHERE id=${candidate.id}`
        await tx`INSERT INTO marketplace_audit_logs (actor, action, skill_id, details) VALUES (${actor.githubLogin}, 'version.published', ${skillId}, ${tx.json({ submissionId: candidate.id, version })})`
        return versionId
      })
      return { submissionId: candidate.id, status: 'published', publishedVersionId: versionId }
    } catch (error) {
      await this.objects.deleteObject(destination).catch(() => undefined)
      await this.sql`UPDATE marketplace_submissions SET status='publish_failed', updated_at=now() WHERE id=${candidate.id}`
      throw new SubmissionError('PUBLISH_FAILED', error instanceof Error ? `发布失败：${error.message}` : '发布失败', 500)
    }
  }
}
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function toJson(value: unknown): postgres.JSONValue { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue }
