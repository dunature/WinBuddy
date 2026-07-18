import * as React from 'react'
import { useAtom } from 'jotai'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ArrowRight, KeyRound, LoaderCircle } from 'lucide-react'
import { getAdminSession, loginAdmin } from '../../admin-api'
import { adminAuthAtom, authenticatedAdminState } from '../../admin-state'
import { MarketplaceRequestError } from '../../api'
import { AdminSecurityFrame } from './AdminSecurityFrame'

interface LoginLocationState {
  reason?: string
}

export function AdminLoginPage(): React.ReactElement {
  const [auth, setAuth] = useAtom(adminAuthAtom)
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const reason = (location.state as LoginLocationState | null)?.reason

  React.useEffect(() => {
    if (auth.status !== 'idle') return
    let active = true
    setAuth({ status: 'loading', session: null })
    getAdminSession()
      .then((session) => {
        if (!active) return
        const next = authenticatedAdminState(session)
        setAuth(next)
        navigate(next.status === 'must-change-password' ? '/admin/change-password' : '/admin', { replace: true })
      })
      .catch((requestError: unknown) => {
        if (!active) return
        if (requestError instanceof MarketplaceRequestError && requestError.status === 401) {
          setAuth({ status: 'unauthenticated', session: null })
          return
        }
        setAuth({ status: 'unauthenticated', session: null })
        setError(requestError instanceof Error ? requestError.message : '管理服务暂时不可用')
      })
    return () => { active = false }
  }, [navigate, setAuth])

  if (auth.status === 'authenticated') return <Navigate to="/admin" replace />
  if (auth.status === 'must-change-password') return <Navigate to="/admin/change-password" replace />

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const session = await loginAdmin(username, password)
      const next = authenticatedAdminState(session)
      setAuth(next)
      navigate(next.status === 'must-change-password' ? '/admin/change-password' : '/admin', { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '登录失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminSecurityFrame
      eyebrow="Proma Marketplace Authority"
      title="进入安全控制台"
      description="发布动作会改变所有客户端可见的线上版本。身份验证、请求来源和每次写操作都由服务端重新确认。"
    >
      <div className="mb-9">
        <div className="admin-step">01 / 身份验证</div>
        <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">管理员登录</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">使用部署时初始化的唯一管理员账号。</p>
      </div>

      {(reason || error) && (
        <div role="alert" className="admin-alert mb-6">{error ?? reason}</div>
      )}

      <form onSubmit={(event) => { void submit(event) }} className="space-y-5">
        <label className="admin-field">
          <span>管理员用户名</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label className="admin-field">
          <span>管理员密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting || auth.status === 'loading'} className="admin-primary-button">
          {submitting || auth.status === 'loading'
            ? <><LoaderCircle className="animate-spin" size={17} /> 正在验证</>
            : <><KeyRound size={17} /> 验证身份 <ArrowRight className="ml-auto" size={17} /></>}
        </button>
      </form>
    </AdminSecurityFrame>
  )
}
