import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Navigate, Outlet } from 'react-router-dom'
import { adminSessionAtom, adminSessionLoadingAtom } from '../atoms/admin-auth.ts'
import { marketplaceApi } from '../lib/api-client.ts'

export function AdminProtectedRoute(): React.ReactElement {
  const [session, setSession] = useAtom(adminSessionAtom)
  const [loading, setLoading] = useAtom(adminSessionLoadingAtom)
  const setLoadingOnly = useSetAtom(adminSessionLoadingAtom)
  React.useEffect(() => {
    if (session) { setLoadingOnly(false); return }
    const controller = new AbortController()
    marketplaceApi.getAdminSession(controller.signal).then(setSession).catch(() => setSession({ authenticated: false })).finally(() => setLoading(false))
    return () => controller.abort()
  }, [session, setLoading, setLoadingOnly])
  if (loading) return <main className="market-state"><p>正在验证管理员身份…</p></main>
  if (!session?.authenticated) return <Navigate to="/admin/login" replace />
  return <Outlet />
}
