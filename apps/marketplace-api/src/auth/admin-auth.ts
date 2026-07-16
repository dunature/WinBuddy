import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import postgres from 'postgres'
import type { MarketplaceAdminRole, MarketplaceAdminUser } from '@proma/shared'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const STATE_TTL_MS = 10 * 60 * 1000

export interface GitHubIdentity {
  login: string
  name: string
  avatarUrl?: string
}

export interface AdminAuthRepository {
  findEnabledUser(login: string): Promise<MarketplaceAdminUser | undefined>
  createSession(tokenHash: string, login: string, expiresAt: Date): Promise<void>
  findSession(tokenHash: string, now: Date): Promise<MarketplaceAdminUser | undefined>
  deleteSession(tokenHash: string): Promise<void>
}

export interface GitHubOAuthClient {
  getAuthorizeUrl(state: string): string
  exchange(code: string): Promise<GitHubIdentity>
}

export class AdminAuthService {
  constructor(
    private readonly repository: AdminAuthRepository,
    private readonly github: GitHubOAuthClient,
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createAuthorization(): { state: string; url: string } {
    const expiresAt = this.now().getTime() + STATE_TTL_MS
    const payload = `${randomBytes(18).toString('base64url')}.${expiresAt}`
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url')
    const state = `${payload}.${signature}`
    return { state, url: this.github.getAuthorizeUrl(state) }
  }

  verifyState(state: string): boolean {
    const parts = state.split('.')
    if (parts.length !== 3) return false
    const payload = `${parts[0]}.${parts[1]}`
    const expected = createHmac('sha256', this.secret).update(payload).digest()
    const actual = Buffer.from(parts[2] ?? '', 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
    const expiresAt = Number(parts[1])
    return Number.isFinite(expiresAt) && expiresAt >= this.now().getTime()
  }

  async completeAuthorization(code: string): Promise<{ token: string; user: MarketplaceAdminUser } | undefined> {
    const identity = await this.github.exchange(code)
    const user = await this.repository.findEnabledUser(identity.login)
    if (!user) return undefined
    const token = randomBytes(32).toString('base64url')
    await this.repository.createSession(hashToken(token), user.githubLogin, new Date(this.now().getTime() + SESSION_TTL_MS))
    return { token, user }
  }

  getSession(token: string): Promise<MarketplaceAdminUser | undefined> {
    return this.repository.findSession(hashToken(token), this.now())
  }

  revoke(token: string): Promise<void> {
    return this.repository.deleteSession(hashToken(token))
  }
}

export class HttpGitHubOAuthClient implements GitHubOAuthClient {
  constructor(private readonly clientId: string, private readonly clientSecret: string, private readonly callbackUrl: string) {}

  getAuthorizeUrl(state: string): string {
    const query = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.callbackUrl, state, scope: 'read:user' })
    return `https://github.com/login/oauth/authorize?${query}`
  }

  async exchange(code: string): Promise<GitHubIdentity> {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code, redirect_uri: this.callbackUrl }),
    })
    const tokenPayload = await tokenResponse.json() as { access_token?: string }
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error('GitHub OAuth token 交换失败')
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenPayload.access_token}`, 'User-Agent': 'Proma-Marketplace' },
    })
    const user = await userResponse.json() as { login?: string; name?: string | null; avatar_url?: string }
    if (!userResponse.ok || !user.login) throw new Error('GitHub 用户信息读取失败')
    return { login: user.login, name: user.name?.trim() || user.login, ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}) }
  }
}

export class PostgresAdminAuthRepository implements AdminAuthRepository {
  private readonly sql: postgres.Sql
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl) }

  async findEnabledUser(login: string): Promise<MarketplaceAdminUser | undefined> {
    const rows = await this.sql<{ github_login: string; display_name: string; avatar_url: string | null; role: MarketplaceAdminRole }[]>`
      SELECT github_login, display_name, avatar_url, role FROM marketplace_admin_users
      WHERE lower(github_login) = lower(${login}) AND enabled = true LIMIT 1`
    const row = rows[0]
    return row ? { githubLogin: row.github_login, displayName: row.display_name || row.github_login, role: row.role, ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}) } : undefined
  }

  async createSession(tokenHash: string, login: string, expiresAt: Date): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`DELETE FROM marketplace_admin_sessions WHERE github_login = ${login} OR expires_at <= now()`
      await transaction`INSERT INTO marketplace_admin_sessions (token_hash, github_login, expires_at) VALUES (${tokenHash}, ${login}, ${expiresAt})`
    })
  }

  async findSession(tokenHash: string, now: Date): Promise<MarketplaceAdminUser | undefined> {
    const rows = await this.sql<{ github_login: string; display_name: string; avatar_url: string | null; role: MarketplaceAdminRole }[]>`
      SELECT u.github_login, u.display_name, u.avatar_url, u.role
      FROM marketplace_admin_sessions s JOIN marketplace_admin_users u ON u.github_login = s.github_login
      WHERE s.token_hash = ${tokenHash} AND s.expires_at > ${now} AND u.enabled = true LIMIT 1`
    const row = rows[0]
    return row ? { githubLogin: row.github_login, displayName: row.display_name || row.github_login, role: row.role, ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}) } : undefined
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM marketplace_admin_sessions WHERE token_hash = ${tokenHash}`
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
