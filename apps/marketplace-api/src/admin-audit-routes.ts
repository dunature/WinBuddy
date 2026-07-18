import { Hono } from 'hono'
import { listMarketplaceAdminAuditEntries } from './admin-audit'
import type { MarketplaceAppEnv } from './app'
import type { MarketplaceDatabase } from './database/client'

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

function parseTime(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export function createMarketplaceAdminAuditRouter(database: MarketplaceDatabase): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()
  router.get('/audit-entries', async (context) => {
    const rawFrom = context.req.query('from')?.trim()
    const rawTo = context.req.query('to')?.trim()
    const from = parseTime(rawFrom)
    const to = parseTime(rawTo)
    if ((rawFrom && !from) || (rawTo && !to) || (from && to && from >= to)) {
      return context.json({
        error: { code: 'INVALID_AUDIT_TIME_RANGE', message: '审计时间范围无效；起点必须早于终点' },
        requestId: context.get('requestId'),
      }, 400)
    }
    const skillId = optionalText(context.req.query('skillId'), 100)
    const actor = optionalText(context.req.query('actor'), 100)
    const action = optionalText(context.req.query('action'), 100)
    const invalidText = [
      [context.req.query('skillId'), skillId],
      [context.req.query('actor'), actor],
      [context.req.query('action'), action],
    ].some(([raw, parsed]) => Boolean(raw?.trim()) && !parsed)
    if (invalidText) {
      return context.json({
        error: { code: 'INVALID_AUDIT_FILTER', message: '审计筛选值格式不正确' },
        requestId: context.get('requestId'),
      }, 400)
    }
    const result = await listMarketplaceAdminAuditEntries(database, {
      ...(skillId ? { skillId } : {}), ...(actor ? { actor } : {}), ...(action ? { action } : {}),
      ...(from ? { from } : {}), ...(to ? { to } : {}),
      page: context.req.query('page'), pageSize: context.req.query('pageSize'),
    })
    return context.json({ data: result.items, page: result.page, requestId: context.get('requestId') })
  })
  return router
}
