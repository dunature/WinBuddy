import { Hono } from 'hono'
import type { MarketplaceGoldenPathAction } from '@proma/marketplace-domain'
import { MarketplaceAdminPublishError, performMarketplaceVersionAction } from './admin-publish'
import type { MarketplaceAppEnv } from './app'
import type { MarketplaceDatabase } from './database/client'

const goldenPathActions = new Set<MarketplaceGoldenPathAction>(['submit_review', 'approve', 'publish'])

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

export function createMarketplaceAdminPublishRouter(
  database: MarketplaceDatabase,
  storageDir: string,
): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()
  router.post('/skills/:skillId/versions/:versionId/actions/:action', async (context) => {
    try {
      const action = context.req.param('action') as MarketplaceGoldenPathAction
      if (!goldenPathActions.has(action)) {
        throw new MarketplaceAdminPublishError('VERSION_ACTION_UNKNOWN', '未知的版本动作', 400)
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
          reason: await actionReason(context.req.raw),
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
