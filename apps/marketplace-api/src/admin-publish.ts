import { createHash, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Sql, TransactionSql } from 'postgres'
import {
  MarketplaceGoldenPathError,
  applyMarketplaceGoldenPathAction,
  type MarketplaceGoldenPathAction,
  type MarketplaceSkillStatus,
  type MarketplaceVersionStatus,
} from '@proma/marketplace-domain'
import type { MarketplaceAdminVersionActionResult } from '@proma/shared'
import type { AuthenticatedAdminSession } from './admin-auth'
import { getMarketplaceAdminSkill } from './admin-drafts'
import type { MarketplaceDatabase } from './database/client'
import {
  extractMarketplaceZipPackage,
  inspectMarketplaceZipPackage,
  type ExtractedMarketplaceFile,
} from './package-validation'

export class MarketplaceAdminPublishError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'MarketplaceAdminPublishError'
  }
}

export interface MarketplaceAdminPublishContext {
  actor: AuthenticatedAdminSession
  requestId: string
  reason: string
}

interface PublishStateRow {
  skill_id: string
  identifier: string
  skill_status: MarketplaceSkillStatus
  current_published_version_id: string | null
  skill_revision: number
  version_id: string
  version: string
  version_status: MarketplaceVersionStatus
  version_revision: number
}

interface ValidatedUploadRow {
  id: string
  storage_key: string
  sha256: string
}

type MarketplaceSql = Sql | TransactionSql

function actionLabel(action: MarketplaceGoldenPathAction): string {
  if (action === 'submit_review') return '提交审核'
  if (action === 'approve') return '批准版本'
  return '发布版本'
}

function mapGoldenPathError(error: MarketplaceGoldenPathError): MarketplaceAdminPublishError {
  if (error.code === 'MARKETPLACE_PUBLISHED_POINTER_MISMATCH') {
    return new MarketplaceAdminPublishError('PUBLISHED_POINTER_MISMATCH', '已发布版本与线上指针不一致', 409)
  }
  return new MarketplaceAdminPublishError('VERSION_ACTION_NOT_ALLOWED', '当前版本状态不允许执行该动作', 409)
}

async function readPublishState(
  sql: MarketplaceSql,
  skillId: string,
  versionId: string,
  lock = false,
): Promise<PublishStateRow | null> {
  const lockClause = lock ? sql`FOR UPDATE OF versions, skills` : sql``
  const rows = await sql<PublishStateRow[]>`
    SELECT skills.id AS skill_id, skills.identifier, skills.status AS skill_status,
      skills.current_published_version_id, skills.revision AS skill_revision,
      versions.id AS version_id, versions.version, versions.status AS version_status,
      versions.revision AS version_revision
    FROM skill_versions versions
    INNER JOIN skills ON skills.id = versions.skill_id
    WHERE skills.id = ${skillId} AND versions.id = ${versionId} AND skills.deleted_at IS NULL
    ${lockClause}
  `
  return rows[0] ?? null
}

function transition(row: PublishStateRow, action: MarketplaceGoldenPathAction) {
  try {
    return applyMarketplaceGoldenPathAction({
      action,
      versionId: row.version_id,
      versionStatus: row.version_status,
      skillStatus: row.skill_status,
      currentPublishedVersionId: row.current_published_version_id,
    })
  } catch (error) {
    if (error instanceof MarketplaceGoldenPathError) throw mapGoldenPathError(error)
    throw error
  }
}

function auditState(row: PublishStateRow, changed: boolean, status = row.version_status) {
  return {
    versionId: row.version_id,
    status,
    skillStatus: row.skill_status,
    currentPublishedVersionId: row.current_published_version_id,
    versionRevision: row.version_revision,
    skillRevision: row.skill_revision,
    changed,
  }
}

