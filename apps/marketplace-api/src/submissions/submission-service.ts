import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type { MarketplaceAdminUser, MarketplaceCreateSubmissionInput, MarketplaceCreateSubmissionResult, MarketplaceSubmissionDetail, MarketplaceSubmissionStatus, MarketplaceSubmissionSummary } from '@proma/shared'
import type { MarketplaceObjectStore } from '../object-store/object-store.ts'
import { quarantinePackageKey } from '../object-store/object-store.ts'

const MAX_PACKAGE_BYTES = 20 * 1024 * 1024

export interface SubmissionRepository {
  findByIdempotencyKey(key: string, actor: string): Promise<MarketplaceSubmissionSummary | undefined>
  create(input: { id: string; fileName: string; size: number; actor: string; idempotencyKey: string }): Promise<MarketplaceSubmissionSummary>
  complete(id: string, actor: string, sha256: string): Promise<MarketplaceSubmissionSummary | undefined>
  list(actor?: string): Promise<MarketplaceSubmissionSummary[]>
  get(id: string): Promise<MarketplaceSubmissionDetail | undefined>
  getInternal(id: string): Promise<SubmissionInternalRecord | undefined>
}

export interface SubmissionInternalRecord extends MarketplaceSubmissionDetail { objectKey: string }

export class SubmissionService {
  constructor(private readonly repository: SubmissionRepository, private readonly objects: MarketplaceObjectStore, private readonly now: () => Date = () => new Date()) {}

  async create(input: MarketplaceCreateSubmissionInput, actor: MarketplaceAdminUser): Promise<MarketplaceCreateSubmissionResult> {
    if (!input.fileName.toLowerCase().endsWith('.zip') || input.size <= 0 || input.size > MAX_PACKAGE_BYTES) throw new SubmissionError('PACKAGE_TOO_LARGE', '仅支持不超过 20 MB 的 ZIP 文件', 400)
    const existing = await this.repository.findByIdempotencyKey(input.idempotencyKey, actor.githubLogin)
    const submission = existing ?? await this.repository.create({ id: randomUUID(), fileName: input.fileName, size: input.size, actor: actor.githubLogin, idempotencyKey: input.idempotencyKey })
    const objectKey = quarantinePackageKey(submission.id)
    const uploadUrl = await this.objects.getSignedUploadUrl(objectKey, 600, 'application/zip')
    return { submission, uploadUrl, expiresAt: new Date(this.now().getTime() + 600_000).toISOString() }
  }

  async complete(id: string, sha256: string, actor: MarketplaceAdminUser): Promise<MarketplaceSubmissionSummary> {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new SubmissionError('VALIDATION_FAILED', 'SHA256 格式无效', 400)
    const detail = await this.repository.getInternal(id)
    if (!detail) throw new SubmissionError('SUBMISSION_NOT_FOUND', '找不到该上传记录', 404)
    if (detail.submittedBy !== actor.githubLogin && actor.role !== 'admin') throw new SubmissionError('ADMIN_ACCESS_DENIED', '无权完成其他人的上传', 403)
    if (detail.status !== 'uploading') {
      if (detail.sha256 === sha256) return detail
      throw new SubmissionError('SUBMISSION_STATE_CONFLICT', '当前上传状态不能完成提交', 409)
    }
    const metadata = await this.objects.headObject(detail.objectKey)
    if (!metadata || metadata.size !== Number(detail.packageSize ?? metadata.size) || metadata.size > MAX_PACKAGE_BYTES) throw new SubmissionError('UPLOAD_FAILED', 'OSS 中的上传文件不存在或大小不一致', 400)
    const body = await this.objects.getObject(detail.objectKey)
    const actualHash = createHash('sha256').update(body).digest('hex')
    if (actualHash !== sha256.toLowerCase()) throw new SubmissionError('PACKAGE_HASH_MISMATCH', '上传文件 SHA256 不匹配', 400)
    const completed = await this.repository.complete(id, actor.githubLogin, actualHash)
    if (!completed) throw new SubmissionError('SUBMISSION_STATE_CONFLICT', '上传记录已被其他操作更新', 409)
    return completed
  }

  list(actor: MarketplaceAdminUser): Promise<MarketplaceSubmissionSummary[]> {
    return this.repository.list(actor.role === 'editor' ? actor.githubLogin : undefined)
  }
  async get(id: string, actor: MarketplaceAdminUser): Promise<MarketplaceSubmissionDetail | undefined> {
    const detail = await this.repository.get(id)
    return detail && (actor.role !== 'editor' || detail.submittedBy === actor.githubLogin) ? detail : undefined
  }
}

