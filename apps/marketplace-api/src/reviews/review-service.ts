import postgres from 'postgres'
import { formatMarketplaceLog, type MarketplaceAdminUser, type MarketplaceEditablePublishMetadata, type MarketplaceReviewDecisionInput, type MarketplaceReviewResult } from '@proma/shared'
import type { MarketplaceObjectStore } from '../object-store/object-store.ts'
import { publishedPackageKey } from '../object-store/object-store.ts'
import { SubmissionError } from '../submissions/submission-service.ts'

interface CandidateRow {
  id: string
  object_key: string
  status: string
  sha256: string
  package_size: number
  manifest: Record<string, unknown>
  guide_markdown: string
  extracted_files: unknown[]
  extracted_examples: unknown[]
}

export class PostgresReviewService {
  private readonly sql: postgres.Sql

  constructor(databaseUrl: string, private readonly objects: MarketplaceObjectStore) {
    this.sql = postgres(databaseUrl)
  }

  async decide(id: string, input: MarketplaceReviewDecisionInput, actor: MarketplaceAdminUser): Promise<MarketplaceReviewResult> {
    if (input.decision === 'reject' && !input.reason?.trim()) throw new SubmissionError('REVIEW_REASON_REQUIRED', '驳回原因不能为空', 400)
    const candidates = await this.sql<CandidateRow[]>`SELECT id, object_key, status, sha256, package_size, manifest, guide_markdown, extracted_files, extracted_examples FROM marketplace_submissions WHERE id=${id} LIMIT 1`
    let candidate = candidates[0]
    if (!candidate) throw new SubmissionError('SUBMISSION_NOT_FOUND', '找不到该审核记录', 404)
    if (candidate.status === 'published' || candidate.status === 'rejected') return { submissionId: id, status: candidate.status }
    if (candidate.status !== 'pending_review' && candidate.status !== 'approved' && candidate.status !== 'publish_failed') throw new SubmissionError('SUBMISSION_STATE_CONFLICT', '当前状态不能审核', 409)

    if (input.decision === 'reject') {
      await this.sql.begin(async (transaction) => {
        await transaction`INSERT INTO marketplace_reviews (submission_id, actor, decision, reason) VALUES (${id}, ${actor.githubLogin}, 'reject', ${input.reason!.trim()})`
        await transaction`UPDATE marketplace_submissions SET status='rejected', updated_at=now() WHERE id=${id}`
        await transaction`INSERT INTO marketplace_audit_logs (actor, action, details) VALUES (${actor.githubLogin}, 'submission.rejected', ${transaction.json({ submissionId: id, reason: input.reason!.trim() })})`
      })
      return { submissionId: id, status: 'rejected' }
    }

    if (input.metadata) candidate = await this.applyMetadata(candidate, input.metadata, actor)
    return this.publish(candidate, actor)
  }