async function insertActionAudit(
  sql: MarketplaceSql,
  row: PublishStateRow,
  action: MarketplaceGoldenPathAction,
  after: ReturnType<typeof transition>,
  context: MarketplaceAdminPublishContext,
): Promise<void> {
  await sql`
    INSERT INTO audit_entries (
      id, actor_id, actor_identifier, action, request_id, before_state, after_state, reason
    ) VALUES (
      ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username},
      ${`skill_version.${action}`}, ${context.requestId},
      ${JSON.stringify(auditState(row, false))}::jsonb,
      ${JSON.stringify({
        ...auditState(row, after.changed, after.versionStatus),
        skillStatus: after.skillStatus,
        currentPublishedVersionId: after.currentPublishedVersionId,
        versionRevision: row.version_revision + (after.changed ? 1 : 0),
        skillRevision: row.skill_revision + (after.changed && action === 'publish' ? 1 : 0),
      })}::jsonb,
      ${context.reason || `${actionLabel(action)}${after.changed ? '' : '（幂等重试）'}`}
    )
  `
}

async function actionResult(
  database: MarketplaceDatabase,
  skillId: string,
  versionId: string,
  action: MarketplaceGoldenPathAction,
  changed: boolean,
): Promise<MarketplaceAdminVersionActionResult> {
  const skill = await getMarketplaceAdminSkill(database, skillId)
  const version = skill?.versions.find((item) => item.id === versionId)
  if (!skill || !version) throw new Error('版本动作完成后无法读取结果')
  return { action, changed, skill, version }
}

async function performReviewAction(
  database: MarketplaceDatabase,
  skillId: string,
  versionId: string,
  action: 'submit_review' | 'approve',
  context: MarketplaceAdminPublishContext,
): Promise<MarketplaceAdminVersionActionResult> {
  const changed = await database.sql.begin(async (transaction) => {
    const row = await readPublishState(transaction, skillId, versionId, true)
    if (!row) throw new MarketplaceAdminPublishError('VERSION_NOT_FOUND', '候选版本不存在', 404)
    const after = transition(row, action)
    if (action === 'submit_review' && after.changed) {
      const uploads = await transaction<{ id: string }[]>`
        SELECT uploads.id FROM uploads
        INNER JOIN validation_reports reports ON reports.upload_id = uploads.id
        WHERE uploads.skill_version_id = ${versionId}
          AND uploads.status = 'succeeded' AND reports.passed = true
        ORDER BY uploads.completed_at DESC, uploads.id DESC
        LIMIT 1
      `
      if (!uploads[0]) {
        throw new MarketplaceAdminPublishError('VERSION_VALIDATION_REQUIRED', '请先上传并通过 Skill 包校验', 409)
      }
    }
    if (after.changed) {
      await transaction`
        UPDATE skill_versions SET status = ${after.versionStatus}, revision = revision + 1, updated_at = now()
        WHERE id = ${versionId}
      `
    }
    await insertActionAudit(transaction, row, action, after, context)
    return after.changed
  })
  return actionResult(database, skillId, versionId, action, changed)
}