export class SubmissionError extends Error {
  constructor(readonly code: 'PACKAGE_TOO_LARGE' | 'VALIDATION_FAILED' | 'SUBMISSION_NOT_FOUND' | 'SKILL_NOT_FOUND' | 'ADMIN_ACCESS_DENIED' | 'SUBMISSION_STATE_CONFLICT' | 'UPLOAD_FAILED' | 'PACKAGE_HASH_MISMATCH' | 'REVIEW_REASON_REQUIRED' | 'PUBLISH_FAILED', message: string, readonly status: number) { super(message) }
}

interface SubmissionRow { id: string; object_key: string; file_name: string; package_size: number; sha256: string | null; status: MarketplaceSubmissionStatus; submitted_by: string; created_at: Date; updated_at: Date; manifest: unknown; guide_markdown: string | null; extracted_files: unknown; extracted_examples: unknown }

export class PostgresSubmissionRepository implements SubmissionRepository {
  private readonly sql: postgres.Sql
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl) }
  async findByIdempotencyKey(key: string, actor: string) { const rows = await this.sql<SubmissionRow[]>`SELECT * FROM marketplace_submissions WHERE idempotency_key=${key} AND submitted_by=${actor} LIMIT 1`; return rows[0] ? mapSubmission(rows[0]) : undefined }
  async create(input: { id: string; fileName: string; size: number; actor: string; idempotencyKey: string }) {
    const objectKey = quarantinePackageKey(input.id)
    const rows = await this.sql<SubmissionRow[]>`INSERT INTO marketplace_submissions (id, object_key, status, submitted_by, idempotency_key, file_name, package_size) VALUES (${input.id}, ${objectKey}, 'uploading', ${input.actor}, ${input.idempotencyKey}, ${input.fileName}, ${input.size}) RETURNING *`
    return mapSubmission(rows[0]!)
  }
  async complete(id: string, actor: string, sha256: string) { const rows = await this.sql<SubmissionRow[]>`UPDATE marketplace_submissions SET status='validating', sha256=${sha256}, updated_at=now() WHERE id=${id} AND submitted_by=${actor} AND status='uploading' RETURNING *`; return rows[0] ? mapSubmission(rows[0]) : undefined }
  async list(actor?: string) { const rows = await this.sql<SubmissionRow[]>`SELECT * FROM marketplace_submissions WHERE ${actor ? this.sql`submitted_by=${actor}` : this.sql`true`} ORDER BY created_at DESC LIMIT 100`; return rows.map(mapSubmission) }
  async get(id: string) {
    const detail = await this.getInternal(id)
    if (!detail) return undefined
    const { objectKey: _objectKey, ...publicDetail } = detail
    return publicDetail
  }
  async getInternal(id: string): Promise<SubmissionInternalRecord | undefined> {
    const rows = await this.sql<SubmissionRow[]>`SELECT * FROM marketplace_submissions WHERE id=${id} LIMIT 1`
    const row = rows[0]
    if (!row) return undefined
    const issues = await this.sql<{ severity: 'error' | 'warning'; code: string; message: string; path: string | null }[]>`SELECT i.severity, i.code, i.message, i.path FROM marketplace_validation_issues i JOIN marketplace_validation_runs r ON r.id=i.run_id WHERE r.submission_id=${id} ORDER BY i.severity, i.code`
    const manifest = record(row.manifest)
    const files = Array.isArray(row.extracted_files) ? row.extracted_files.filter(isExtractedFile) : []
    return { ...mapSubmission(row), objectKey: row.object_key, ...(row.sha256 ? { sha256: row.sha256 } : {}), ...(Object.keys(manifest).length ? { manifest } : {}), ...(row.guide_markdown ? { guideMarkdown: row.guide_markdown } : {}), files, examples: Array.isArray(row.extracted_examples) ? row.extracted_examples : [], validationIssues: issues.map((issue) => ({ severity: issue.severity, code: issue.code, message: issue.message, ...(issue.path ? { path: issue.path } : {}) })) }
  }
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function isExtractedFile(value: unknown): value is { path: string; size: number; kind: string; content?: string } { const item = record(value); return typeof item.path === 'string' && typeof item.size === 'number' && typeof item.kind === 'string' }

function mapSubmission(row: SubmissionRow): MarketplaceSubmissionSummary & { packageSize: number } {
  return { id: row.id, fileName: row.file_name, packageSize: Number(row.package_size), status: row.status, submittedBy: row.submitted_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }
}
