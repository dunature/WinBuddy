import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
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

function fileSystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`测试文件系统错误: ${code}`), { code })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MarketplaceInstaller', () => {
  test('Given 下载中的安装 When 用户取消 Then 任务进入 cancelled 且清理临时资源', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const archive = createSkillArchive()
    let notifyDownloading: (() => void) | undefined
    const downloading = new Promise<void>((resolve) => { notifyDownloading = resolve })
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('已中止', 'AbortError')), { once: true })
      }),
      createInstallId: () => 'install-cancel-download',
      onProgress: (state) => {
        if (state.phase === 'downloading') notifyDownloading?.()
      },
    })

    const queued = installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })
    await downloading

    expect(installer.cancel(queued.installId)).toBe(true)
    const completed = await installer.waitForInstall(queued.installId)

    expect(completed.phase).toBe('cancelled')
    expect(completed.error).toBe('安装已取消')
    expect(existsSync(join(skillsDirectory, '.deep-research.install-cancel-download.staging'))).toBe(false)
    expect(existsSync(join(skillsDirectory, '.deep-research.install-cancel-download.zip'))).toBe(false)
  })

  test('Given 安装进入 extracting When 用户取消 Then 在提交前停止并清理已解压内容', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const archive = createSkillArchive()
    let installId = ''
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-cancel-extract',
      onProgress: (state) => {
        if (state.phase === 'extracting') installer.cancel(installId)
      },
    })

    const queued = installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })
    installId = queued.installId
    const completed = await installer.waitForInstall(queued.installId)

    expect(completed.phase).toBe('cancelled')
    expect(existsSync(join(skillsDirectory, 'deep-research'))).toBe(false)
    expect(existsSync(join(skillsDirectory, '.deep-research.install-cancel-extract.staging'))).toBe(false)
  })

  test('Given 安装已经进入 committing When 用户尝试取消 Then 拒绝取消并完成原子提交', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const archive = createSkillArchive()
    let cancelResult: boolean | undefined
    let installId = ''
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory: join(workspaceRoot, 'skills'),
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-commit-cancel',
      onProgress: (state) => {
        if (state.phase === 'committing') cancelResult = installer.cancel(installId)
      },
    })

    const queued = installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })
    installId = queued.installId
    const completed = await installer.waitForInstall(queued.installId)

    expect(cancelResult).toBe(false)
    expect(completed.phase).toBe('completed')
  })

  test('Given 工作区存在同名非 marketplace Skill When 安装 Then 返回可确认冲突且保留原目录', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'existing.txt'), '用户原有 Skill', 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-local-conflict',
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('failed')
    expect(completed.errorCode).toBe('TARGET_CONFLICT')
    expect(completed.conflict).toEqual({
      kind: 'non_marketplace',
      identifier: 'deep-research',
      location: 'enabled',
      replaceable: true,
    })
    expect(await Bun.file(join(existingDirectory, 'existing.txt')).text()).toBe('用户原有 Skill')
  })

  test('Given 用户明确确认原安装冲突 When 继续安装 Then 只替换该请求绑定的非市场 Skill', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'existing.txt'), '用户原有 Skill', 'utf8')
    const ids = ['install-conflict', 'install-confirmed']
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => ids.shift()!,
    })
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }
    const conflict = await installer.waitForInstall(installer.install(request).installId)

    const confirmed = installer.confirmConflict(conflict.installId)
    const completed = await installer.waitForInstall(confirmed.installId)

    expect(completed.phase).toBe('completed')
    expect(readFileSync(join(existingDirectory, 'SKILL.md'), 'utf8')).toContain('# Deep Research')
    expect(existsSync(join(existingDirectory, 'existing.txt'))).toBe(false)
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

  test('Given 同名目录属于另一个 marketplace ID When 安装 Then 返回不可替换冲突并拒绝确认', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'another-skill',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-marketplace-conflict',
    })

    const conflict = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(conflict.errorCode).toBe('TARGET_CONFLICT')
    expect(conflict.conflict).toEqual({
      kind: 'different_marketplace',
      identifier: 'deep-research',
      location: 'enabled',
      replaceable: false,
      existingMarketplaceSkillId: 'another-skill',
    })
    expect(() => installer.confirmConflict(conflict.installId)).toThrow('该安装任务没有可确认的同名冲突')
  })

  test('Given 同名目录含残缺的其他 marketplace 来源 When 安装 Then 仍拒绝替换该市场 Skill', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'another-skill',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-incomplete-marketplace-conflict',
    })

    const conflict = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(conflict.errorCode).toBe('TARGET_CONFLICT')
    expect(conflict.conflict).toEqual({
      kind: 'different_marketplace',
      identifier: 'deep-research',
      location: 'enabled',
      replaceable: false,
      existingMarketplaceSkillId: 'another-skill',
    })
  })

  test('Given 同名 Skill 属于另一个 marketplace ID When 请求更新 Then 拒绝跨来源替换', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'another-skill',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    writeFileSync(join(existingDirectory, 'existing.txt'), '另一个市场 Skill', 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory,
        inactiveSkillsDirectory: join(workspaceRoot, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'update-marketplace-mismatch',
    })

    const failed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(failed.phase).toBe('failed')
    expect(failed.errorCode).toBe('UPDATE_SOURCE_MISMATCH')
    expect(failed.error).toContain('不属于当前市场 Skill')
    expect(readFileSync(join(existingDirectory, 'existing.txt'), 'utf8')).toBe('另一个市场 Skill')
  })

  test('Given 已启用的同一市场 Skill When 更新到新版本 Then 原子替换内容并清理临时目录', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'SKILL.md'), '---\nname: deep-research\nversion: 1.0.0\n---\n旧版本', 'utf8')
    writeFileSync(join(existingDirectory, 'old-only.txt'), '应被替换', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'update-success',
      now: () => new Date('2026-07-18T08:00:00.000Z'),
    })

    const completed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('completed')
    expect(readFileSync(join(existingDirectory, 'SKILL.md'), 'utf8')).toContain('version: 1.2.0')
    expect(existsSync(join(existingDirectory, 'old-only.txt'))).toBe(false)
    expect(JSON.parse(readFileSync(join(existingDirectory, '.source.json'), 'utf8')).installedVersion).toBe('1.2.0')
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

  test('Given 本地旧版本与目标包 When 预览更新 Then 返回基于真实内容的新增修改删除 diff', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'SKILL.md'), '本地旧版内容', 'utf8')
    writeFileSync(join(existingDirectory, 'old-only.txt'), '仅旧版本存在', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'preview-update',
    })

    const preview = await installer.previewUpdate({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })

    expect(preview).toMatchObject({
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      targetVersion: '1.2.0',
      changes: [
        { path: 'SKILL.md', kind: 'modified' },
        { path: 'old-only.txt', kind: 'removed' },
        { path: 'references/guide.md', kind: 'added' },
      ],
    })
    expect(readdirSync(skillsDirectory).filter((name) => name.includes('preview-update'))).toEqual([])
  })

  test.skipIf(process.platform === 'win32')('Given 市场 Skill 目录是符号链接 When 预览更新 Then 拒绝读取工作区外目标', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const externalDirectory = join(workspaceRoot, 'external-skill')
    const archive = createSkillArchive()
    mkdirSync(skillsDirectory, { recursive: true })
    mkdirSync(externalDirectory)
    writeFileSync(join(externalDirectory, 'SKILL.md'), '外部内容', 'utf8')
    writeFileSync(join(externalDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    symlinkSync(externalDirectory, join(skillsDirectory, 'deep-research'))
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'preview-linked-target',
    })

    await expect(installer.previewUpdate({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })).rejects.toThrow('目标目录无效')
    expect(readFileSync(join(externalDirectory, 'SKILL.md'), 'utf8')).toBe('外部内容')
  })

  test('Given 已安装版本不低于目标版本 When 预览更新 Then 拒绝同版本或降级', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'SKILL.md'), '当前版本', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.2.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'preview-same-version',
    })

    await expect(installer.previewUpdate({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })).rejects.toThrow('目标版本必须高于已安装版本')
    expect(existsSync(join(skillsDirectory, '.deep-research.preview-same-version.preview.zip'))).toBe(false)
  })

  test('Given 已安装版本等于目标版本 When 正式更新 Then 在下载前返回稳定错误', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'SKILL.md'), '当前版本', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.2.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    let downloads = 0
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => {
        downloads += 1
        return new Response(Buffer.from(archive))
      },
      createInstallId: () => 'update-same-version',
    })

    const failed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(failed.errorCode).toBe('UPDATE_VERSION_NOT_NEWER')
    expect(downloads).toBe(0)
    expect(readFileSync(join(existingDirectory, 'SKILL.md'), 'utf8')).toBe('当前版本')
  })

  test('Given 已禁用的市场 Skill When 更新成功 Then 新版本仍保留在禁用目录', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(inactiveSkillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'SKILL.md'), '---\nname: deep-research\nversion: 1.0.0\n---\n', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'update-disabled',
    })

    const completed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('completed')
    expect(existsSync(join(skillsDirectory, 'deep-research'))).toBe(false)
    expect(readFileSync(join(existingDirectory, 'SKILL.md'), 'utf8')).toContain('version: 1.2.0')
    expect(readdirSync(inactiveSkillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

  test('Given 更新包 hash 错误 When 校验失败 Then 保留旧版本并清理下载与 staging', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'old.txt'), '必须保留的旧版本', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: {
        getInstallManifest: async () => ({ ...manifestFor(archive), sha256: '0'.repeat(64) }),
      },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'update-bad-hash',
    })

    const failed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(failed.errorCode).toBe('VERIFY_HASH')
    expect(readFileSync(join(existingDirectory, 'old.txt'), 'utf8')).toBe('必须保留的旧版本')
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

  test('Given 更新提交发生文件锁错误 When 原子切换失败 Then 从 backup 恢复旧版本', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'old.txt'), '回滚后仍存在', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'update-rollback',
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

    const failed = await installer.waitForInstall(installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(failed.errorCode).toBe('COMMIT_FAILED')
    expect(readFileSync(join(existingDirectory, 'old.txt'), 'utf8')).toBe('回滚后仍存在')
    expect(existsSync(join(existingDirectory, 'SKILL.md'))).toBe(false)
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

  test('Given 更新已进入解压阶段 When 用户取消 Then 保留旧版本并清理临时文件', async () => {
    const workspaceRoot = createTemporaryDirectory()
    const skillsDirectory = join(workspaceRoot, 'skills')
    const inactiveSkillsDirectory = join(workspaceRoot, 'skills-inactive')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'old.txt'), '取消后保留', 'utf8')
    writeFileSync(join(existingDirectory, '.source.json'), JSON.stringify({
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')
    let installId = ''
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({ skillsDirectory, inactiveSkillsDirectory }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'update-cancelled',
      onProgress: (state) => {
        if (state.phase === 'extracting') installer.cancel(installId)
      },
    })

    const queued = installer.update({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    })
    installId = queued.installId
    const cancelled = await installer.waitForInstall(queued.installId)

    expect(cancelled.phase).toBe('cancelled')
    expect(readFileSync(join(existingDirectory, 'old.txt'), 'utf8')).toBe('取消后保留')
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

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
    expect(completed.errorCode).toBe('VERIFY_HASH')
    expect(completed.failedAt).toBe('verifying')
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

  test('Given 下载遇到两次临时网络错误 When 第三次恢复 Then 有界重试后完成安装', async () => {
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
        if (requests < 3) throw new TypeError('fetch failed')
        return new Response(Buffer.from(archive))
      },
      createInstallId: () => 'install-network-retry',
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('completed')
    expect(requests).toBe(3)
  })

  test('Given Windows 提交遇到两次 EBUSY When 文件锁释放 Then 有界重试后原子安装', async () => {
    const root = createTemporaryDirectory()
    const archive = createSkillArchive()
    let commitAttempts = 0
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory: join(root, 'skills'), inactiveSkillsDirectory: join(root, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => 'install-file-retry',
      platform: 'win32',
      fileRetryDelay: async () => {},
      fileOperations: {
        rename: async (source, target) => {
          if (source.endsWith('.staging') && ++commitAttempts < 3) throw fileSystemError('EBUSY')
          await rename(source, target)
        },
        remove: rm,
      },
    })

    const completed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(completed.phase).toBe('completed')
    expect(commitAttempts).toBe(3)
    expect(existsSync(join(root, 'skills', 'deep-research', 'SKILL.md'))).toBe(true)
  })

  test('Given 已确认替换且 Windows 文件锁重试耗尽 When 提交失败 Then 恢复旧 Skill 并清理临时目录', async () => {
    const root = createTemporaryDirectory()
    const skillsDirectory = join(root, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'existing.txt'), '必须恢复的旧 Skill', 'utf8')
    let stagingRenameAttempts = 0
    const ids = ['install-retry-conflict', 'install-retry-confirmed']
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory, inactiveSkillsDirectory: join(root, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => ids.shift()!,
      platform: 'win32',
      fileRetryDelay: async () => {},
      fileOperations: {
        rename: async (source, target) => {
          if (source.endsWith('.staging')) {
            stagingRenameAttempts += 1
            throw fileSystemError('EBUSY')
          }
          await rename(source, target)
        },
        remove: rm,
      },
    })
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }
    const conflict = await installer.waitForInstall(installer.install(request).installId)

    const confirmed = installer.confirmConflict(conflict.installId)
    const failed = await installer.waitForInstall(confirmed.installId)

    expect(failed.phase).toBe('failed')
    expect(failed.errorCode).toBe('COMMIT_FAILED')
    expect(stagingRenameAttempts).toBe(5)
    expect(readFileSync(join(existingDirectory, 'existing.txt'), 'utf8')).toBe('必须恢复的旧 Skill')
    expect(existsSync(join(existingDirectory, 'SKILL.md'))).toBe(false)
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
  })

  test('Given 新目录已提交但旧 backup 删除重试耗尽 When 替换失败 Then 回滚到旧 Skill', async () => {
    const root = createTemporaryDirectory()
    const skillsDirectory = join(root, 'skills')
    const existingDirectory = join(skillsDirectory, 'deep-research')
    const archive = createSkillArchive()
    mkdirSync(existingDirectory, { recursive: true })
    writeFileSync(join(existingDirectory, 'existing.txt'), '删除 backup 失败时必须恢复', 'utf8')
    const ids = ['install-backup-conflict', 'install-backup-confirmed']
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory, inactiveSkillsDirectory: join(root, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      createInstallId: () => ids.shift()!,
      platform: 'win32',
      fileRetryDelay: async () => {},
      fileOperations: {
        rename,
        remove: async (target, options) => {
          if (target.endsWith('.backup')) throw fileSystemError('EBUSY')
          await rm(target, options)
        },
      },
    })
    const request = { workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0' }
    const conflict = await installer.waitForInstall(installer.install(request).installId)

    const confirmed = installer.confirmConflict(conflict.installId)
    const failed = await installer.waitForInstall(confirmed.installId)

    expect(failed.errorCode).toBe('COMMIT_FAILED')
    expect(readFileSync(join(existingDirectory, 'existing.txt'), 'utf8')).toBe('删除 backup 失败时必须恢复')
    expect(existsSync(join(existingDirectory, 'SKILL.md'))).toBe(false)
    expect(readdirSync(skillsDirectory).filter((name) => name.startsWith('.deep-research.'))).toEqual([])
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
    expect(completed.errorCode).toBe('DOWNLOAD_REDIRECT')
    expect(completed.failedAt).toBe('downloading')
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
    expect(completed.errorCode).toBe('DOWNLOAD_TOO_LARGE')
    expect(completed.failedAt).toBe('downloading')
  })

  test('Given 下载完成但磁盘写入失败 When 安装 Then 返回中文下载阶段错误', async () => {
    const root = createTemporaryDirectory()
    const archive = createSkillArchive()
    const installer = new MarketplaceInstaller({
      catalogClient: { getInstallManifest: async () => manifestFor(archive) },
      resolveWorkspaceDirectories: () => ({
        skillsDirectory: join(root, 'skills'), inactiveSkillsDirectory: join(root, 'skills-inactive'),
      }),
      fetchFn: async () => new Response(Buffer.from(archive)),
      archiveWriter: async () => { throw fileSystemError('ENOSPC') },
      createInstallId: () => 'install-disk-full',
    })

    const failed = await installer.waitForInstall(installer.install({
      workspaceSlug: 'research', marketplaceSkillId: 'skill-public', version: '1.2.0',
    }).installId)

    expect(failed.errorCode).toBe('DOWNLOAD_WRITE_FAILED')
    expect(failed.failedAt).toBe('downloading')
    expect(failed.error).toContain('保存技能包失败')
  })
})
