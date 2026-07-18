import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { MarketplaceInstallManifest } from '@proma/shared'
import { createMarketplaceCatalogClient } from './marketplace-catalog-client'
import { MarketplaceInstaller, type MarketplaceInstallerOptions } from './marketplace-installer'

const originalHome = process.env.HOME
let temporaryHome: string | undefined
let server: ReturnType<typeof Bun.serve> | undefined

function createSkillArchive(): Uint8Array {
  const archive = new AdmZip()
  archive.addFile('deep-research/SKILL.md', Buffer.from([
    '---',
    'name: deep-research',
    'description: 生成可追溯的研究报告',
    'version: 1.2.0',
    '---',
    '',
    '# Deep Research',
  ].join('\n')))
  archive.addFile('deep-research/references/guide.md', Buffer.from('# 使用指南'))
  return archive.toBuffer()
}

function replaceArchivePath(archive: Uint8Array, source: string, target: string): Uint8Array {
  if (source.length !== target.length) throw new Error('测试 ZIP 路径长度必须一致')
  const content = Buffer.from(archive)
  const sourceBytes = Buffer.from(source)
  const targetBytes = Buffer.from(target)
  let offset = 0
  while ((offset = content.indexOf(sourceBytes, offset)) >= 0) {
    targetBytes.copy(content, offset)
    offset += targetBytes.byteLength
  }
  return content
}

interface TestApiOptions {
  sha256?: string
  onDownload?: () => void
  downloadResponse?: () => Response
}

function startTestApi(archive: Uint8Array, options: TestApiOptions = {}): string[] {
  const requestedPaths: string[] = []
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requestedPaths.push(url.pathname)
      if (url.pathname === '/api/v1/marketplace/skills/by-id/skill-public/versions/1.2.0/manifest') {
        const manifest: MarketplaceInstallManifest = {
          marketplaceSkillId: 'skill-public',
          identifier: 'deep-research',
          version: '1.2.0',
          sha256: options.sha256 ?? createHash('sha256').update(archive).digest('hex'),
          size: archive.byteLength,
          fileCount: 2,
          files: [],
          downloadUrl: `${server!.url.origin}/api/v1/marketplace/downloads/deep-research/1.2.0?expires=9999999999&signature=test`,
        }
        return Response.json({ data: manifest, requestId: 'request-manifest' })
      }
      if (url.pathname === '/api/v1/marketplace/downloads/deep-research/1.2.0') {
        options.onDownload?.()
        if (options.downloadResponse) return options.downloadResponse()
        return new Response(Buffer.from(archive), {
          headers: { 'content-length': String(archive.byteLength), 'content-type': 'application/zip' },
        })
      }
      return Response.json({
        error: { code: 'NOT_FOUND', message: '测试路由不存在' },
        requestId: 'request-not-found',
      }, { status: 404 })
    },
  })
  return requestedPaths
}

interface HttpInstallerOptions {
  createInstallId?: () => string
  onProgress?: MarketplaceInstallerOptions['onProgress']
  platform?: MarketplaceInstallerOptions['platform']
  fileRetryDelay?: MarketplaceInstallerOptions['fileRetryDelay']
  fileOperations?: MarketplaceInstallerOptions['fileOperations']
}

function createHttpInstaller(home: string, installId: string, options: HttpInstallerOptions = {}): {
  installer: MarketplaceInstaller
  workspaceRoot: string
} {
  const client = createMarketplaceCatalogClient({
    enableFixture: false,
    runtime: 'production',
    apiBaseUrl: `${server!.url.origin}/api/v1`,
  })
  const workspaceRoot = join(home, '.proma', 'agent-workspaces', 'research')
  return {
    workspaceRoot,
    installer: new MarketplaceInstaller({
      catalogClient: client,
      resolveWorkspaceDirectories: () => ({
        skillsDirectory: join(workspaceRoot, 'skills'),
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      createInstallId: options.createInstallId ?? (() => installId),
      now: () => new Date('2026-07-18T06:00:00.000Z'),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.fileRetryDelay ? { fileRetryDelay: options.fileRetryDelay } : {}),
      ...(options.fileOperations ? { fileOperations: options.fileOperations } : {}),
    }),
  }
}

function fileSystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`测试文件系统错误: ${code}`), { code })
}

function createTemporaryHome(): string {
  temporaryHome = mkdtempSync(join(tmpdir(), 'proma-marketplace-home-'))
  process.env.HOME = temporaryHome
  return temporaryHome
}

afterEach(() => {
  server?.stop(true)
  server = undefined
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (temporaryHome) rmSync(temporaryHome, { recursive: true, force: true })
  temporaryHome = undefined
})

