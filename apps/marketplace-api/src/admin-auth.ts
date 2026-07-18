import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { MarketplaceAdminSession } from '@proma/shared'
import type { MarketplaceDatabase } from './database/client'

export const ADMIN_SESSION_COOKIE = 'proma_marketplace_admin_session'
export const ADMIN_CSRF_COOKIE = 'proma_marketplace_admin_csrf'
export const ADMIN_LOGIN_CSRF_COOKIE = 'proma_marketplace_admin_login_csrf'
export const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1000

export interface InitializeMarketplaceAdminInput {
  username: string
  initialPassword: string
  requestId: string
}

export interface AdminAuthRuntime {
  now?: () => Date
  sessionDurationMs?: number
}

export interface LoginMarketplaceAdminInput extends AdminAuthRuntime {
  username: string
  password: string
  requestId: string
  ipAddress: string
}

export interface CreatedAdminSession {
  data: MarketplaceAdminSession
  sessionToken: string
  csrfToken: string
  expiresAt: Date
}

export interface AdminLoginFailure {
  error: 'invalid_credentials' | 'rate_limited'
}

export type AdminLoginResult = CreatedAdminSession | AdminLoginFailure

interface AdminRow {
  id: string
  username: string
  password_hash: string
  must_change_password: boolean
}

interface SessionRow {
  id: string
  admin_id: string
  username: string
  must_change_password: boolean
  expires_at: Date
}

export interface AuthenticatedAdminSession {
  id: string
  adminId: string
  username: string
  mustChangePassword: boolean
  expiresAt: Date
}

export type ChangeAdminPasswordResult =
  | { data: { admin: MarketplaceAdminSession['admin'] } }
  | { error: 'current_password_invalid' | 'password_unchanged' | 'password_weak' }

interface LoginFailureCounts {
  username_failures: number
  ip_failures: number
}

function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase('en-US')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function createToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createMarketplaceLoginCsrfToken(): string {
  return createToken()
}

export function marketplaceTokensMatch(left: string, right: string): boolean {
  if (!left || !right) return false
  const leftHash = Buffer.from(hashToken(left), 'hex')
  const rightHash = Buffer.from(hashToken(right), 'hex')
  return timingSafeEqual(leftHash, rightHash)
}

async function recordLoginAudit(
  database: MarketplaceDatabase,
  input: LoginMarketplaceAdminInput,
  action: 'admin.login.failed' | 'admin.login.rate_limited',
  reason: string,
): Promise<void> {
  const now = (input.now ?? (() => new Date()))()
  await database.sql`
    INSERT INTO audit_entries (
      id, actor_identifier, action, request_id, ip_address, reason, created_at
    ) VALUES (
      ${randomUUID()}, ${normalizeUsername(input.username)}, ${action}, ${input.requestId},
      ${input.ipAddress}, ${reason}, ${now.toISOString()}
    )
  `
}

async function isLoginRateLimited(
  database: MarketplaceDatabase,
  input: LoginMarketplaceAdminInput,
): Promise<boolean> {
  const now = (input.now ?? (() => new Date()))()
  const rows = await database.sql<LoginFailureCounts[]>`
    SELECT
      (COUNT(*) FILTER (WHERE actor_identifier = ${normalizeUsername(input.username)}))::integer AS username_failures,
      (COUNT(*) FILTER (WHERE ip_address = ${input.ipAddress}))::integer AS ip_failures
    FROM audit_entries
    WHERE action = 'admin.login.failed'
      AND created_at > ${now.toISOString()}::timestamptz - INTERVAL '15 minutes'
  `
  const counts = rows[0]
  return (counts?.username_failures ?? 0) >= 5 || (counts?.ip_failures ?? 0) >= 5
}

export async function initializeMarketplaceAdmin(
  database: MarketplaceDatabase,
  input: InitializeMarketplaceAdminInput,
): Promise<void> {
  const username = input.username.trim()
  if (!username) throw new Error('管理员用户名不能为空')
  if (input.initialPassword.length < 12) throw new Error('管理员初始密码至少需要 12 个字符')

  const existing = await database.sql<{ id: string }[]>`SELECT id FROM admins WHERE id = 'primary'`
  if (existing.length > 0) return

  const passwordHash = await Bun.password.hash(input.initialPassword, { algorithm: 'argon2id' })
  await database.sql.begin(async (transaction) => {
    const inserted = await transaction<{ id: string }[]>`
      INSERT INTO admins (id, username, normalized_username, password_hash, must_change_password)
      VALUES ('primary', ${username}, ${normalizeUsername(username)}, ${passwordHash}, true)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `
    if (inserted.length === 0) return
    await transaction`
      INSERT INTO audit_entries (
        id, actor_id, actor_identifier, action, request_id, after_state, reason
      ) VALUES (
        ${randomUUID()}, 'primary', ${username}, 'admin.bootstrap', ${input.requestId},
        ${JSON.stringify({ mustChangePassword: true })}::jsonb, '从环境变量初始化管理员'
      )
    `
  })
}

