import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, rename, rm } from 'node:fs/promises'
import { MARKETPLACE_ZIP_LIMITS, type MarketplacePackageValidationResult } from '@proma/marketplace-domain'
import type {
  MarketplaceAdminUpload,
  MarketplaceUploadStatus,
  MarketplaceValidationCheck,
  MarketplaceValidationReport,
  MarketplaceVersionStatus,
} from '@proma/shared'
import type { AuthenticatedAdminSession } from './admin-auth'
import type { MarketplaceDatabase } from './database/client'
import { inspectMarketplaceZipPackage } from './package-validation'

export class MarketplaceAdminUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409 | 413,
  ) {
    super(message)
    this.name = 'MarketplaceAdminUploadError'
  }
}

export interface MarketplaceAdminUploadContext {
  actor: AuthenticatedAdminSession
  requestId: string
}

interface UploadTargetRow {
  skill_id: string
  version_id: string
  version: string
  version_status: MarketplaceVersionStatus
  version_revision: number
  identifier: string
}

interface UploadJobRow extends UploadTargetRow {
  id: string
  storage_key: string
  sha256: string
  size: number
  attempt_count: number
}

interface UploadDetailRow {
  id: string
  version_id: string
  original_filename: string
  sha256: string
  size: number
  status: MarketplaceUploadStatus
  attempt_count: number
  last_error: string | null
  created_at: Date | string
  updated_at: Date | string
  version_status: MarketplaceVersionStatus
  version_revision: number
  report_id: string | null
  report_passed: boolean | null
  report_checks: MarketplaceValidationCheck[] | null
  report_manifest: MarketplaceValidationReport['manifest']
  root_directory: string | null
  file_count: number | null
  expanded_size: number | null
  report_created_at: Date | string | null
}

const editableVersionStatuses = new Set<MarketplaceVersionStatus>(['created', 'validation_failed', 'rejected'])

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toAdminUpload(row: UploadDetailRow): MarketplaceAdminUpload {
  const report = row.report_id && row.report_created_at && row.report_passed !== null
    && row.file_count !== null && row.expanded_size !== null
    ? {
        id: row.report_id,
        passed: row.report_passed,
        checks: row.report_checks ?? [],
        manifest: row.report_manifest ?? null,
        rootDirectory: row.root_directory,
        fileCount: row.file_count,
        expandedSize: row.expanded_size,
        createdAt: timestamp(row.report_created_at),
      }
    : null
  return {
    id: row.id,
    versionId: row.version_id,
    originalFilename: row.original_filename,
    sha256: row.sha256,
    size: row.size,
    status: row.status,
    attemptCount: row.attempt_count,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    versionStatus: row.version_status,
    versionRevision: row.version_revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    report,
  }
}

function uploadFilename(request: Request): string {
  const header = request.headers.get('x-file-name')
  if (!header) throw new MarketplaceAdminUploadError('UPLOAD_FILENAME_REQUIRED', '缺少上传文件名', 400)
  let decoded: string
  try {
    decoded = decodeURIComponent(header)
  } catch {
    throw new MarketplaceAdminUploadError('UPLOAD_FILENAME_INVALID', '上传文件名编码无效', 400)
  }
  const filename = decoded.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? ''
  if (!filename || filename.length > 255 || filename.includes('\0') || !filename.toLowerCase().endsWith('.zip')) {
    throw new MarketplaceAdminUploadError('UPLOAD_FILENAME_INVALID', '上传文件必须是有效的 ZIP 文件名', 400)
  }
  return filename
}

function validateUploadRequest(request: Request): void {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/zip' && contentType !== 'application/octet-stream') {
    throw new MarketplaceAdminUploadError('UPLOAD_CONTENT_TYPE_INVALID', '上传内容必须是 ZIP', 400)
  }
  const contentLengthValue = request.headers.get('content-length')
  if (!contentLengthValue) return
  const contentLength = Number(contentLengthValue)
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new MarketplaceAdminUploadError('UPLOAD_CONTENT_LENGTH_INVALID', 'Content-Length 无效', 400)
  }
  if (contentLength > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
    throw new MarketplaceAdminUploadError('UPLOAD_TOO_LARGE', 'ZIP 不能超过 20 MB', 413)
  }
}