describe('Marketplace 安装 HTTP 集成', () => {
  test('Given 临时 HOME 的 HTTP 下载仍在进行 When 用户取消 Then 清理下载与 staging', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    startTestApi(archive, {
      downloadResponse: () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(archive.slice(0, 8))
        },
      })),
    })
    let notifyDownloading: (() => void) | undefined
    const downloading = new Promise<void>((resolve) => { notifyDownloading = resolve })
    const { installer, workspaceRoot } = createHttpInstaller(home, 'install-http-cancel', {
      onProgress: (state) => {
        if (state.phase === 'downloading') notifyDownloading?.()
      },
    })
    const queued = installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })
    await downloading

    expect(installer.cancel(queued.installId)).toBe(true)
    const cancelled = await installer.waitForInstall(queued.installId)

    expect(cancelled.phase).toBe('cancelled')
    expect(existsSync(join(workspaceRoot, 'skills', 'deep-research'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http-cancel.staging'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http-cancel.zip'))).toBe(false)
  })

  test('Given 临时 HOME 存在同名本地 Skill When 拒绝后再确认 Then 通过原 installId 安全替换', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    startTestApi(archive)
    const workspaceRoot = join(home, '.proma', 'agent-workspaces', 'research')
    const existingDirectory = join(workspaceRoot, 'skills', 'deep-research')
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'existing.txt'), '本地 Skill', 'utf8')
    const ids = ['install-http-conflict', 'install-http-confirmed']
    const { installer } = createHttpInstaller(home, '', { createInstallId: () => ids.shift()! })
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }

    const conflict = await installer.waitForInstall(installer.install(request).installId)
    expect(conflict.conflict?.replaceable).toBe(true)
    expect(readFileSync(join(existingDirectory, 'existing.txt'), 'utf8')).toBe('本地 Skill')

    const confirmed = installer.confirmConflict(conflict.installId)
    expect((await installer.waitForInstall(confirmed.installId)).phase).toBe('completed')
    expect(existsSync(join(existingDirectory, 'existing.txt'))).toBe(false)
    expect(readFileSync(join(existingDirectory, 'SKILL.md'), 'utf8')).toContain('# Deep Research')
  })

  test('Given Windows 文件锁重试耗尽 When HTTP 安装替换提交 Then 恢复旧目录并清理 backup', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    startTestApi(archive)
    const workspaceRoot = join(home, '.proma', 'agent-workspaces', 'research')
    const skillsDirectory = join(workspaceRoot, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'existing.txt'), '必须保留', 'utf8')
    const ids = ['install-http-lock-conflict', 'install-http-lock-confirmed']
    const { installer } = createHttpInstaller(home, '', {
      createInstallId: () => ids.shift()!,
      platform: 'win32',
      fileRetryDelay: async () => {},
      fileOperations: {
        rename: async (source, target) => {
          if (source.endsWith('.staging')) throw fileSystemError('EBUSY')
          await rename(source, target)
        },
        remove: rm,
      },
    })
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }
    const conflict = await installer.waitForInstall(installer.install(request).installId)

    const confirmed = installer.confirmConflict(conflict.installId)
    const failed = await installer.waitForInstall(confirmed.installId)

    expect(failed.errorCode).toBe('COMMIT_FAILED')
    expect(readFileSync(join(existingDirectory, 'existing.txt'), 'utf8')).toBe('必须保留')
    expect(existsSync(join(existingDirectory, 'SKILL.md'))).toBe(false)
    expect((await Array.fromAsync(new Bun.Glob('.deep-research.*').scan(skillsDirectory)))).toEqual([])
  })

  test('Given 临时 HOME 与测试 API When 按市场 ID 安装 Then 经真实 manifest 和下载路由原子写入工作区', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    const requestedPaths = startTestApi(archive)
    const { installer, workspaceRoot } = createHttpInstaller(home, 'install-http')

    const queued = installer.install({
      workspaceSlug: 'research',
      marketplaceSkillId: 'skill-public',
      version: '1.2.0',
    })
    const completed = await installer.waitForInstall(queued.installId)
    const installedDirectory = join(workspaceRoot, 'skills', 'deep-research')

    expect(completed.phase).toBe('completed')
    expect(requestedPaths).toEqual([
      '/api/v1/marketplace/skills/by-id/skill-public/versions/1.2.0/manifest',
      '/api/v1/marketplace/downloads/deep-research/1.2.0',
    ])
    expect(readFileSync(join(installedDirectory, 'SKILL.md'), 'utf8')).toContain('# Deep Research')
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http.staging'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http.zip'))).toBe(false)
  })

  test('Given 临时 HOME 已安装旧版本 When 通过真实 HTTP 更新 Then 获取可信 manifest 并原子替换', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    const requestedPaths = startTestApi(archive)
    const workspaceRoot = join(home, '.proma', 'agent-workspaces', 'research')
    const installedDirectory = join(workspaceRoot, 'skills', 'deep-research')
    mkdirSync(installedDirectory, { recursive: true })
    writeFileSync(join(installedDirectory, 'old.txt'), '旧版本', 'utf8')
    writeFileSync(join(installedDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const { installer } = createHttpInstaller(home, 'update-http')

    const completed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('completed')
    expect(requestedPaths).toEqual([
      '/api/v1/marketplace/skills/by-id/skill-public/versions/1.2.0/manifest',
      '/api/v1/marketplace/downloads/deep-research/1.2.0',
    ])
    expect(existsSync(join(installedDirectory, 'old.txt'))).toBe(false)
    expect(readFileSync(join(installedDirectory, 'SKILL.md'), 'utf8')).toContain('version: 1.2.0')
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.update-http.backup'))).toBe(false)
  })

  test('Given 临时 HOME 已安装旧版本 When 通过真实 HTTP 预览 Then 返回内容 diff 并清理预览包', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    const requestedPaths = startTestApi(archive)
    const workspaceRoot = join(home, '.proma', 'agent-workspaces', 'research')
    const installedDirectory = join(workspaceRoot, 'skills', 'deep-research')
    mkdirSync(installedDirectory, { recursive: true })
    writeFileSync(join(installedDirectory, 'SKILL.md'), '旧版 Skill', 'utf8')
    writeFileSync(join(installedDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const { installer } = createHttpInstaller(home, 'preview-http')

    const preview = await installer.previewUpdate({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })

    expect(requestedPaths).toEqual([
      '/api/v1/marketplace/skills/by-id/skill-public/versions/1.2.0/manifest',
      '/api/v1/marketplace/downloads/deep-research/1.2.0',
    ])
    expect(preview.changes).toEqual([
      expect.objectContaining({ path: 'SKILL.md', kind: 'modified' }),
      expect.objectContaining({ path: 'references/guide.md', kind: 'added' }),
    ])
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.preview-http.preview.zip'))).toBe(false)
  })

  test('Given 测试 API 返回错误 hash When 安装 Then 失败且临时 HOME 中没有目标或临时文件', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    startTestApi(archive, { sha256: '0'.repeat(64) })
    const { installer, workspaceRoot } = createHttpInstaller(home, 'install-http-hash')

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.error).toBe('技能包 SHA-256 校验失败')
    expect(existsSync(join(workspaceRoot, 'skills', 'deep-research'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http-hash.zip'))).toBe(false)
  })

  test('Given 测试 API 返回路径穿越 ZIP When 安装 Then 安全拒绝且不写入目标', async () => {
    const home = createTemporaryHome()
    const archive = replaceArchivePath(
      createSkillArchive(),
      'deep-research/SKILL.md',
      '../abcdefghij/SKILL.md',
    )
    startTestApi(archive)
    const { installer, workspaceRoot } = createHttpInstaller(home, 'install-http-unsafe')

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.error).toContain('父目录路径')
    expect(existsSync(join(workspaceRoot, 'skills', 'deep-research'))).toBe(false)
  })

  test('Given 测试 API 安装尚未完成 When 同目标再次提交 Then 同步拒绝重复任务', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    startTestApi(archive)
    const { installer } = createHttpInstaller(home, 'install-http-concurrent')
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }

    const first = installer.install(request)
    expect(() => installer.install(request)).toThrow('该工作区的 Skill 已有安装任务进行中')
    expect((await installer.waitForInstall(first.installId)).phase).toBe('completed')
  })

  test('Given 原子提交前目标目录被占用 When rename 失败 Then 清理 staging 且不留下半安装内容', async () => {
    const home = createTemporaryHome()
    const archive = createSkillArchive()
    const workspaceRoot = join(home, '.proma', 'agent-workspaces', 'research')
    const occupiedTarget = join(workspaceRoot, 'skills', 'deep-research')
    startTestApi(archive, {
      onDownload: () => {
        mkdirSync(occupiedTarget, { recursive: true })
        writeFileSync(join(occupiedTarget, 'existing.txt'), '保留现有目录', 'utf8')
      },
    })
    const { installer } = createHttpInstaller(home, 'install-http-commit-failure')

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(readFileSync(join(occupiedTarget, 'existing.txt'), 'utf8')).toBe('保留现有目录')
    expect(existsSync(join(occupiedTarget, 'SKILL.md'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http-commit-failure.staging'))).toBe(false)
    expect(existsSync(join(workspaceRoot, 'skills', '.deep-research.install-http-commit-failure.zip'))).toBe(false)
  })
})
