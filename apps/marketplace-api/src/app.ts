import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import type { MarketplaceApiError } from '@proma/shared'
import type { MarketplaceApiConfig } from './config.ts'
import { MarketplaceApiException } from './errors.ts'
import { createMarketplacePublicRoutes, type MarketplacePublicRouteServices } from './routes/public-routes.ts'
import type { AdminAuthService } from './auth/admin-auth.ts'
import { createAdminAuthRoutes } from './routes/admin-auth-routes.ts'
import type { SubmissionService } from './submissions/submission-service.ts'
import { createAdminSubmissionRoutes } from './routes/admin-submission-routes.ts'
import type { PostgresReviewService } from './reviews/review-service.ts'
import { createAdminReviewRoutes } from './routes/admin-review-routes.ts'
import type { AdminManagementService } from './management/admin-management-service.ts'
import { createAdminManagementRoutes } from './routes/admin-management-routes.ts'

export interface CreateMarketplaceAppOptions {
  config: MarketplaceApiConfig
  version?: string
  services?: MarketplacePublicRouteServices
  adminAuth?: AdminAuthService
  submissions?: SubmissionService
  reviews?: PostgresReviewService
  management?: AdminManagementService
}

export function createMarketplaceApp(options: CreateMarketplaceAppOptions): Hono {
  const app = new Hono()

  app.use('*', requestId())
  app.use('*', cors({
    origin: (origin) => options.config.publicOrigins.includes(origin) ? origin : options.config.publicOrigins[0] ?? '',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Request-Id'],
    credentials: true,
  }))

  app.get('/health', (context) => context.json({
    status: 'ok',
    version: options.version ?? '0.1.0',
  }))
  app.get('/api/v1/features', (context) => context.json(options.config.features))

  if (options.services) app.route('/api/v1', createMarketplacePublicRoutes(options.services, options.config.features))
  if (options.adminAuth && options.config.adminEnabled) {
    app.route('/api/v1/admin/auth', createAdminAuthRoutes(options.adminAuth, options.config.webUrl, options.config.environment === 'production'))
    if (options.submissions) app.route('/api/v1/admin/submissions', createAdminSubmissionRoutes(options.adminAuth, options.submissions))
    if (options.reviews) app.route('/api/v1/admin/submissions', createAdminReviewRoutes(options.adminAuth, options.reviews))
    if (options.management) app.route('/api/v1/admin', createAdminManagementRoutes(options.adminAuth, options.management))
  }

  app.notFound((context) => context.json<MarketplaceApiError>({
    code: 'SKILL_NOT_FOUND',
    message: '请求的 Marketplace 资源不存在',
    requestId: context.get('requestId'),
  }, 404))

  app.onError((error, context) => {
    const requestIdValue = context.get('requestId')
    if (error instanceof MarketplaceApiException) {
      return context.json<MarketplaceApiError>({
        code: error.code,
        message: error.message,
        requestId: requestIdValue,
        ...(error.details ? { details: error.details } : {}),
      }, error.status as 400)
    }

    console.error(`[Marketplace API] 未处理错误 requestId=${requestIdValue}:`, error)
    return context.json<MarketplaceApiError>({
      code: 'INTERNAL_ERROR',
      message: 'Marketplace 服务暂时不可用',
      requestId: requestIdValue,
    }, 500)
  })

  return app
}
