import * as React from 'react'
import { useAtom } from 'jotai'
import { Navigate, Outlet, useLocation } from 'react-router'
import { LoaderCircle } from 'lucide-react'
import { getAdminSession } from '../../admin-api'
import { adminAuthAtom, authenticatedAdminState } from '../../admin-state'

export function AdminGuard(): React.ReactElement {
  const [auth, setAuth] = useAtom(adminAuthAtom)
  const location = useLocation()

  React.useEffect(() => {
    let active = true
    setAuth({ status: 'loading', session: null })
    getAdminSession()
      .then((session) => {
        if (active) setAuth(authenticatedAdminState(session))
      })
      .catch(() => {
        if (active) setAuth({ status: 'unauthenticated', session: null })
      })
    return () => { active = false }
  }, [setAuth])

  if (auth.status === 'idle' || auth.status === 'loading') {
    return (
      <main className="admin-canvas grid min-h-screen place-items-center text-[var(--paper)]">
        <div className="flex items-center gap-3 text-sm text-white/[0.65]"><LoaderCircle className="animate-spin" size={19} /> 正在验证管理会话</div>
      </main>
    )
  }
  if (auth.status === 'unauthenticated' || !auth.session) {
    return <Navigate to="/admin/login" replace state={{ reason: '会话已失效，请重新登录', from: location.pathname }} />
  }
  if (auth.status === 'must-change-password' && location.pathname !== '/admin/change-password') {
    return <Navigate to="/admin/change-password" replace />
  }
  return <Outlet />
}