async function streamUploadToDisk(
  request: Request,
  incomingPath: string,
  archivePath: string,
): Promise<{ size: number; sha256: string }> {
  if (!request.body) throw new MarketplaceAdminUploadError('UPLOAD_BODY_REQUIRED', '上传内容不能为空', 400)
  const reader = request.body.getReader()
  const writer = Bun.file(incomingPath).writer()
  const hasher = new Bun.CryptoHasher('sha256')
  let size = 0
  let writerOpen = true
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
        await reader.cancel()
        throw new MarketplaceAdminUploadError('UPLOAD_TOO_LARGE', 'ZIP 不能超过 20 MB', 413)
      }
      hasher.update(chunk.value)
      writer.write(chunk.value)
    }
    await writer.end()
    writerOpen = false
    if (size === 0) throw new MarketplaceAdminUploadError('UPLOAD_BODY_REQUIRED', '上传内容不能为空', 400)
    await rename(incomingPath, archivePath)
    return { size, sha256: hasher.digest('hex') }
  } catch (error) {
    if (writerOpen) {
      try {
        await writer.end()
      } catch {
        // 清理原始错误时忽略 writer 关闭错误。
      }
    }
    await rm(incomingPath, { force: true })
    await rm(archivePath, { force: true })
    throw error
  }
}

export class MarketplaceUploadManager {
  private readonly ready: Promise<void>
  private processing = false
  private requested = false

  constructor(
    private readonly database: MarketplaceDatabase,
    private readonly storageDir: string,
  ) {
    this.ready = this.initialize()
    void this.ready.then(() => this.schedule())
  }

  private async initialize(): Promise<void> {
    await mkdir(join(this.storageDir, 'quarantine', '.incoming'), { recursive: true })
    await this.database.sql`
      UPDATE uploads SET status = 'queued', started_at = NULL, updated_at = now()
      WHERE status = 'running'
    `
  }

  private schedule(): void {
    this.requested = true
    if (this.processing) return
    this.processing = true
    queueMicrotask(() => { void this.processRequestedJobs() })
  }

  private async processRequestedJobs(): Promise<void> {
    try {
      while (this.requested) {
        this.requested = false
        while (true) {
          const job = await this.claimNextJob()
          if (!job) break
          try {
            await this.validateJob(job)
          } catch (error) {
            console.error(`[技能市场校验] 任务失败并等待服务重启恢复: ${job.id}`, error)
            break
          }
        }
      }
    } finally {
      this.processing = false
      if (this.requested) this.schedule()
    }
  }

  private async claimNextJob(): Promise<UploadJobRow | null> {
    return await this.database.sql.begin(async (transaction) => {
      const rows = await transaction<UploadJobRow[]>`
        SELECT uploads.id, uploads.storage_key, uploads.sha256, uploads.size, uploads.attempt_count,
          versions.id AS version_id, versions.version, versions.status AS version_status,
          versions.revision AS version_revision, versions.skill_id, skills.identifier
        FROM uploads
        INNER JOIN skill_versions versions ON versions.id = uploads.skill_version_id
        INNER JOIN skills ON skills.id = versions.skill_id
        WHERE uploads.status = 'queued'
        ORDER BY uploads.created_at, uploads.id
        FOR UPDATE OF uploads SKIP LOCKED
        LIMIT 1
      `
      const job = rows[0]
      if (!job) return null
      const attempts = job.attempt_count + 1
      await transaction`
        UPDATE uploads SET status = 'running', attempt_count = ${attempts},
          started_at = now(), completed_at = NULL, last_error = NULL, updated_at = now()
        WHERE id = ${job.id}
      `
      return { ...job, attempt_count: attempts }
    })
  }

