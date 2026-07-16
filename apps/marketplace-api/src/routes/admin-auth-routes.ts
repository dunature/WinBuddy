import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { MarketplaceAdminSession } from '@proma/shared'
import type { AdminAuthService } from '../auth/admin-auth.ts'

const STATE_COOKIE = 'proma_marketplace_oauth_state'
const SESSION_COOKIE = 'proma_marketplace_session'

export function createAdminAuthRoutes(auth: AdminAuthService, webUrl: string, secure: boolean): Hono {
  const routes = new Hono()
  const cookieOptions = { httpOnly: true, secure, sameSite: 'Lax' as const, path: '/' }

  routes.get('/github/start', (context) => {
    const authorization = auth.createAuthorization()
    setCookie(context, STATE_COOKIE, authorization.state, { ...cookieOptions, maxAge: 600 })
    return context.redirect(authorization.url)
  })

  routes.get('/github/callback', async (context) => {
    const code = context.req.query('code')
    const state = context.req.query('state')
    const savedState = getCookie(context, STATE_COOKIE)
    deleteCookie(context, STATE_COOKIE, { path: '/' })
    if (!code || !state || state !== savedState || !auth.verifyState(state)) return context.redirect(`${webUrl}/admin/login?error=oauth_state`)
    try {
      const result = await auth.completeAuthorization(code)
      if (!result) return context.redirect(`${webUrl}/admin/login?error=access_denied`)
      setCookie(context, SESSION_COOKIE, result.token, { ...cookieOptions, maxAge: 43_200 })
      return context.redirect(`${webUrl}/admin`)
    } catch {
      return context.redirect(`${webUrl}/admin/login?error=oauth_exchange`)
    }
  })

  routes.get('/session', async (context) => {
    const token = getCookie(context, SESSION_COOKIE)
    const user = token ? await auth.getSession(token) : undefined
    return context.json<MarketplaceAdminSession>(user ? { authenticated: true, user } : { authenticated: false })
  })

  routes.post('/logout', async (context) => {
    const token = getCookie(context, SESSION_COOKIE)
    if (token) await auth.revoke(token)
    deleteCookie(context, SESSION_COOKIE, { path: '/' })
    return context.json({ ok: true })
  })

  return routes
}
