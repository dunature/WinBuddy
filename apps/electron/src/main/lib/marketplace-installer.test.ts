import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { MarketplaceInstallState } from '@proma/shared'
import { cancelMarketplaceInstall, createMarketplaceInstall, getMarketplaceInstallerSession, startMarketplaceInstall } from './marketplace-installer'

const home = mkdtempSync(join(tmpdir(), 'proma-marketplace-home-'))
const configDir = join(home, '.proma')
const zipPath = join(home, 'skill.zip')
let advertisedHash = ''
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  process.env.HOME = home
  process.env.PROMA_CONFIG_DIR = configDir
  const zip = new AdmZip()
  zip.addFile('SKILL.md', Buffer.from(`---
schema_version: 1
name: research
display_name: Research
description: A valid marketplace research skill for integration testing
version: 1.0.0
author:
  handle: proma
  name: Proma
category: research
license: MIT
permissions:
  network: false
  filesystem:
    read: false
    write: none
  shell: false
---
# Research
`))
  zip.addFile('references/guide.md', Buffer.from('# Guide'))
  zip.writeZip(zipPath)
  advertisedHash = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'agent-workspaces.json'), JSON.stringify({ version: 2, workspaces: [{ id: 'w1', name: 'Test', slug: 'test-workspace', createdAt: 1, updatedAt: 1 }] }))
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/package.zip') return new Response(Bun.file(zipPath), { headers: { 'content-length': String(Bun.file(zipPath).size) } })
      return Response.json({ skillId: 'skill-1', slug: 'research', version: '1.0.0', sha256: advertisedHash, size: Bun.file(zipPath).size, downloadUrl: `${url.origin}/package.zip`, expiresAt: new Date(Date.now() + 60_000).toISOString() })
    },
  })
  writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ marketplaceApiUrl: `${server.url.origin}` }))
})

afterAll(() => {
  server.stop(true)
  delete process.env.PROMA_CONFIG_DIR
  rmSync(home, { recursive: true, force: true })
})

describe('Marketplace 安装下载与 staging', () => {
  test('完成下载、hash、ZIP 预检并只解压到临时 staging', async () => {
    const created = createMarketplaceInstall({ skillId: 'skill-1', slug: 'research', version: '1.0.0', workspaceSlug: 'test-workspace' })
    const states: MarketplaceInstallState[] = []
    await startMarketplaceInstall(created.installId, (state) => states.push(state))
    const session = getMarketplaceInstallerSession(created.installId)
    expect(session).toBeDefined()
    expect(existsSync(join(session?.stagingDir ?? '', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(configDir, 'agent-workspaces', 'test-workspace', 'skills', 'research'))).toBe(false)
    expect(states.at(-1)).toEqual({ status: 'verifying', installId: created.installId, step: 'manifest' })
    expect(cancelMarketplaceInstall(created.installId)).toBe(true)
  })

  test('hash 不符时清理任务和临时目录', async () => {
    advertisedHash = '0'.repeat(64)
    const created = createMarketplaceInstall({ skillId: 'skill-1', slug: 'research', version: '1.0.0', workspaceSlug: 'test-workspace' })
    const tempDir = getMarketplaceInstallerSession(created.installId)?.tempDir ?? ''
    const states: MarketplaceInstallState[] = []
    await expect(startMarketplaceInstall(created.installId, (state) => states.push(state))).rejects.toThrow('完整性校验失败')
    expect(states.at(-1)?.status).toBe('error')
    expect(existsSync(tempDir)).toBe(false)
    expect(getMarketplaceInstallerSession(created.installId)).toBeUndefined()
  })
})
