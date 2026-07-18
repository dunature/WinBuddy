import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Hono, type Context } from 'hono'
import { serveStatic } from 'hono/bun'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { MARKETPLACE_MAX_TEXT_PREVIEW_BYTES } from '@proma/marketplace-domain'
import type { MarketplaceDatabase } from './database/client'
import { createMarketplaceAdminDraftRouter } from './admin-draft-routes'
import { createMarketplaceAdminPublishRouter } from './admin-publish-routes'
import { createMarketplaceAdminUploadRouter } from './admin-upload-routes'
import { createMarketplaceAdminTaxonomyRouter } from './admin-taxonomy-routes'
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_LOGIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_DURATION_MS,
  authenticateMarketplaceAdminSession,
  changeMarketplaceAdminPassword,
  createMarketplaceLoginCsrfToken,
  getMarketplaceAdminSession,
  loginMarketplaceAdmin,
  logoutMarketplaceAdmin,
  marketplaceTokensMatch,
  validateMarketplaceAdminCsrf,
  type AuthenticatedAdminSession,
  type CreatedAdminSession,
} from './admin-auth'
import {
  getPublicInstallManifest,
  getPublicInstallManifestBySkillId,
  getPublicSkill,
  getPublicSkillFile,
  listPublicCategories,
  listPublicSkills,
} from './public-catalog'
import { createMarketplaceDownloadUrl, validateMarketplaceDownloadUrl } from './download-signing'

export interface MarketplaceAppEnv {
  Variables: {
    requestId: string
    adminSession: AuthenticatedAdminSession
  }
}

export interface CreateMarketplaceAppOptions {
  database: MarketplaceDatabase
  requestIdFactory?: () => string
  webRoot?: string
  storageDir?: string
  downloadSigningSecret?: string
  allowedOrigin?: string
  now?: () => Date
  sessionDurationMs?: number
}

function requestIp(context: Context<MarketplaceAppEnv>): string {
  return context.req.header('x-forwarded-for')?.split(',', 1)[0]?.trim()
    || context.req.header('x-real-ip')?.trim()
    || 'unknown'
}

function setAdminSessionCookies(
  context: Context<MarketplaceAppEnv>,
  session: CreatedAdminSession,
  maxAge: number,
): void {
  setCookie(context, ADMIN_SESSION_COOKIE, session.sessionToken, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge,
  })
  setCookie(context, ADMIN_CSRF_COOKIE, session.csrfToken, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge,
  })
}

