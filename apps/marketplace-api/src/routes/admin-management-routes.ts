import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { MarketplaceAdminUser } from '@proma/shared'
import type { AdminAuthService } from '../auth/admin-auth.ts'
import type { AdminManagementService } from '../management/admin-management-service.ts'
import { SubmissionError } from '../submissions/submission-service.ts'

interface ManagementEnv { Variables: { managementUser: MarketplaceAdminUser; requestId: string } }
export function createAdminManagementRoutes(auth: AdminAuthService, service: AdminManagementService): Hono<ManagementEnv> {
  const routes = new Hono<ManagementEnv>()
  routes.use('*', async (context, next) => { const token = getCookie(context, 'proma_marketplace_session'); const user = token ? await auth.getSession(token) : undefined; if (!user) return context.json({ code: 'ADMIN_AUTH_REQUIRED', message: '请先登录管理后台', requestId: context.get('requestId') }, 401); context.set('managementUser', user); await next() })
  routes.get('/skills', async (context) => context.json(await service.listSkills(context.req.query('query'))))
  routes.get('/skills/:id/versions', async (context) => context.json(await service.listVersions(context.req.param('id'))))
  routes.post('/skills/:id/lifecycle', async (context) => { const body = await context.req.json() as { action?: string; reason?: string }; if (!['unlist', 'republish', 'archive'].includes(body.action ?? '')) return context.json({ code: 'VALIDATION_FAILED', message: '生命周期操作无效', requestId: context.get('requestId') }, 400); try { await service.lifecycle(context.req.param('id'), body.action as 'unlist' | 'republish' | 'archive', body.reason ?? '', context.get('managementUser').githubLogin); return context.json({ ok: true }) } catch (error) { if (error instanceof SubmissionError) return context.json({ code: error.code, message: error.message, requestId: context.get('requestId') }, error.status as 400); throw error } })
  routes.get('/audit', async (context) => context.json(await service.audit(context.req.query('skillId'))))
  return routes
}
