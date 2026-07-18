import { Hono } from 'hono'
import type { MarketplaceVersionGovernanceAction } from '@proma/marketplace-domain'
import { MarketplaceAdminPublishError, performMarketplaceVersionAction } from './admin-publish'
import type { MarketplaceAppEnv } from './app'
import type { MarketplaceDatabase } from './database/client'

const governanceActions = new Set<MarketplaceVersionGovernanceAction>([
  'submit_review',
  'approve',
  'reject',
  'return_to_edit',
  'withdraw',
  'publish',
  'unpublish',
  'republish',
  'archive',
])

const reasonRequiredActions = new Set<MarketplaceVersionGovernanceAction>([
  'reject',
  'return_to_edit',
  'withdraw',
  'unpublish',
  'archive',
])

async function actionReason(request: Request): Promise<string> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MarketplaceAdminPublishError('INVALID_REQUEST', '请求体格式不正确', 400)
  }
  const reason = (body as Record<string, unknown>).reason
  if (reason === undefined || reason === null || reason === '') return ''
  if (typeof reason !== 'string' || reason.trim().length > 2_000) {
    throw new MarketplaceAdminPublishError('INVALID_REQUEST', '操作原因不能超过 2000 个字符', 400)
  }
  return reason.trim()
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new MarketplaceAdminPublishError('IDEMPOTENCY_KEY_REQUIRED', '请提供 8 到 128 个字符的有效幂等键', 400)
  }
  return value
}

export function createMarketplaceAdminPublishRouter(
  database: MarketplaceDatabase,
  storageDir: string,
): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()
  router.post('/skills/:skillId/versions/:versionId/actions/:action', async (context) => {
    try {
      const action = context.req.param('action') as MarketplaceVersionGovernanceAction
      if (!governanceActions.has(action)) {
        throw new MarketplaceAdminPublishError('VERSION_ACTION_UNKNOWN', '未知的版本动作', 400)
      }
      const reason = await actionReason(context.req.raw)
      if (reasonRequiredActions.has(action) && !reason) {
        throw new MarketplaceAdminPublishError('ACTION_REASON_REQUIRED', '该版本动作必须填写原因', 400)
      }
      const result = await performMarketplaceVersionAction(
        database,
        storageDir,
        context.req.param('skillId'),
        context.req.param('versionId'),
        action,
        {
          actor: context.get('adminSession'),
          requestId: context.get('requestId'),
          reason,
          idempotencyKey: idempotencyKey(context.req.raw),
        },
      )
      return context.json({ data: result, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminPublishError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })
  return router
}
