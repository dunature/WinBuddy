import { Hono } from 'hono'
import {
  MarketplaceAdminTaxonomyError,
  createMarketplaceAdminCategory,
  createMarketplaceAdminTag,
  deleteMarketplaceAdminCategory,
  deleteMarketplaceAdminTag,
  listMarketplaceAdminCategories,
  listMarketplaceAdminTags,
  updateMarketplaceAdminCategory,
  updateMarketplaceAdminTag,
} from './admin-taxonomy'
import type { MarketplaceAppEnv } from './app'
import type { MarketplaceDatabase } from './database/client'

function invalidRequest(message: string): MarketplaceAdminTaxonomyError {
  return new MarketplaceAdminTaxonomyError('INVALID_REQUEST', message, 400)
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw invalidRequest('请求体必须是有效 JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidRequest('请求体格式不正确')
  return body as Record<string, unknown>
}

function requiredName(body: Record<string, unknown>): string {
  if (typeof body.name !== 'string' || !body.name.trim()) throw invalidRequest('名称不能为空')
  if (body.name.length > 64) throw invalidRequest('名称不能超过 64 个字符')
  return body.name
}

function requiredRevision(body: Record<string, unknown>): number {
  if (!Number.isInteger(body.revision) || (body.revision as number) < 1) {
    throw invalidRequest('revision 必须是正整数')
  }
  return body.revision as number
}

function categoryIcon(body: Record<string, unknown>, required: boolean): string | undefined {
  if (!('icon' in body) && !required) return undefined
  if (typeof body.icon !== 'string' || !body.icon.trim()) throw invalidRequest('分类图标不能为空')
  if (body.icon.length > 200) throw invalidRequest('分类图标不能超过 200 个字符')
  return body.icon.trim()
}

export function createMarketplaceAdminTaxonomyRouter(database: MarketplaceDatabase): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()

  router.get('/categories', async (context) => context.json({
    data: await listMarketplaceAdminCategories(database),
    requestId: context.get('requestId'),
  }))
  router.get('/tags', async (context) => context.json({
    data: await listMarketplaceAdminTags(database),
    requestId: context.get('requestId'),
  }))

  router.post('/categories', async (context) => {
    try {
      const body = await readBody(context.req.raw)
      const category = await createMarketplaceAdminCategory(database, {
        name: requiredName(body),
        icon: categoryIcon(body, true)!,
      }, { actor: context.get('adminSession'), requestId: context.get('requestId') })
      return context.json({ data: category, requestId: context.get('requestId') }, 201)
    } catch (error) {
      if (!(error instanceof MarketplaceAdminTaxonomyError)) throw error
      return context.json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.post('/tags', async (context) => {
    try {
      const body = await readBody(context.req.raw)
      const tag = await createMarketplaceAdminTag(database, { name: requiredName(body) }, {
        actor: context.get('adminSession'), requestId: context.get('requestId'),
      })
      return context.json({ data: tag, requestId: context.get('requestId') }, 201)
    } catch (error) {
      if (!(error instanceof MarketplaceAdminTaxonomyError)) throw error
      return context.json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.patch('/categories/:categoryId', async (context) => {
    try {
      const body = await readBody(context.req.raw)
      const name = 'name' in body ? requiredName(body) : undefined
      const icon = categoryIcon(body, false)
      if (!name && !icon) throw invalidRequest('至少提供名称或图标')
      const category = await updateMarketplaceAdminCategory(database, context.req.param('categoryId'), {
        revision: requiredRevision(body), ...(name ? { name } : {}), ...(icon ? { icon } : {}),
      }, { actor: context.get('adminSession'), requestId: context.get('requestId') })
      return context.json({ data: category, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminTaxonomyError)) throw error
      return context.json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.patch('/tags/:tagId', async (context) => {
    try {
      const body = await readBody(context.req.raw)
      const tag = await updateMarketplaceAdminTag(database, context.req.param('tagId'), {
        revision: requiredRevision(body), name: requiredName(body),
      }, { actor: context.get('adminSession'), requestId: context.get('requestId') })
      return context.json({ data: tag, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminTaxonomyError)) throw error
      return context.json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.delete('/categories/:categoryId', async (context) => {
    try {
      const body = await readBody(context.req.raw)
      await deleteMarketplaceAdminCategory(database, context.req.param('categoryId'), requiredRevision(body), {
        actor: context.get('adminSession'), requestId: context.get('requestId'),
      })
      return context.json({ data: { deleted: true }, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminTaxonomyError)) throw error
      return context.json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.delete('/tags/:tagId', async (context) => {
    try {
      const body = await readBody(context.req.raw)
      await deleteMarketplaceAdminTag(database, context.req.param('tagId'), requiredRevision(body), {
        actor: context.get('adminSession'), requestId: context.get('requestId'),
      })
      return context.json({ data: { deleted: true }, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminTaxonomyError)) throw error
      return context.json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  return router
}