  private async applyMetadata(candidate: CandidateRow, metadata: MarketplaceEditablePublishMetadata, actor: MarketplaceAdminUser): Promise<CandidateRow> {
    const categories = await this.sql<{ exists: boolean }[]>`SELECT EXISTS(SELECT 1 FROM marketplace_categories WHERE slug=${metadata.category}) AS exists`
    if (!categories[0]?.exists) throw new SubmissionError('VALIDATION_FAILED', '发布分类不存在', 400)
    const before = editableMetadata(candidate.manifest)
    const manifest = {
      ...candidate.manifest,
      author: { handle: metadata.authorHandle, name: metadata.authorName },
      category: metadata.category,
      display_name: metadata.displayName,
      description: metadata.description,
    }
    if (JSON.stringify(before) !== JSON.stringify(metadata)) {
      await this.sql.begin(async (transaction) => {
        await transaction`UPDATE marketplace_submissions SET manifest=${transaction.json(toJson(manifest))}, updated_at=now() WHERE id=${candidate.id}`
        await transaction`INSERT INTO marketplace_audit_logs (actor, action, details) VALUES (${actor.githubLogin}, 'submission.metadata_changed', ${transaction.json(toJson({ submissionId: candidate.id, before, after: metadata }))})`
      })
    }
    return { ...candidate, manifest }
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
      const versionId = await this.sql.begin(async (transaction) => {
        const handle = String(author.handle ?? 'proma-editor')
        const authors = await transaction<{ id: string }[]>`INSERT INTO marketplace_authors (handle, name, official) VALUES (${handle}, ${String(author.name ?? 'Proma 编辑部')}, ${handle === 'proma-editor'}) ON CONFLICT (handle) DO UPDATE SET name=excluded.name RETURNING id`
        await transaction`INSERT INTO marketplace_skills (id, slug, display_name, description, author_id, category_slug) VALUES (${skillId}, ${slug}, ${String(manifest.display_name ?? slug)}, ${String(manifest.description ?? '')}, ${authors[0]!.id}, ${String(manifest.category ?? 'productivity')}) ON CONFLICT (slug) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, author_id=excluded.author_id, category_slug=excluded.category_slug, updated_at=now()`
        const versions = await transaction<{ id: string }[]>`INSERT INTO marketplace_versions (skill_id, version, status, guide_markdown, changelog, sha256, package_size, object_key, manifest, published_at) VALUES (${skillId}, ${version}, 'published', ${candidate.guide_markdown}, ${String(manifest.changelog ?? '首次发布')}, ${candidate.sha256}, ${candidate.package_size}, ${destination}, ${transaction.json(toJson(manifest))}, now()) ON CONFLICT (skill_id, version) DO UPDATE SET status='published', guide_markdown=excluded.guide_markdown, changelog=excluded.changelog, sha256=excluded.sha256, package_size=excluded.package_size, object_key=excluded.object_key, manifest=excluded.manifest, published_at=now() RETURNING id`
        const publishedVersionId = versions[0]!.id
        await transaction`DELETE FROM marketplace_files WHERE version_id=${publishedVersionId}`
        await transaction`DELETE FROM marketplace_examples WHERE version_id=${publishedVersionId}`
        for (const value of candidate.extracted_files) {
          const file = record(value)
          if (typeof file.path !== 'string') continue
          await transaction`INSERT INTO marketplace_files (version_id, path, kind, size, content) VALUES (${publishedVersionId}, ${file.path}, ${String(file.kind ?? 'binary')}, ${Number(file.size ?? 0)}, ${typeof file.content === 'string' ? file.content : null})`
        }
        for (const value of candidate.extracted_examples) {
          const example = record(value)
          if (typeof example.title !== 'string' || typeof example.summary !== 'string') continue
          await transaction`INSERT INTO marketplace_examples (version_id, title, summary, featured, content) VALUES (${publishedVersionId}, ${example.title}, ${example.summary}, ${example.featured === true}, ${transaction.json(toJson(example))})`
        }
        await transaction`UPDATE marketplace_skills SET latest_published_version_id=${publishedVersionId}, updated_at=now() WHERE id=${skillId}`
        await transaction`INSERT INTO marketplace_reviews (submission_id, actor, decision) VALUES (${candidate.id}, ${actor.githubLogin}, 'approve')`
        await transaction`UPDATE marketplace_submissions SET status='published', updated_at=now() WHERE id=${candidate.id}`
        await transaction`INSERT INTO marketplace_audit_logs (actor, action, skill_id, details) VALUES (${actor.githubLogin}, 'version.published', ${skillId}, ${transaction.json({ submissionId: candidate.id, version })})`
        return publishedVersionId
      })
      return { submissionId: candidate.id, status: 'published', publishedVersionId: versionId }
    } catch (error) {
      await this.objects.deleteObject(destination).catch(() => undefined)
      await this.sql`UPDATE marketplace_submissions SET status='publish_failed', updated_at=now() WHERE id=${candidate.id}`
      console.error(formatMarketplaceLog('事务发布失败', { requestId: candidate.id, errorCode: 'PUBLISH_FAILED', skillId, version, result: 'failed' }))
      throw new SubmissionError('PUBLISH_FAILED', '发布失败，请稍后重试', 500)
    }
  }
}

function editableMetadata(manifest: Record<string, unknown>): MarketplaceEditablePublishMetadata {
  const author = record(manifest.author)
  return {
    authorHandle: String(author.handle ?? ''),
    authorName: String(author.name ?? ''),
    category: String(manifest.category ?? ''),
    displayName: String(manifest.display_name ?? ''),
    description: String(manifest.description ?? ''),
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue
}
