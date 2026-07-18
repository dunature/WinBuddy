import * as React from 'react'
import { useAtom } from 'jotai'
import { useNavigate } from 'react-router'
import { ArrowRight, CheckCircle2, LoaderCircle, LockKeyhole } from 'lucide-react'
import { changeAdminPassword } from '../../admin-api'
import { adminAuthAtom, authenticatedAdminState } from '../../admin-state'
import { AdminSecurityFrame } from './AdminSecurityFrame'

export function AdminChangePasswordPage(): React.ReactElement {
  const [auth, setAuth] = useAtom(adminAuthAtom)
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmation, setConfirmation] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!auth.session) return
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await changeAdminPassword(currentPassword, newPassword, auth.session.csrfToken)
      setAuth(authenticatedAdminState({ admin: result.admin, csrfToken: auth.session.csrfToken }))
      navigate('/admin', { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '密码修改失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminSecurityFrame
      eyebrow="Mandatory credential rotation"
      title="必须先修改初始密码"
      description="初始密码只用于建立第一条可信会话。设置你的长期密码后，发布、审核和治理入口才会解锁。"
    >
      <div className="mb-8">
        <div className="admin-step">02 / 凭证轮换</div>
        <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">设置长期密码</h2>
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-emerald-950 px-4 py-3 text-xs leading-5 text-emerald-100">
          <CheckCircle2 className="mt-0.5 flex-none text-emerald-300" size={16} />
          至少 12 个字符；修改成功后，其他已存在会话会立即失效。
        </div>
      </div>

      {error && <div role="alert" className="admin-alert mb-5">{error}</div>}

      <form onSubmit={(event) => { void submit(event) }} className="space-y-4">
        <label className="admin-field">
          <span>当前密码</span>
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>新密码</span>
          <input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>确认新密码</span>
          <input type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
        </label>
        <button type="submit" disabled={submitting} className="admin-primary-button">
          {submitting
            ? <><LoaderCircle className="animate-spin" size={17} /> 正在保存</>
            : <><LockKeyhole size={17} /> 保存新密码 <ArrowRight className="ml-auto" size={17} /></>}
        </button>
      </form>
    </AdminSecurityFrame>
  )
}
