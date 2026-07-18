import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { MarketplaceInstallManifest } from '@proma/shared'
import { MarketplaceInstaller } from './marketplace-installer'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'proma-marketplace-installer-'))
  temporaryDirectories.push(directory)
  return directory
}

function createSkillArchive(identifier = 'deep-research', version = '1.2.0'): Uint8Array {
  const archive = new AdmZip()
  archive.addFile(`${identifier}/SKILL.md`, Buffer.from([
    '---',
    `name: ${identifier}`,
    'description: 生成可追溯的研究报告',
    `version: ${version}`,
    '---',
    '',
    '# Deep Research',
  ].join('\n')))
  archive.addFile(`${identifier}/references/guide.md`, Buffer.from('# 使用指南'))
  return archive.toBuffer()
}

function manifestFor(archive: Uint8Array): MarketplaceInstallManifest {
  return {
    marketplaceSkillId: 'skill-public',
    identifier: 'deep-research',
    version: '1.2.0',
    sha256: createHash('sha256').update(archive).digest('hex'),
    size: archive.byteLength,
    fileCount: 2,
    files: [],
    downloadUrl: 'https://marketplace.test/package.zip',
  }
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MarketplaceInstaller', () => {
  test('Given 合法已发布包 When 安装到真实工作区 Then 原子提交并记录 marketplace 来源', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const archive = createSkillArchive()
    const installer = new MarketplaceInstaller({
      catalogClient: {
        getInstallManifest: async () => manifestFor(archive),
      },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-success',
      now: () => new Date('2026-07-18T05:30:00.000Z'),
    })

    const queued = installer.install({
      workspaceSlug: 'research',
      marketplaceSkillId: 'skill-public',
      version: '1.2.0',
    })
    const completed = await installer.waitForInstall(queued.installId)
    const targetDirectory = join(skillsDirectory, 'deep-research')

    expect(completed.phase).toBe('completed')
    expect(readFileSync(join(targetDirectory, 'SKILL.md'), 'utf8')).toContain('# Deep Research')
    expect(JSON.parse(readFileSync(join(targetDirectory, '.source.json'), 'utf8'))).toEqual({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.2.0',
      contentHash: manifestFor(archive).sha256,
      installedAt: '2026-07-18T05:30:00.000Z',
    })
    expect(existsSync(join(skillsDirectory, '.deep-research.install-success.staging'))).toBe(false)
    expect(existsSync(join(skillsDirectory, '.deep-research.install-success.zip'))).toBe(false)
  })

  test('Given 下载包哈希错误 When 安装 Then 失败且清理临时文件和目标目录', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const archive = createSkillArchive()
    const invalidManifest = { ...manifestFor(archive), sha256: '0'.repeat(64) }
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => invalidManifest },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-bad-hash',
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.error).toBe('技能包 SHA-256 校验失败')
    expect(existsSync(join(skillsDirectory, 'deep-research'))).toBe(false)
    expect(existsSync(join(skillsDirectory, '.deep-research.install-bad-hash.staging'))).toBe(false)
    expect(existsSync(join(skillsDirectory, '.deep-research.install-bad-hash.zip'))).toBe(false)
  })

  test('Given ZIP 包含父目录路径 When 安装 Then 使用领域安全规则拒绝且不写入目标', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const archive = replaceArchivePath(
      createSkillArchive(),
      'deep-research/SKILL.md',
      '../abcdefghij/SKILL.md',
    )
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-unsafe-zip',
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.error).toContain('父目录路径')
    expect(existsSync(join(skillsDirectory, 'deep-research'))).toBe(false)
  })

  test('Given 同一目标已有任务 When 再次安装 Then 拒绝重复任务但允许其他工作区并发', async () => {
    const root = createTemporaryDirectory()
    const archive = createSkillArchive()
    let id = 0
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: (workspaceSlug) => ({
        skillsDirectory: join(root, workspaceSlug, 'skills'),
        inactiveSkillsDirectory: join(root, workspaceSlug, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => `install-${++id}`,
    })
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }

    const first = installer.install(request)
    expect(() => installer.install(request)).toThrow('该工作区的 Skill 已有安装任务进行中')
    const second = installer.install({ ...request, workspaceSlug: 'writing' })
    const completed = await Promise.all([
      installer.waitForInstall(first.installId),
      installer.waitForInstall(second.installId),
    ])

    expect(completed.map((state) => state.phase)).toEqual(['completed', 'completed'])
  })

  test('Given 下载连续重定向超过三次 When 安装 Then 停止跟随并返回失败', async () => {
    const root = createTemporaryDirectory()
    const archive = createSkillArchive()
    let requests = 0
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory: join(root, 'skills'), inactiveSkillsDirectory: join(root, 'skills-inactive'),
      }),
      fetchFn: async () => {
        requests += 1
        return new Response(null, { status: 302, headers: { location: `/redirect-${requests}` } })
      },
      createInstallId: () => 'install-redirects',
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.error).toBe('技能包下载重定向超过 3 次')
    expect(requests).toBe(4)
  })

  test('Given 响应声明超过 20 MB When 安装 Then 在读取响应体前拒绝', async () => {
    const root = createTemporaryDirectory()
    const archive = createSkillArchive()
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory: join(root, 'skills'), inactiveSkillsDirectory: join(root, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive), {
        headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
      }),
      createInstallId: () => 'install-response-limit',
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.error).toBe('技能包响应超过 20 MB')
  })
})
