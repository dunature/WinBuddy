import { describe, expect, test } from 'bun:test'
import type { MarketplaceAdminUser } from '@proma/shared'
import { AdminAuthService, type AdminAuthRepository, type GitHubOAuthClient } from './admin-auth.ts'

const user: MarketplaceAdminUser = { githubLogin: 'proma-editor', displayName: 'Proma 编辑部', role: 'editor' }

class MemoryAuthRepository implements AdminAuthRepository {
  sessions = new Map<string, { login: string; expiresAt: Date }>()
  enabled = true
  async findEnabledUser(login: string) { return this.enabled && login === user.githubLogin ? user : undefined }
  async createSession(tokenHash: string, login: string, expiresAt: Date) { for (const [key, session] of this.sessions) if (session.login === login) this.sessions.delete(key); this.sessions.set(tokenHash, { login, expiresAt }) }
  async findSession(tokenHash: string, now: Date) { const session = this.sessions.get(tokenHash); return session && session.expiresAt > now && this.enabled ? user : undefined }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash) }
}

const github: GitHubOAuthClient = {
  getAuthorizeUrl: (state) => `https://github.test/oauth?state=${state}`,
  exchange: async () => ({ login: 'proma-editor', name: 'Proma 编辑部' }),
}

describe('AdminAuthService', () => {
  test('签名 state 只能在有效期内使用', () => {
    let now = new Date('2026-07-16T00:00:00Z')
    const auth = new AdminAuthService(new MemoryAuthRepository(), github, 'a'.repeat(32), () => now)
    const { state } = auth.createAuthorization()
    expect(auth.verifyState(state)).toBe(true)
    expect(auth.consumeState(state)).toBe(true)
    expect(auth.consumeState(state)).toBe(false)
    expect(auth.verifyState(`${state}x`)).toBe(false)
    now = new Date('2026-07-16T00:11:00Z')
    expect(auth.verifyState(state)).toBe(false)
  })

  test('仅 allowlist 用户获得可撤销 session', async () => {
    const repository = new MemoryAuthRepository()
    const auth = new AdminAuthService(repository, github, 'a'.repeat(32))
    const result = await auth.completeAuthorization('code')
    expect(result?.user.githubLogin).toBe('proma-editor')
    expect(await auth.getSession(result!.token)).toEqual(user)
    const rotated = await auth.completeAuthorization('second-code')
    expect(await auth.getSession(result!.token)).toBeUndefined()
    expect(await auth.getSession(rotated!.token)).toEqual(user)
    await auth.revoke(rotated!.token)
    expect(await auth.getSession(rotated!.token)).toBeUndefined()
    repository.enabled = false
    expect(await auth.completeAuthorization('code')).toBeUndefined()
  })
})
