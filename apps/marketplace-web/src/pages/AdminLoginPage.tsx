import { Github, ShieldCheck } from 'lucide-react'
import { marketplaceApi } from '../lib/api-client.ts'

const ERROR_MESSAGES: Record<string, string> = {
  oauth_state: '登录请求已失效，请重新尝试。',
  access_denied: '此 GitHub 账号不在管理员名单中。',
  oauth_exchange: 'GitHub 登录暂时失败，请稍后重试。',
}

export function AdminLoginPage(): React.ReactElement {
  const error = new URLSearchParams(window.location.search).get('error')
  return (
    <main className="admin-login">
      <section className="admin-login-brand" aria-label="Proma Marketplace Admin">
        <div className="admin-brand-mark"><span>✣</span><strong>Proma</strong><small>Marketplace Admin</small></div>
        <div><p className="admin-kicker">CURATED AGENT CRAFT</p><h1>管理可信的<br />Agent Skills</h1><p>上传、校验、审核并发布每一个进入 Proma 市场的 Skill。</p></div>
        <small>所有发布操作均记录版本与审计日志</small>
      </section>
      <section className="admin-login-stage">
        <div className="admin-login-card">
          <p className="admin-kicker">SECURE ACCESS</p>
          <h2>管理员登录</h2>
          <p>使用已加入管理员名单的 GitHub 账号继续。</p>
          <a className="admin-github-button" href={marketplaceApi.getAdminLoginUrl()}><Github size={18} />使用 GitHub 登录</a>
          <div className="admin-login-note"><ShieldCheck size={18} /><span>仅 Admin、Reviewer 和 Editor 角色可以访问，普通市场账号无法登录。</span></div>
          {error && <p className="admin-login-error" role="alert">{ERROR_MESSAGES[error] ?? '无法登录，请联系平台管理员。'}</p>}
        </div>
      </section>
    </main>
  )
}
