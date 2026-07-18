import { Hono } from 'hono'
import type { MarketplaceAppEnv } from './app'
import { MarketplaceAdminUploadError, MarketplaceUploadManager } from './admin-uploads'
import type { MarketplaceDatabase } from './database/client'

export function createMarketplaceAdminUploadRouter(
  database: MarketplaceDatabase,
  storageDir: string,
): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()
  const uploads = new MarketplaceUploadManager(database, storageDir)

  router.post('/skills/:skillId/versions/:versionId/uploads', async (context) => {
    try {
      const upload = await uploads.create(
        context.req.param('skillId'),
        context.req.param('versionId'),
        context.req.raw,
        { actor: context.get('adminSession'), requestId: context.get('requestId') },
      )
      return context.json({ data: upload, requestId: context.get('requestId') }, 202)
    } catch (error) {
      if (!(error instanceof MarketplaceAdminUploadError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.get('/skills/:skillId/versions/:versionId/uploads', async (context) => {
    const data = await uploads.list(context.req.param('skillId'), context.req.param('versionId'))
    return context.json({ data, requestId: context.get('requestId') })
  })

  router.get('/skills/:skillId/versions/:versionId/uploads/:uploadId', async (context) => {
    const upload = await uploads.get(
      context.req.param('skillId'),
      context.req.param('versionId'),
      context.req.param('uploadId'),
    )
    if (!upload) {
      return context.json({
        error: { code: 'UPLOAD_NOT_FOUND', message: '上传记录不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: upload, requestId: context.get('requestId') })
  })

  return router
}