export async function loginMarketplaceAdmin(
  database: MarketplaceDatabase,
  input: LoginMarketplaceAdminInput,
): Promise<AdminLoginResult> {
  if (await isLoginRateLimited(database, input)) {
    await recordLoginAudit(database, input, 'admin.login.rate_limited', '15 分钟登录失败次数已达上限')
    return { error: 'rate_limited' }
  }

  const rows = await database.sql<AdminRow[]>`
    SELECT id, username, password_hash, must_change_password
    FROM admins
    WHERE normalized_username = ${normalizeUsername(input.username)}
    LIMIT 1
  `
  const admin = rows[0]
  if (!admin || !await Bun.password.verify(input.password, admin.password_hash)) {
    await recordLoginAudit(database, input, 'admin.login.failed', '管理员用户名或密码错误')
    return { error: 'invalid_credentials' }
  }

  const sessionToken = createToken()
  const csrfToken = createToken()
  const now = (input.now ?? (() => new Date()))()
  const expiresAt = new Date(now.getTime() + (input.sessionDurationMs ?? ADMIN_SESSION_DURATION_MS))
  await database.sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO admin_sessions (id, admin_id, token_hash, csrf_token_hash, expires_at, created_at)
      VALUES (
        ${randomUUID()}, ${admin.id}, ${hashToken(sessionToken)}, ${hashToken(csrfToken)},
        ${expiresAt.toISOString()}, ${now.toISOString()}
      )
    `
    await transaction`
      INSERT INTO audit_entries (
        id, actor_id, actor_identifier, action, request_id, ip_address, after_state, reason, created_at
      ) VALUES (
        ${randomUUID()}, ${admin.id}, ${admin.username}, 'admin.login.succeeded', ${input.requestId},
        ${input.ipAddress}, ${JSON.stringify({ expiresAt: expiresAt.toISOString() })}::jsonb,
        '管理员登录成功', ${now.toISOString()}
      )
    `
  })

  return {
    data: {
      admin: { username: admin.username, mustChangePassword: admin.must_change_password },
      csrfToken,
    },
    sessionToken,
    csrfToken,
    expiresAt,
  }
}

export async function getMarketplaceAdminSession(
  database: MarketplaceDatabase,
  sessionToken: string,
  runtime: AdminAuthRuntime = {},
  currentCsrfToken = '',
): Promise<CreatedAdminSession | null> {
  const authenticated = await authenticateMarketplaceAdminSession(database, sessionToken, runtime)
  if (!authenticated) return null

  const csrfToken = await validateMarketplaceAdminCsrf(database, authenticated.id, currentCsrfToken)
    ? currentCsrfToken
    : createToken()
  if (csrfToken !== currentCsrfToken) {
    await database.sql`
      UPDATE admin_sessions SET csrf_token_hash = ${hashToken(csrfToken)} WHERE id = ${authenticated.id}
    `
  }
  return {
    data: {
      admin: {
        username: authenticated.username,
        mustChangePassword: authenticated.mustChangePassword,
      },
      csrfToken,
    },
    sessionToken,
    csrfToken,
    expiresAt: authenticated.expiresAt,
  }
}

export async function authenticateMarketplaceAdminSession(
  database: MarketplaceDatabase,
  sessionToken: string,
  runtime: AdminAuthRuntime = {},
): Promise<AuthenticatedAdminSession | null> {
  const now = (runtime.now ?? (() => new Date()))()
  const rows = await database.sql<SessionRow[]>`
    SELECT sessions.id, sessions.admin_id, sessions.expires_at, admins.username, admins.must_change_password
    FROM admin_sessions sessions
    INNER JOIN admins ON admins.id = sessions.admin_id
    WHERE sessions.token_hash = ${hashToken(sessionToken)}
      AND sessions.invalidated_at IS NULL
      AND sessions.expires_at > ${now.toISOString()}
    LIMIT 1
  `
  const session = rows[0]
  if (!session) return null
  return {
    id: session.id,
    adminId: session.admin_id,
    username: session.username,
    mustChangePassword: session.must_change_password,
    expiresAt: new Date(session.expires_at),
  }
}

export async function validateMarketplaceAdminCsrf(
  database: MarketplaceDatabase,
  sessionId: string,
  csrfToken: string,
): Promise<boolean> {
  if (!csrfToken) return false
  const rows = await database.sql<{ id: string }[]>`
    SELECT id FROM admin_sessions
    WHERE id = ${sessionId} AND csrf_token_hash = ${hashToken(csrfToken)}
    LIMIT 1
  `
  return rows.length === 1
}

export async function changeMarketplaceAdminPassword(
  database: MarketplaceDatabase,
  session: AuthenticatedAdminSession,
  input: { currentPassword: string; newPassword: string; requestId: string; ipAddress: string; now?: () => Date },
): Promise<ChangeAdminPasswordResult> {
  if (input.newPassword.length < 12) return { error: 'password_weak' }
  const rows = await database.sql<{ password_hash: string }[]>`
    SELECT password_hash FROM admins WHERE id = ${session.adminId} LIMIT 1
  `
  const passwordHash = rows[0]?.password_hash
  if (!passwordHash || !await Bun.password.verify(input.currentPassword, passwordHash)) {
    return { error: 'current_password_invalid' }
  }
  if (await Bun.password.verify(input.newPassword, passwordHash)) return { error: 'password_unchanged' }

  const nextHash = await Bun.password.hash(input.newPassword, { algorithm: 'argon2id' })
  const now = (input.now ?? (() => new Date()))()
  await database.sql.begin(async (transaction) => {
    await transaction`
      UPDATE admins
      SET password_hash = ${nextHash}, must_change_password = false, updated_at = ${now.toISOString()}
      WHERE id = ${session.adminId}
    `
    await transaction`
      UPDATE admin_sessions SET invalidated_at = ${now.toISOString()}
      WHERE admin_id = ${session.adminId} AND id <> ${session.id} AND invalidated_at IS NULL
    `
    await transaction`
      INSERT INTO audit_entries (
        id, actor_id, actor_identifier, action, request_id, ip_address,
        before_state, after_state, reason, created_at
      ) VALUES (
        ${randomUUID()}, ${session.adminId}, ${session.username}, 'admin.password.changed',
        ${input.requestId}, ${input.ipAddress},
        ${JSON.stringify({ mustChangePassword: session.mustChangePassword })}::jsonb,
        ${JSON.stringify({ mustChangePassword: false })}::jsonb, '管理员修改密码', ${now.toISOString()}
      )
    `
  })
  return { data: { admin: { username: session.username, mustChangePassword: false } } }
}

export async function logoutMarketplaceAdmin(
  database: MarketplaceDatabase,
  session: AuthenticatedAdminSession,
  input: { requestId: string; ipAddress: string; now?: () => Date },
): Promise<void> {
  const now = (input.now ?? (() => new Date()))()
  await database.sql.begin(async (transaction) => {
    await transaction`
      UPDATE admin_sessions SET invalidated_at = ${now.toISOString()}
      WHERE id = ${session.id} AND invalidated_at IS NULL
    `
    await transaction`
      INSERT INTO audit_entries (
        id, actor_id, actor_identifier, action, request_id, ip_address, reason, created_at
      ) VALUES (
        ${randomUUID()}, ${session.adminId}, ${session.username}, 'admin.logout', ${input.requestId},
        ${input.ipAddress}, '管理员主动退出', ${now.toISOString()}
      )
    `
  })
}

export async function resetMarketplaceAdminPassword(
  database: MarketplaceDatabase,
  input: { newPassword: string; requestId: string; now?: () => Date },
): Promise<void> {
  if (input.newPassword.length < 12) throw new Error('新密码至少需要 12 个字符')
  const rows = await database.sql<{ id: string; username: string; must_change_password: boolean }[]>`
    SELECT id, username, must_change_password FROM admins WHERE id = 'primary' LIMIT 1
  `
  const admin = rows[0]
  if (!admin) throw new Error('管理员尚未初始化')

  const passwordHash = await Bun.password.hash(input.newPassword, { algorithm: 'argon2id' })
  const now = (input.now ?? (() => new Date()))()
  await database.sql.begin(async (transaction) => {
    await transaction`
      UPDATE admins
      SET password_hash = ${passwordHash}, must_change_password = true, updated_at = ${now.toISOString()}
      WHERE id = ${admin.id}
    `
    await transaction`
      UPDATE admin_sessions SET invalidated_at = ${now.toISOString()}
      WHERE admin_id = ${admin.id} AND invalidated_at IS NULL
    `
    await transaction`
      INSERT INTO audit_entries (
        id, actor_id, actor_identifier, action, request_id,
        before_state, after_state, reason, created_at
      ) VALUES (
        ${randomUUID()}, ${admin.id}, ${admin.username}, 'admin.password.reset', ${input.requestId},
        ${JSON.stringify({ mustChangePassword: admin.must_change_password })}::jsonb,
        ${JSON.stringify({ mustChangePassword: true, sessionsInvalidated: true })}::jsonb,
        '运维 CLI 重置管理员密码', ${now.toISOString()}
      )
    `
  })
}
