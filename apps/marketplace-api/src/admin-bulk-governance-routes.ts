import { Hono, type Context } from 'hono'
import type { MarketplaceBulkGovernanceAction, MarketplaceBulkGovernanceTarget } from '@proma/shared'
import { performMarketplaceBulkGovernance } from './admin-bulk-governance'
import type { MarketplaceAppEnv } from './app'
import type { MarketplaceDatabase } from './database/client'

const actions = new Set<MarketplaceBulkGovernanceAction>(['unpublish', 'archive', 'delete_draft'])

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= maxLength
}

function invalid(context: Context<MarketplaceAppEnv>, message: string) {
  return context.json({
    error: { code: 'INVALID_REQUEST', message },
    requestId: context.get('requestId'),
  }, 400)
}

export function createMarketplaceAdminBulkGovernanceRouter(
  database: MarketplaceDatabase,
  storageDir: string,
): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()
  router.post('/bulk-actions/:action', async (context) => {
    const action = context.req.param('action') as MarketplaceBulkGovernanceAction
    if (!actions.has(action)) return invalid(context, '未知的批量治理动作')
    const idempotencyKey = context.req.header('idempotency-key')?.trim()
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,80}$/.test(idempotencyKey)) {
      return invalid(context, '请提供 8 到 80 个字符的有效幂等键')
    }
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return invalid(context, '请求体必须是有效 JSON')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(context, '请求体格式不正确')
    const source = body as Record<string, unknown>
    if (!validText(source.reason, 2_000)) return invalid(context, '批量治理必须填写原因')
    if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 100) {
      return invalid(context, '批量条目数量必须在 1 到 100 之间')
    }
    const targets: MarketplaceBulkGovernanceTarget[] = []
    for (const value of source.items) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(context, '批量条目格式不正确')
      const item = value as Record<string, unknown>
      if (!validText(item.key, 64) || !validText(item.skillId, 100)) {
        return invalid(context, '批量条目必须提供有效 key 和 skillId')
      }
      if (item.versionId !== undefined && !validText(item.versionId, 100)) return invalid(context, 'versionId 格式不正确')
      if (item.revision !== undefined && (!Number.isInteger(item.revision) || (item.revision as number) < 1)) {
        return invalid(context, 'revision 必须是正整数')
      }
      targets.push({
        key: item.key.trim(),
        skillId: item.skillId.trim(),
        ...(typeof item.versionId === 'string' ? { versionId: item.versionId.trim() } : {}),
        ...(typeof item.revision === 'number' ? { revision: item.revision } : {}),
        ...(validText(item.label, 200) ? { label: item.label.trim() } : {}),
      })
    }
    const result = await performMarketplaceBulkGovernance(database, storageDir, action, targets, {
      actor: context.get('adminSession'),
      requestId: context.get('requestId'),
      reason: source.reason.trim(),
      idempotencyKey,
    })
    return context.json({ data: result, requestId: context.get('requestId') })
  })
  return router
}