  private async validateJob(job: UploadJobRow): Promise<void> {
    const result = await inspectMarketplaceZipPackage(
      join(this.storageDir, job.storage_key),
      job.identifier,
      job.version,
    )
    const reportId = randomUUID()
    const firstFailure = result.checks.find((check) => !check.passed)
    await this.database.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO validation_reports (
          id, upload_id, passed, checks, manifest, root_directory, file_count, expanded_size
        ) VALUES (
          ${reportId}, ${job.id}, ${result.passed}, ${JSON.stringify(result.checks)}::jsonb,
          ${result.manifest ? JSON.stringify(result.manifest) : null}::jsonb,
          ${result.rootDirectory}, ${result.fileCount}, ${result.expandedSize}
        )
      `
      await transaction`
        UPDATE uploads SET status = ${result.passed ? 'succeeded' : 'failed'},
          last_error = ${firstFailure?.message ?? null}, completed_at = now(), updated_at = now()
        WHERE id = ${job.id} AND status = 'running'
      `
      if (result.passed) {
        await transaction`
          UPDATE skill_versions SET status = 'created', sha256 = ${job.sha256}, size = ${job.size},
            file_count = ${result.fileCount}, revision = revision + 1, updated_at = now()
          WHERE id = ${job.version_id}
        `
      } else {
        await transaction`
          UPDATE skill_versions SET status = 'validation_failed', revision = revision + 1, updated_at = now()
          WHERE id = ${job.version_id}
        `
      }
      await transaction`
        INSERT INTO audit_entries (
          id, actor_identifier, action, request_id, skill_id, version_id, after_state, reason
        ) VALUES (
          ${randomUUID()}, 'marketplace-validation-worker', 'skill_version.validated',
          ${`validation:${job.id}`}, ${job.skill_id}, ${job.version_id},
          ${JSON.stringify({
            uploadId: job.id,
            versionId: job.version_id,
            passed: result.passed,
            versionStatus: result.passed ? 'created' : 'validation_failed',
          })}::jsonb,
          ${result.passed ? 'Skill 包自动校验通过' : firstFailure?.message ?? 'Skill 包自动校验失败'}
        )
      `
    })
  }

  private async target(skillId: string, versionId: string): Promise<UploadTargetRow | null> {
    const rows = await this.database.sql<UploadTargetRow[]>`
      SELECT versions.id AS version_id, versions.version, versions.status AS version_status,
        versions.revision AS version_revision, versions.skill_id, skills.identifier
      FROM skill_versions versions
      INNER JOIN skills ON skills.id = versions.skill_id
      WHERE versions.id = ${versionId} AND versions.skill_id = ${skillId} AND skills.deleted_at IS NULL
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async create(
    skillId: string,
    versionId: string,
    request: Request,
    context: MarketplaceAdminUploadContext,
  ): Promise<MarketplaceAdminUpload> {
    await this.ready
    const target = await this.target(skillId, versionId)
    if (!target) throw new MarketplaceAdminUploadError('VERSION_NOT_FOUND', '候选版本不存在', 404)
    if (!editableVersionStatuses.has(target.version_status)) {
      throw new MarketplaceAdminUploadError('VERSION_NOT_UPLOADABLE', '当前状态的版本不能重新上传', 409)
    }
    validateUploadRequest(request)
    const originalFilename = uploadFilename(request)
    const uploadId = randomUUID()
    const storageKey = `quarantine/${uploadId}.zip`
    const incomingPath = join(this.storageDir, 'quarantine', '.incoming', `${uploadId}.part`)
    const archivePath = join(this.storageDir, storageKey)
    const streamed = await streamUploadToDisk(request, incomingPath, archivePath)

    try {
      await this.database.sql.begin(async (transaction) => {
        const locked = await transaction<Pick<UploadTargetRow, 'version_status'>[]>`
          SELECT status AS version_status FROM skill_versions
          WHERE id = ${versionId} AND skill_id = ${skillId}
          FOR UPDATE
        `
        if (!locked[0] || !editableVersionStatuses.has(locked[0].version_status)) {
          throw new MarketplaceAdminUploadError('VERSION_NOT_UPLOADABLE', '当前状态的版本不能重新上传', 409)
        }
        await transaction`
          INSERT INTO uploads (
            id, skill_version_id, original_filename, storage_key, sha256, size, status, created_by
          ) VALUES (
            ${uploadId}, ${versionId}, ${originalFilename}, ${storageKey},
            ${streamed.sha256}, ${streamed.size}, 'queued', ${context.actor.adminId}
          )
        `
        await transaction`
          INSERT INTO audit_entries (
            id, actor_id, actor_identifier, action, request_id, skill_id, version_id, after_state, reason
          ) VALUES (
            ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username},
            'skill_version.uploaded', ${context.requestId}, ${skillId}, ${versionId},
            ${JSON.stringify({ uploadId, versionId, sha256: streamed.sha256, size: streamed.size })}::jsonb,
            '管理员上传 Skill 候选版本包'
          )
        `
      })
    } catch (error) {
      await rm(archivePath, { force: true })
      throw error
    }

    this.schedule()
    const upload = await this.get(skillId, versionId, uploadId)
    if (!upload) throw new Error('上传记录创建后无法读取')
    return upload
  }

  async get(skillId: string, versionId: string, uploadId: string): Promise<MarketplaceAdminUpload | null> {
    await this.ready
    const rows = await this.database.sql<UploadDetailRow[]>`
      SELECT uploads.id, uploads.skill_version_id AS version_id, uploads.original_filename,
        uploads.sha256, uploads.size, uploads.status, uploads.attempt_count, uploads.last_error,
        uploads.created_at, uploads.updated_at, versions.status AS version_status,
        versions.revision AS version_revision, reports.id AS report_id,
        reports.passed AS report_passed, reports.checks AS report_checks,
        reports.manifest AS report_manifest, reports.root_directory, reports.file_count,
        reports.expanded_size, reports.created_at AS report_created_at
      FROM uploads
      INNER JOIN skill_versions versions ON versions.id = uploads.skill_version_id
      INNER JOIN skills ON skills.id = versions.skill_id
      LEFT JOIN validation_reports reports ON reports.upload_id = uploads.id
      WHERE uploads.id = ${uploadId} AND versions.id = ${versionId}
        AND versions.skill_id = ${skillId} AND skills.deleted_at IS NULL
      LIMIT 1
    `
    return rows[0] ? toAdminUpload(rows[0]) : null
  }

  async list(skillId: string, versionId: string): Promise<MarketplaceAdminUpload[]> {
    await this.ready
    const rows = await this.database.sql<UploadDetailRow[]>`
      SELECT uploads.id, uploads.skill_version_id AS version_id, uploads.original_filename,
        uploads.sha256, uploads.size, uploads.status, uploads.attempt_count, uploads.last_error,
        uploads.created_at, uploads.updated_at, versions.status AS version_status,
        versions.revision AS version_revision, reports.id AS report_id,
        reports.passed AS report_passed, reports.checks AS report_checks,
        reports.manifest AS report_manifest, reports.root_directory, reports.file_count,
        reports.expanded_size, reports.created_at AS report_created_at
      FROM uploads
      INNER JOIN skill_versions versions ON versions.id = uploads.skill_version_id
      INNER JOIN skills ON skills.id = versions.skill_id
      LEFT JOIN validation_reports reports ON reports.upload_id = uploads.id
      WHERE versions.id = ${versionId} AND versions.skill_id = ${skillId} AND skills.deleted_at IS NULL
      ORDER BY uploads.created_at DESC, uploads.id DESC
    `
    return rows.map(toAdminUpload)
  }
}
