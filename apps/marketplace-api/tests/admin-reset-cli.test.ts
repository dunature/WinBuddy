import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Sql } from 'postgres'
import { initializeMarketplaceAdmin } from '../src/admin-auth'
import { createMarketplaceApp } from '../src/app'
import { createMarketplaceDatabase } from '../src/database/client'
import { runMarketplaceMigrations } from '../src/database/migrate'
import { closeSql, createMarketplaceTestDatabase, type MarketplaceTestDatabase } from './test-database'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
const resetPassword = 'reset-password-789'

describe.skipIf(!adminDatabaseUrl)('Marketplace 管理员重置 CLI（真实 PostgreSQL）', () => {
  let testDatabase: MarketplaceTestDatabase
  let sql: Sql

  beforeAll(async () => {
    testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl!)
    const database = createMarketplaceDatabase(testDatabase.databaseUrl)
    sql = database.sql
    await runMarketplaceMigrations(sql)
    await initializeMarketplaceAdmin(database, {
      username: 'admin',
      initialPassword: 'initial-password-123',
      requestId: 'bootstrap-for-reset',
    })
    const app = createMarketplaceApp({ database, allowedOrigin: 'https://marketplace.test' })
    const challengeResponse = await app.request('/api/v1/admin/auth/login-challenge')
    const challenge = await challengeResponse.json() as { data: { csrfToken: string } }
    const challengeCookie = challengeResponse.headers.getSetCookie()
      .find((value) => value.startsWith('proma_marketplace_admin_login_csrf='))
      ?.split(';', 1)[0]
    if (!challengeCookie) throw new Error('登录 challenge 缺少 Cookie')
    const loginResponse = await app.request('/api/v1/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://marketplace.test',
        'x-forwarded-for': '192.0.2.50',
        'x-csrf-token': challenge.data.csrfToken,
        cookie: challengeCookie,
      },
      body: JSON.stringify({ username: 'admin', password: 'initial-password-123' }),
    })
    if (!loginResponse.ok) throw new Error('测试前置登录失败')
  })

  afterAll(async () => {
    await closeSql(sql)
    await testDatabase.close()
  })

  test('Given 运维人员通过 stdin 输入两次新密码 When 执行重置 CLI Then 不泄密并撤销会话', async () => {
    const childProcess = Bun.spawn({
      cmd: [process.execPath, 'apps/marketplace-api/src/reset-admin-password.ts'],
      cwd: new URL('../../..', import.meta.url).pathname,
      env: {
        ...Bun.env,
        MARKETPLACE_DATABASE_URL: testDatabase.databaseUrl,
      },
      stdin: new Blob([`${resetPassword}\n${resetPassword}\n`]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      childProcess.exited,
      new Response(childProcess.stdout).text(),
      new Response(childProcess.stderr).text(),
    ])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('管理员密码已重置')
    expect(`${stdout}\n${stderr}`).not.toContain(resetPassword)
    expect(`${stdout}\n${stderr}`).not.toContain('token')

    const admins = await sql<{ password_hash: string; must_change_password: boolean }[]>`
      SELECT password_hash, must_change_password FROM admins WHERE id = 'primary'
    `
    const activeSessions = await sql<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count FROM admin_sessions WHERE invalidated_at IS NULL
    `
    const audits = await sql<{ action: string; request_id: string }[]>`
      SELECT action, request_id FROM audit_entries WHERE action = 'admin.password.reset'
    `

    expect(await Bun.password.verify(resetPassword, admins[0]!.password_hash)).toBe(true)
    expect(admins[0]!.must_change_password).toBe(true)
    expect(activeSessions[0]!.count).toBe(0)
    expect(audits).toHaveLength(1)
    expect(audits[0]!.request_id).not.toBe('')
  })

  test('Given 命令参数存在 When 执行重置 CLI Then 在读取密码前拒绝参数', async () => {
    const childProcess = Bun.spawn({
      cmd: [process.execPath, 'apps/marketplace-api/src/reset-admin-password.ts', 'unexpected-argument'],
      cwd: new URL('../../..', import.meta.url).pathname,
      env: { ...Bun.env, MARKETPLACE_DATABASE_URL: testDatabase.databaseUrl },
      stdin: new Blob([]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      childProcess.exited,
      new Response(childProcess.stdout).text(),
      new Response(childProcess.stderr).text(),
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toContain('此命令不接受密码或其他命令参数')
    expect(stdout).not.toContain('新密码:')
  })
})
