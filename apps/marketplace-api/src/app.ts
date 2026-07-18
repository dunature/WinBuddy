import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { MARKETPLACE_MAX_TEXT_PREVIEW_BYTES } from '@proma/marketplace-domain'
import type { MarketplaceDatabase } from './database/client'
import {
  getPublicInstallManifest,
  getPublicSkill,
  getPublicSkillFile,
  listPublicCategories,
  listPublicSkills,
} from './public-catalog'

interface MarketplaceAppEnv {
  Variables: {
    requestId: string
  }
}

export interface CreateMarketplaceAppOptions {
  database: MarketplaceDatabase
  requestIdFactory?: () => string
}

export function createMarketplaceApp(options: CreateMarketplaceAppOptions): Hono<MarketplaceAppEnv> {
  const app = new Hono<MarketplaceAppEnv>()
  const requestIdFactory = options.requestIdFactory ?? randomUUID

  app.use('*', async (context, next) => {
    const requestId = requestIdFactory()
    context.set('requestId', requestId)
    context.header('x-request-id', requestId)
    await next()
  })

  app.get('/api/v1/health', (context) => context.json({
    data: { status: 'ok' },
    requestId: context.get('requestId'),
  }))

  app.get('/api/v1/readiness', async (context) => {
    await options.database.sql`SELECT 1`
    return context.json({
      data: { status: 'ready' },
      requestId: context.get('requestId'),
    })
  })

  app.get('/api/v1/marketplace/categories', async (context) => context.json({
    data: await listPublicCategories(options.database),
    requestId: context.get('requestId'),
  }))

  app.get('/api/v1/marketplace/skills', async (context) => {
    const result = await listPublicSkills(options.database, {
      query: context.req.query('q'),
      category: context.req.query('category'),
      featured: context.req.query('featured') === '1',
      sort: context.req.query('sort') === 'latest' ? 'latest' : 'hot',
      page: Number.parseInt(context.req.query('page') ?? '', 10),
      pageSize: Number.parseInt(context.req.query('pageSize') ?? '', 10),
    })
    return context.json({
      data: result.items,
      page: result.page,
      requestId: context.get('requestId'),
    })
  })

  app.get('/api/v1/marketplace/skills/:identifier', async (context) => {
    const skill = await getPublicSkill(options.database, context.req.param('identifier'))
    if (!skill) {
      return context.json({
        error: { code: 'SKILL_NOT_FOUND', message: '技能不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: skill, requestId: context.get('requestId') })
  })

  app.get('/api/v1/marketplace/skills/:identifier/versions', async (context) => {
    const skill = await getPublicSkill(options.database, context.req.param('identifier'))
    if (!skill) {
      return context.json({
        error: { code: 'SKILL_NOT_FOUND', message: '技能不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: skill.versions, requestId: context.get('requestId') })
  })

  app.get('/api/v1/marketplace/skills/:identifier/versions/:version/file', async (context) => {
    const path = context.req.query('path')?.trim()
    if (!path) {
      return context.json({
        error: { code: 'FILE_PATH_REQUIRED', message: '缺少文件路径' },
        requestId: context.get('requestId'),
      }, 400)
    }
    const file = await getPublicSkillFile(
      options.database,
      context.req.param('identifier'),
      context.req.param('version'),
      path,
    )
    if (!file) {
      return context.json({
        error: { code: 'FILE_NOT_FOUND', message: '技能文件不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    const contentBytes = file.content === undefined ? 0 : new TextEncoder().encode(file.content).byteLength
    if (file.isText && Math.max(file.size, contentBytes) > MARKETPLACE_MAX_TEXT_PREVIEW_BYTES) {
      return context.json({
        error: { code: 'FILE_TOO_LARGE', message: '文本文件超过 1 MB，无法预览' },
        requestId: context.get('requestId'),
      }, 413)
    }
    return context.json({ data: file, requestId: context.get('requestId') })
  })

  app.get('/api/v1/marketplace/skills/:identifier/versions/:version/manifest', async (context) => {
    const manifest = await getPublicInstallManifest(
      options.database,
      context.req.param('identifier'),
      context.req.param('version'),
    )
    if (!manifest) {
      return context.json({
        error: { code: 'VERSION_NOT_FOUND', message: '技能版本不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: manifest, requestId: context.get('requestId') })
  })

  app.notFound((context) => context.json({
    error: { code: 'NOT_FOUND', message: '请求的资源不存在' },
    requestId: context.get('requestId'),
  }, 404))

  app.onError((error, context) => {
    console.error('[技能市场 API] 请求处理失败:', error)
    return context.json({
      error: { code: 'INTERNAL_ERROR', message: '技能市场服务暂时不可用' },
      requestId: context.get('requestId'),
    }, 500)
  })

  return app
}
