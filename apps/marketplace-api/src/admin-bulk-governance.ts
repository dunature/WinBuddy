import { randomUUID } from 'node:crypto'
import type {
  MarketplaceBulkGovernanceAction,
  MarketplaceBulkGovernanceItemResult,
  MarketplaceBulkGovernanceResult,
  MarketplaceBulkGovernanceTarget,
} from '@proma/shared'
import type { AuthenticatedAdminSession } from './admin-auth'
import { MarketplaceAdminDraftError, deleteMarketplaceAdminSkill } from './admin-drafts'
import { MarketplaceAdminPublishError, performMarketplaceVersionAction } from './admin-publish'
import type { MarketplaceDatabase } from './database/client'

export interface MarketplaceBulkGovernanceContext {
  actor: AuthenticatedAdminSession
  requestId: string
  reason: string
  idempotencyKey: string
}

interface StoredSkillState {
  deleted_at: Date | string | null
}

function itemResult(
  target: MarketplaceBulkGovernanceTarget,
  outcome: MarketplaceBulkGovernanceItemResult['outcome'],
  code: string,
  message: string,
  retryable = false,
): MarketplaceBulkGovernanceItemResult {
  return { ...target, outcome, code, message, retryable }
}

async function auditOutcome(
  database: MarketplaceDatabase,
  action: MarketplaceBulkGovernanceAction,
  result: MarketplaceBulkGovernanceItemResult,
  context: MarketplaceBulkGovernanceContext,
): Promise<void> {
  await database.sql`
    INSERT INTO audit_entries (
      id, actor_id, actor_identifier, action, request_id, skill_id, version_id,
      before_state, after_state, reason
    ) VALUES (
      ${randomUUID()}, ${context.actor.adminId}, ${context.actor.username},
      ${`bulk.${action}.${result.outcome}`}, ${context.requestId}, ${result.skillId}, ${result.versionId ?? null},
      ${JSON.stringify({ key: result.key, skillId: result.skillId, versionId: result.versionId ?? null })}::jsonb,
      ${JSON.stringify(result)}::jsonb, ${context.reason}
    )
  `
}

function failureResult(
  target: MarketplaceBulkGovernanceTarget,
  error: unknown,
): MarketplaceBulkGovernanceItemResult {
  if (error instanceof MarketplaceAdminDraftError || error instanceof MarketplaceAdminPublishError) {
    return itemResult(target, 'failed', error.code, error.message)
  }
  console.error('[技能市场批量治理] 条目执行失败:', error)
  return itemResult(target, 'failed', 'BULK_ITEM_INTERNAL_ERROR', '条目执行失败，请稍后重试', true)
}

async function performVersionItem(
  database: MarketplaceDatabase,
  storageDir: string,
  action: 'unpublish' | 'archive',
  target: MarketplaceBulkGovernanceTarget,
  context: MarketplaceBulkGovernanceContext,
  index: number,
): Promise<MarketplaceBulkGovernanceItemResult> {
  if (!target.versionId) {
    return itemResult(target, 'failed', 'VERSION_TARGET_REQUIRED', '批量版本治理必须提供 versionId')
  }
  try {
    const result = await performMarketplaceVersionAction(
      database,
      storageDir,
      target.skillId,
      target.versionId,
      action,
      {
        actor: context.actor,
        requestId: context.requestId,
        reason: context.reason,
        idempotencyKey: `${context.idempotencyKey}:${index}`,
      },
    )
    return result.changed
      ? itemResult(target, 'succeeded', 'TARGET_UPDATED', '条目已达到目标状态')
      : itemResult(target, 'skipped', 'TARGET_ALREADY_STATE', '条目已处于目标状态')
  } catch (error) {
    return failureResult(target, error)
  }
}

async function performDeleteDraftItem(
  database: MarketplaceDatabase,
  target: MarketplaceBulkGovernanceTarget,
  context: MarketplaceBulkGovernanceContext,
): Promise<MarketplaceBulkGovernanceItemResult> {
  const rows = await database.sql<StoredSkillState[]>`
    SELECT deleted_at FROM skills WHERE id = ${target.skillId} LIMIT 1
  `
  const current = rows[0]
  if (!current) return itemResult(target, 'failed', 'SKILL_NOT_FOUND', 'Skill 不存在')
  if (current.deleted_at) {
    return itemResult(target, 'skipped', 'TARGET_ALREADY_DELETED', 'Skill 草稿已删除')
  }
  if (!target.revision) {
    return itemResult(target, 'failed', 'SKILL_REVISION_REQUIRED', '删除草稿必须提供 revision')
  }
  try {
    await deleteMarketplaceAdminSkill(database, target.skillId, target.revision, {
      actor: context.actor,
      requestId: context.requestId,
    })
    return itemResult(target, 'succeeded', 'TARGET_DELETED', 'Skill 草稿已删除')
  } catch (error) {
    return failureResult(target, error)
  }
}

export async function performMarketplaceBulkGovernance(
  database: MarketplaceDatabase,
  storageDir: string,
  action: MarketplaceBulkGovernanceAction,
  targets: MarketplaceBulkGovernanceTarget[],
  context: MarketplaceBulkGovernanceContext,
): Promise<MarketplaceBulkGovernanceResult> {
  const result: MarketplaceBulkGovernanceResult = { action, succeeded: [], skipped: [], failed: [] }
  for (const [index, target] of targets.entries()) {
    const item = action === 'delete_draft'
      ? await performDeleteDraftItem(database, target, context)
      : await performVersionItem(database, storageDir, action, target, context, index)
    await auditOutcome(database, action, item, context)
    result[item.outcome].push(item)
  }
  return result
}