export function createMarketplaceApp(options: CreateMarketplaceAppOptions): Hono<MarketplaceAppEnv> {
  const app = new Hono<MarketplaceAppEnv>()
  const requestIdFactory = options.requestIdFactory ?? randomUUID
  const allowedOrigin = options.allowedOrigin ?? 'https://www.feiyangclaw.com'
  const sessionDurationMs = options.sessionDurationMs ?? ADMIN_SESSION_DURATION_MS
  const sessionMaxAge = Math.floor(sessionDurationMs / 1000)
  const now = options.now ?? (() => new Date())

  app.use('*', async (context, next) => {
    const requestId = requestIdFactory()
    context.set('requestId', requestId)
    context.header('x-request-id', requestId)
    await next()
  })

  app.use('/api/v1/admin/*', async (context, next) => {
    if (context.req.path === '/api/v1/admin/auth/login'
      || context.req.path === '/api/v1/admin/auth/login-challenge') {
      await next()
      return
    }

    const sessionToken = getCookie(context, ADMIN_SESSION_COOKIE)
    const session = sessionToken
      ? await authenticateMarketplaceAdminSession(options.database, sessionToken, { now: options.now })
      : null
    if (!session) {
      return context.json({
        error: { code: 'ADMIN_UNAUTHORIZED', message: '管理员会话无效或已过期' },
        requestId: context.get('requestId'),
      }, 401)
    }
    context.set('adminSession', session)

    if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
      if (context.req.header('origin') !== allowedOrigin) {
        return context.json({
          error: { code: 'ORIGIN_FORBIDDEN', message: '请求来源不受信任' },
          requestId: context.get('requestId'),
        }, 403)
      }
      const csrfValid = await validateMarketplaceAdminCsrf(
        options.database,
        session.id,
        context.req.header('x-csrf-token') ?? '',
      )
      if (!csrfValid) {
        return context.json({
          error: { code: 'ADMIN_CSRF_INVALID', message: 'CSRF token 无效或已过期' },
          requestId: context.get('requestId'),
        }, 403)
      }
      const passwordChangeExempt = context.req.path === '/api/v1/admin/auth/change-password'
        || context.req.path === '/api/v1/admin/auth/logout'
      if (session.mustChangePassword && !passwordChangeExempt) {
        return context.json({
          error: { code: 'ADMIN_PASSWORD_CHANGE_REQUIRED', message: '请先修改初始密码' },
          requestId: context.get('requestId'),
        }, 403)
      }
    }

    await next()
  })

  if (options.webRoot) {
    const webRoot = options.webRoot
    app.get('/agent/marketplace', (context) => context.redirect('/agent/marketplace/'))
    app.get('/agent/marketplace/*', serveStatic({
      root: webRoot,
      rewriteRequestPath: (path) => path.replace(/^\/agent\/marketplace/, ''),
      onFound: (path, context) => {
        if (path.includes('/assets/')) {
          context.header('cache-control', 'public, max-age=31536000, immutable')
        }
      },
    }))
    app.get('/agent/marketplace/*', serveStatic({
      root: webRoot,
      rewriteRequestPath: () => '/index.html',
      onFound: (_path, context) => context.header('cache-control', 'no-cache'),
    }))
  }

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

  app.post('/api/v1/admin/auth/login', async (context) => {
    if (context.req.header('origin') !== allowedOrigin) {
      return context.json({
        error: { code: 'ORIGIN_FORBIDDEN', message: '请求来源不受信任' },
        requestId: context.get('requestId'),
      }, 403)
    }
    const loginCsrfCookie = getCookie(context, ADMIN_LOGIN_CSRF_COOKIE) ?? ''
    const loginCsrfHeader = context.req.header('x-csrf-token') ?? ''
    if (!marketplaceTokensMatch(loginCsrfCookie, loginCsrfHeader)) {
      return context.json({
        error: { code: 'ADMIN_CSRF_INVALID', message: 'CSRF token 无效或已过期' },
        requestId: context.get('requestId'),
      }, 403)
    }
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      body = null
    }
    if (!body || typeof body !== 'object' || !('username' in body) || !('password' in body)
      || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return context.json({
        error: { code: 'INVALID_REQUEST', message: '请输入管理员用户名和密码' },
        requestId: context.get('requestId'),
      }, 400)
    }
    const session = await loginMarketplaceAdmin(options.database, {
      username: body.username,
      password: body.password,
      requestId: context.get('requestId'),
      ipAddress: requestIp(context),
      now: options.now,
      sessionDurationMs,
    })
    if ('error' in session) {
      if (session.error === 'rate_limited') {
        return context.json({
          error: { code: 'ADMIN_LOGIN_RATE_LIMITED', message: '登录失败次数过多，请 15 分钟后重试' },
          requestId: context.get('requestId'),
        }, 429)
      }
      return context.json({
        error: { code: 'ADMIN_INVALID_CREDENTIALS', message: '管理员用户名或密码错误' },
        requestId: context.get('requestId'),
      }, 401)
    }
    setAdminSessionCookies(context, session, sessionMaxAge)
    deleteCookie(context, ADMIN_LOGIN_CSRF_COOKIE, { path: '/', secure: true })
    return context.json({ data: session.data, requestId: context.get('requestId') })
  })

  app.get('/api/v1/admin/auth/login-challenge', (context) => {
    const csrfToken = createMarketplaceLoginCsrfToken()
    setCookie(context, ADMIN_LOGIN_CSRF_COOKIE, csrfToken, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 10 * 60,
    })
    return context.json({ data: { csrfToken }, requestId: context.get('requestId') })
  })

  app.get('/api/v1/admin/auth/session', async (context) => {
    const sessionToken = getCookie(context, ADMIN_SESSION_COOKIE)
    const session = sessionToken
      ? await getMarketplaceAdminSession(options.database, sessionToken, {
        now: options.now,
        sessionDurationMs,
      }, getCookie(context, ADMIN_CSRF_COOKIE))
      : null
    if (!session) {
      return context.json({
        error: { code: 'ADMIN_UNAUTHORIZED', message: '管理员会话无效或已过期' },
        requestId: context.get('requestId'),
      }, 401)
    }
    setAdminSessionCookies(context, session, sessionMaxAge)
    return context.json({ data: session.data, requestId: context.get('requestId') })
  })

  app.post('/api/v1/admin/auth/change-password', async (context) => {
    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      body = null
    }
    if (!body || typeof body !== 'object' || !('currentPassword' in body) || !('newPassword' in body)
      || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      return context.json({
        error: { code: 'INVALID_REQUEST', message: '请输入当前密码和新密码' },
        requestId: context.get('requestId'),
      }, 400)
    }
    const result = await changeMarketplaceAdminPassword(options.database, context.get('adminSession'), {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      requestId: context.get('requestId'),
      ipAddress: requestIp(context),
      now: options.now,
    })
    if ('error' in result) {
      const errors = {
        current_password_invalid: ['ADMIN_CURRENT_PASSWORD_INVALID', '当前密码不正确'],
        password_unchanged: ['ADMIN_PASSWORD_UNCHANGED', '新密码不能与当前密码相同'],
        password_weak: ['ADMIN_PASSWORD_WEAK', '新密码至少需要 12 个字符'],
      } as const
      const [code, message] = errors[result.error]
      return context.json({
        error: { code, message },
        requestId: context.get('requestId'),
      }, 400)
    }
    return context.json({ data: result.data, requestId: context.get('requestId') })
  })

  app.post('/api/v1/admin/auth/logout', async (context) => {
    await logoutMarketplaceAdmin(options.database, context.get('adminSession'), {
      requestId: context.get('requestId'),
      ipAddress: requestIp(context),
      now: options.now,
    })
    deleteCookie(context, ADMIN_SESSION_COOKIE, { path: '/', secure: true })
    deleteCookie(context, ADMIN_CSRF_COOKIE, { path: '/', secure: true })
    return context.json({ data: { loggedOut: true }, requestId: context.get('requestId') })
  })

  app.route('/api/v1/admin', createMarketplaceAdminDraftRouter(options.database))
  app.route('/api/v1/admin', createMarketplaceAdminTaxonomyRouter(options.database))
  if (options.storageDir) {
    app.route('/api/v1/admin', createMarketplaceAdminUploadRouter(options.database, options.storageDir))
    app.route('/api/v1/admin', createMarketplaceAdminPublishRouter(options.database, options.storageDir))
  }

  app.get('/api/v1/marketplace/categories', async (context) => context.json({
    data: await listPublicCategories(options.database),
    requestId: context.get('requestId'),
  }))

  app.get('/api/v1/marketplace/skills', async (context) => {
    const result = await listPublicSkills(options.database, {
      query: context.req.query('q'),
      category: context.req.query('category'),
      tag: context.req.query('tag'),
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

  app.get('/api/v1/marketplace/skills/by-id/:skillId/versions/:version/manifest', async (context) => {
    const manifest = await getPublicInstallManifestBySkillId(
      options.database,
      context.req.param('skillId'),
      context.req.param('version'),
      options.downloadSigningSecret
        ? (identifier, version) => createMarketplaceDownloadUrl(
            allowedOrigin,
            options.downloadSigningSecret!,
            identifier,
            version,
            now(),
          )
        : undefined,
    )
    if (!manifest) {
      return context.json({
        error: { code: 'VERSION_NOT_FOUND', message: '技能版本不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: manifest, requestId: context.get('requestId') })
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
      options.downloadSigningSecret
        ? (identifier, version) => createMarketplaceDownloadUrl(
            allowedOrigin,
            options.downloadSigningSecret!,
            identifier,
            version,
            now(),
          )
        : undefined,
    )
    if (!manifest) {
      return context.json({
        error: { code: 'VERSION_NOT_FOUND', message: '技能版本不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: manifest, requestId: context.get('requestId') })
  })

  app.get('/api/v1/marketplace/downloads/:identifier/:version', async (context) => {
    if (!options.storageDir || !options.downloadSigningSecret) {
      return context.json({
        error: { code: 'DOWNLOAD_UNAVAILABLE', message: '技能包下载暂不可用' },
        requestId: context.get('requestId'),
      }, 503)
    }
    const identifier = context.req.param('identifier')
    const version = context.req.param('version')
    const validationError = validateMarketplaceDownloadUrl(
      options.downloadSigningSecret,
      identifier,
      version,
      context.req.query('expires'),
      context.req.query('signature'),
      now(),
    )
    if (validationError) {
      return context.json({
        error: {
          code: validationError,
          message: validationError === 'DOWNLOAD_URL_EXPIRED' ? '下载地址已过期' : '下载签名无效',
        },
        requestId: context.get('requestId'),
      }, 403)
    }
    const manifest = await getPublicInstallManifest(options.database, identifier, version)
    if (!manifest) {
      return context.json({
        error: { code: 'VERSION_NOT_FOUND', message: '技能版本不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    const archive = Bun.file(join(options.storageDir, 'published', identifier, version, 'package.zip'))
    if (!await archive.exists()) {
      return context.json({
        error: { code: 'PACKAGE_NOT_FOUND', message: '已发布技能包不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return new Response(archive, {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(archive.size),
        'content-disposition': `attachment; filename="${identifier}-${version}.zip"`,
        'cache-control': 'private, no-store',
        'x-request-id': context.get('requestId'),
      },
    })
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
