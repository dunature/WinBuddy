import { Hono } from 'hono'
import { z } from 'zod'
import type { MarketplaceFeatureFlags, MarketplaceInstallEventInput, MarketplacePackageDownload } from '@proma/shared'
import { MarketplaceApiException } from '../errors.ts'
import type { MarketplaceObjectStore } from '../object-store/object-store.ts'
import type { MarketplaceRepository } from '../repository/marketplace-repository.ts'

export interface MarketplacePublicRouteServices {
  repository: MarketplaceRepository
  objectStore: MarketplaceObjectStore
  now?: () => Date
}

const searchSchema = z.object({
  query: z.string().max(100).optional(),
  scope: z.enum(['all', 'official', 'community']).default('all'),
  category: z.string().max(64).optional(),
  sort: z.enum(['popular', 'recent']).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const installEventSchema = z.object({
  eventId: z.string().uuid(),
  skillId: z.string().uuid(),
  version: z.string().min(1).max(64),
  installedAt: z.string().datetime(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  appVersion: z.string().min(1).max(64),
})

const ENABLED_FLAGS: MarketplaceFeatureFlags = { browse: true, install: true, admin: true, community: true }

export function createMarketplacePublicRoutes(services: MarketplacePublicRouteServices, flags: MarketplaceFeatureFlags = ENABLED_FLAGS): Hono {
  const routes = new Hono()

  routes.use('*', async (context, next) => {
    if (context.req.path.includes('/categories') || context.req.path.includes('/skills')) requireFeature(flags.browse, '公共市场浏览暂未开放')
    if (context.req.path.endsWith('/package')) requireFeature(flags.install, '市场安装暂未开放')
    await next()
  })

  routes.get('/categories', async (context) => context.json(await services.repository.listCategories()))

  routes.get('/skills', async (context) => {
    const parsed = searchSchema.safeParse(context.req.query())
    if (!parsed.success) throw new MarketplaceApiException('VALIDATION_FAILED', '市场筛选参数无效', 400, { issues: parsed.error.issues })
    const scope = flags.community ? parsed.data.scope : 'official'
    return context.json(await services.repository.listSkills({ ...parsed.data, scope }))
  })

  routes.get('/skills/:slug', async (context) => {
    const skill = await services.repository.getSkill(context.req.param('slug'))
    if (!skill) throw new MarketplaceApiException('SKILL_NOT_FOUND', 'Skill 不存在或尚未公开', 404)
    if (!flags.community && !skill.author.official) throw new MarketplaceApiException('SKILL_NOT_FOUND', 'Skill 不存在或尚未公开', 404)
    return context.json(skill)
  })

  routes.get('/skills/:slug/versions/:version/files', async (context) => {
    const files = await services.repository.listFiles(context.req.param('slug'), context.req.param('version'))
    if (!files) throw new MarketplaceApiException('SKILL_NOT_FOUND', 'Skill 版本不存在或尚未公开', 404)
    return context.json(files)
  })

  routes.get('/skills/:slug/versions/:version/files/content', async (context) => {
    const path = context.req.query('path')
    if (!path) throw new MarketplaceApiException('VALIDATION_FAILED', '缺少文件路径', 400)
    const file = await services.repository.getFile(context.req.param('slug'), context.req.param('version'), path)
    if (!file) throw new MarketplaceApiException('SKILL_NOT_FOUND', '文件不存在或不可公开预览', 404)
    return context.json(file)
  })

  routes.get('/skills/:slug/versions/:version/examples', async (context) => {
    const examples = await services.repository.listExamples(context.req.param('slug'), context.req.param('version'))
    if (!examples) throw new MarketplaceApiException('SKILL_NOT_FOUND', 'Skill 版本不存在或尚未公开', 404)
    return context.json(examples)
  })

  routes.get('/skills/:slug/versions/:version/package', async (context) => {
    const packageRecord = await services.repository.getPackage(context.req.param('slug'), context.req.param('version'))
    if (!packageRecord) throw new MarketplaceApiException('SKILL_UNAVAILABLE', '该 Skill 版本当前不可安装', 404)
    const expiresInSeconds = 300
    const downloadUrl = await services.objectStore.getSignedDownloadUrl(packageRecord.objectKey, expiresInSeconds)
    const now = services.now?.() ?? new Date()
    const result: MarketplacePackageDownload = {
      skillId: packageRecord.skillId,
      slug: packageRecord.slug,
      version: packageRecord.version,
      sha256: packageRecord.sha256,
      size: packageRecord.size,
      downloadUrl,
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    }
    context.header('Cache-Control', 'no-store')
    return context.json(result)
  })

  routes.post('/install-events', async (context) => {
    const parsed = installEventSchema.safeParse(await context.req.json<unknown>())
    if (!parsed.success) throw new MarketplaceApiException('VALIDATION_FAILED', '安装事件格式无效', 400)
    const inserted = await services.repository.recordInstallEvent(parsed.data as MarketplaceInstallEventInput)
    return context.json({ accepted: true, duplicate: !inserted }, inserted ? 201 : 200)
  })

  return routes
}

function requireFeature(enabled: boolean, message: string): void {
  if (!enabled) throw new MarketplaceApiException('FEATURE_DISABLED', message, 503)
}