async function latestValidatedUpload(
  database: MarketplaceDatabase,
  versionId: string,
): Promise<ValidatedUploadRow | null> {
  const rows = await database.sql<ValidatedUploadRow[]>`
    SELECT uploads.id, uploads.storage_key, uploads.sha256
    FROM uploads
    INNER JOIN validation_reports reports ON reports.upload_id = uploads.id
    WHERE uploads.skill_version_id = ${versionId}
      AND uploads.status = 'succeeded' AND reports.passed = true
    ORDER BY uploads.completed_at DESC, uploads.id DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function performPublishAction(
  database: MarketplaceDatabase,
  storageDir: string,
  skillId: string,
  versionId: string,
  context: MarketplaceAdminPublishContext,
): Promise<MarketplaceAdminVersionActionResult> {
  const initial = await readPublishState(database.sql, skillId, versionId)
  if (!initial) throw new MarketplaceAdminPublishError('VERSION_NOT_FOUND', '候选版本不存在', 404)
  const initialTransition = transition(initial, 'publish')
  if (!initialTransition.changed) {
    const changed = await database.sql.begin(async (transaction) => {
      const current = await readPublishState(transaction, skillId, versionId, true)
      if (!current) throw new MarketplaceAdminPublishError('VERSION_NOT_FOUND', '候选版本不存在', 404)
      const after = transition(current, 'publish')
      await insertActionAudit(transaction, current, 'publish', after, context)
      return after.changed
    })
    return actionResult(database, skillId, versionId, 'publish', changed)
  }

  const upload = await latestValidatedUpload(database, versionId)
  if (!upload || !/^quarantine\/[a-f0-9-]+\.zip$/.test(upload.storage_key)) {
    throw new MarketplaceAdminPublishError('VERSION_VALIDATION_REQUIRED', '请先上传并通过 Skill 包校验', 409)
  }
  const archivePath = join(storageDir, upload.storage_key)
  const archive = new Uint8Array(await Bun.file(archivePath).arrayBuffer())
  if (createHash('sha256').update(archive).digest('hex') !== upload.sha256) {
    throw new MarketplaceAdminPublishError('PUBLISH_PACKAGE_HASH_MISMATCH', '发布包完整性校验失败', 409)
  }
  const validation = await inspectMarketplaceZipPackage(archivePath, initial.identifier, initial.version)
  if (!validation.passed) {
    throw new MarketplaceAdminPublishError('PUBLISH_PACKAGE_VALIDATION_FAILED', '发布前复检未通过', 409)
  }

  const stagingDirectory = join(storageDir, 'published', '.staging', randomUUID())
  const finalDirectory = join(storageDir, 'published', initial.identifier, initial.version)
  let files: ExtractedMarketplaceFile[] = []
  let finalMoved = false
  let changed = false
  try {
    await mkdir(stagingDirectory, { recursive: true })
    await copyFile(archivePath, join(stagingDirectory, 'package.zip'))
    files = await extractMarketplaceZipPackage(
      archivePath,
      initial.identifier,
      join(stagingDirectory, 'content'),
    )
    changed = await database.sql.begin(async (transaction) => {
      const row = await readPublishState(transaction, skillId, versionId, true)
      if (!row) throw new MarketplaceAdminPublishError('VERSION_NOT_FOUND', '候选版本不存在', 404)
      const after = transition(row, 'publish')
      if (!after.changed) {
        await insertActionAudit(transaction, row, 'publish', after, context)
        return false
      }
      if (await pathExists(finalDirectory)) {
        throw new MarketplaceAdminPublishError('PUBLISHED_PACKAGE_CONFLICT', '目标发布目录已存在', 409)
      }
      await mkdir(dirname(finalDirectory), { recursive: true })
      await rename(stagingDirectory, finalDirectory)
      finalMoved = true

      if (row.current_published_version_id && row.current_published_version_id !== versionId) {
        await transaction`
          UPDATE skill_versions SET status = 'unpublished', revision = revision + 1, updated_at = now()
          WHERE id = ${row.current_published_version_id} AND status = 'published'
        `
      }
      await transaction`DELETE FROM version_files WHERE version_id = ${versionId}`
      for (const file of files) {
        await transaction`
          INSERT INTO version_files (version_id, path, size, is_text, content)
          VALUES (${versionId}, ${file.path}, ${file.size}, ${file.isText}, ${file.content ?? null})
        `
      }
      await transaction`
        UPDATE skill_versions SET status = 'published', published_at = now(),
          revision = revision + 1, updated_at = now()
        WHERE id = ${versionId}
      `
      await transaction`
        UPDATE skills SET status = 'published', current_published_version_id = ${versionId},
          revision = revision + 1, updated_at = now()
        WHERE id = ${skillId}
      `
      await insertActionAudit(transaction, row, 'publish', after, context)
      return true
    })
  } catch (error) {
    if (finalMoved) {
      await rm(finalDirectory, { recursive: true, force: true }).catch((cleanupError) => {
        console.error('[技能市场发布] 回滚发布目录失败:', cleanupError)
      })
    }
    throw error
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch((cleanupError) => {
      console.error('[技能市场发布] 清理 staging 目录失败:', cleanupError)
    })
  }
  return actionResult(database, skillId, versionId, 'publish', changed)
}

export async function performMarketplaceVersionAction(
  database: MarketplaceDatabase,
  storageDir: string,
  skillId: string,
  versionId: string,
  action: MarketplaceGoldenPathAction,
  context: MarketplaceAdminPublishContext,
): Promise<MarketplaceAdminVersionActionResult> {
  if (action === 'publish') {
    return performPublishAction(database, storageDir, skillId, versionId, context)
  }
  return performReviewAction(database, skillId, versionId, action, context)
}
