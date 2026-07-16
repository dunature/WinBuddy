import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AdminAuthService } from '../auth/admin-auth.ts'
import type { MarketplaceAdminUser } from '@proma/shared'
import { SubmissionError, type SubmissionService } from '../submissions/submission-service.ts'

const createSchema = z.object({ fileName: z.string().min(1).max(200), size: z.number().int().positive(), idempotencyKey: z.string().min(8).max(100) })
const completeSchema = z.object({ sha256: z.string().length(64) })

interface AdminRouteEnv { Variables: { adminUser: MarketplaceAdminUser; requestId: string } }

export function createAdminSubmissionRoutes(auth: AdminAuthService, service: SubmissionService): Hono<AdminRouteEnv> {
  const routes = new Hono<AdminRouteEnv>()
  routes.use('*', async (context, next) => {
    const token = getCookie(context, 'proma_marketplace_session')
    const user = token ? await auth.getSession(token) : undefined
    if (!user) return context.json({ code: 'ADMIN_AUTH_REQUIRED', message: '请先登录管理后台', requestId: context.get('requestId') }, 401)
    context.set('adminUser', user)
    await next()
  })
  routes.get('/', async (context) => context.json(await service.list(context.get('adminUser'))))
  routes.get('/:id', async (context) => {
    const submission = await service.get(context.req.param('id'), context.get('adminUser'))
    return submission ? context.json(submission) : context.json({ code: 'SUBMISSION_NOT_FOUND', message: '找不到该上传记录', requestId: context.get('requestId') }, 404)
  })
  routes.post('/', async (context) => handle(context, async () => service.create(createSchema.parse(await context.req.json()), context.get('adminUser'))))
  routes.post('/:id/complete', async (context) => handle(context, async () => service.complete(context.req.param('id'), completeSchema.parse(await context.req.json()).sha256, context.get('adminUser'))))
  return routes
}

async function handle(context: Context<AdminRouteEnv>, operation: () => Promise<unknown>) {
  try { return context.json(await operation()) }
  catch (error) {
    if (error instanceof SubmissionError) return context.json({ code: error.code, message: error.message, requestId: context.get('requestId') }, error.status as 400)
    if (error instanceof z.ZodError) return context.json({ code: 'VALIDATION_FAILED', message: '请求参数无效', requestId: context.get('requestId') }, 400)
    throw error
  }
}
