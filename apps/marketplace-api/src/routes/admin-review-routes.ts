import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AdminAuthService } from '../auth/admin-auth.ts'
import type { PostgresReviewService } from '../reviews/review-service.ts'
import { SubmissionError } from '../submissions/submission-service.ts'

const metadataSchema = z.object({
  authorHandle: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  authorName: z.string().min(1).max(100),
  category: z.string().min(1).max(64),
  displayName: z.string().min(1).max(100),
  description: z.string().min(10).max(500),
})
const schema = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().max(2000).optional(), metadata: metadataSchema.optional() })
export function createAdminReviewRoutes(auth: AdminAuthService, reviews: PostgresReviewService): Hono {
  const routes = new Hono()
  routes.post('/:id/decision', async (context) => {
    const token = getCookie(context, 'proma_marketplace_session')
    const user = token ? await auth.getSession(token) : undefined
    if (!user) return context.json({ code: 'ADMIN_AUTH_REQUIRED', message: '请先登录管理后台', requestId: context.get('requestId') }, 401)
    if (user.role === 'editor') return context.json({ code: 'ADMIN_ACCESS_DENIED', message: 'Editor 无权批准或驳回', requestId: context.get('requestId') }, 403)
    try { return context.json(await reviews.decide(context.req.param('id'), schema.parse(await context.req.json()), user)) }
    catch (error) { if (error instanceof SubmissionError) return context.json({ code: error.code, message: error.message, requestId: context.get('requestId') }, error.status as 400); throw error }
  })
  return routes
}
