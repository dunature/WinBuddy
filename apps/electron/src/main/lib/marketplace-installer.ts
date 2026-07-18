import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MARKETPLACE_ZIP_LIMITS,
  compareMarketplaceSemVer,
  isMarketplaceIdentifier,
  isMarketplaceSemVer,
} from '@proma/marketplace-domain'
import type {
  MarketplaceInstallAction,
  MarketplaceInstallConflict,
  MarketplaceInstallErrorCode,
  MarketplaceInstallFailurePhase,
  MarketplaceInstallManifest,
  MarketplaceInstallRequest,
  MarketplaceInstallState,
  MarketplaceInstallStatus,
  MarketplaceSkillImportSource,
  MarketplaceUpdateFileChange,
  MarketplaceUpdatePreview,
} from '@proma/shared'
import type { MarketplaceCatalogClient } from './marketplace-catalog-client'
import {
  extractMarketplaceArchive,
  inspectMarketplaceArchive,
  snapshotMarketplaceArchive,
} from './marketplace-archive'

interface WorkspaceDirectories {
  skillsDirectory: string
  inactiveSkillsDirectory: string
}

interface MarketplaceRemoveOptions {
  recursive?: boolean
  force?: boolean
}

interface MarketplaceFileOperations {
  rename(source: string, target: string): Promise<void>
  remove(target: string, options: MarketplaceRemoveOptions): Promise<void>
}

type MarketplaceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type MarketplaceArchiveWriter = (target: string, content: Uint8Array) => Promise<void>

export interface MarketplaceInstallerOptions {
  catalogClient: Pick<MarketplaceCatalogClient, 'getInstallManifest'>
  resolveWorkspaceDirectories(workspaceSlug: string): WorkspaceDirectories
  fetchFn?: MarketplaceFetch
  archiveWriter?: MarketplaceArchiveWriter
  onProgress?: (state: MarketplaceInstallState) => void
  createInstallId?: () => string
  now?: () => Date
  platform?: NodeJS.Platform
  fileRetryDelay?: (delayMs: number) => Promise<void>
  fileOperations?: MarketplaceFileOperations
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function retryableFileSystemCodes(platform: NodeJS.Platform): ReadonlySet<string> {
  return new Set(platform === 'win32'
    ? ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']
    : ['EBUSY', 'ENOTEMPTY'])
}

async function defaultFileRetryDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

class MarketplaceInstallerError extends Error {
  constructor(
    readonly code: MarketplaceInstallErrorCode,
    message: string,
    readonly conflict?: MarketplaceInstallConflict,
    readonly retryable = false,
  ) {
    super(message)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '技能安装失败'
}

async function readMarketplaceSkillId(skillDirectory: string): Promise<string | undefined> {
  try {
    const sourcePath = join(skillDirectory, '.source.json')
    const sourceStat = await lstat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) return undefined
    const value = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    return source.kind === 'marketplace' && typeof source.marketplaceSkillId === 'string'
      ? source.marketplaceSkillId
      : undefined
  } catch {
    return undefined
  }
}

async function readMarketplaceSource(skillDirectory: string): Promise<MarketplaceSkillImportSource | undefined> {
  try {
    const sourcePath = join(skillDirectory, '.source.json')
    const sourceStat = await lstat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) return undefined
    const value = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    const fields = ['marketplaceSkillId', 'identifier', 'installedVersion', 'contentHash', 'installedAt'] as const
    if (
      source.kind !== 'marketplace'
      || !fields.every((field) => typeof source[field] === 'string' && source[field].length > 0)
    ) return undefined
    return {
      kind: 'marketplace',
      marketplaceSkillId: source.marketplaceSkillId as string,
      identifier: source.identifier as string,
      installedVersion: source.installedVersion as string,
      contentHash: source.contentHash as string,
      installedAt: source.installedAt as string,
    }
  } catch {
    return undefined
  }
}

async function assertSafeWorkspaceSkillDirectory(directory: string): Promise<void> {
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('市场 Skill 目标目录无效')
  }
}

interface MarketplaceFileSnapshot {
  size: number
  sha256: string
}

async function snapshotWorkspaceDirectory(
  directory: string,
  relativeDirectory = '',
  snapshots = new Map<string, MarketplaceFileSnapshot>(),
): Promise<Map<string, MarketplaceFileSnapshot>> {
  const entries = await readdir(join(directory, relativeDirectory), { withFileTypes: true })
  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
    if (relativePath === '.source.json') continue
    if (entry.isSymbolicLink()) throw new Error(`工作区 Skill 包含符号链接，无法安全更新: ${relativePath}`)
    if (entry.isDirectory()) {
      await snapshotWorkspaceDirectory(directory, relativePath, snapshots)
      continue
    }
    if (!entry.isFile()) throw new Error(`工作区 Skill 包含不支持的文件类型: ${relativePath}`)
    const content = await readFile(join(directory, ...relativePath.split('/')))
    snapshots.set(relativePath, {
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }
  return snapshots
}

function diffMarketplaceFiles(
  current: Map<string, MarketplaceFileSnapshot>,
  target: Map<string, MarketplaceFileSnapshot>,
): MarketplaceUpdateFileChange[] {
  const paths = [...new Set([...current.keys(), ...target.keys()])].sort()
  const changes: MarketplaceUpdateFileChange[] = []
  for (const path of paths) {
    const before = current.get(path)
    const after = target.get(path)
    if (!before && after) changes.push({ path, kind: 'added', afterSize: after.size })
    else if (before && !after) changes.push({ path, kind: 'removed', beforeSize: before.size })
    else if (before && after && before.sha256 !== after.sha256) {
      changes.push({ path, kind: 'modified', beforeSize: before.size, afterSize: after.size })
    }
  }
  return changes
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeoutId)
      reject(signal.reason)
    }
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function downloadPackageOnce(
  initialUrl: string,
  targetPath: string,
  fetchFn: MarketplaceFetch,
  archiveWriter: MarketplaceArchiveWriter,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchFn(url, { redirect: 'manual', signal })
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new MarketplaceInstallerError('DOWNLOAD_REDIRECT', '技能包重定向缺少目标地址')
      if (redirects === 3) throw new MarketplaceInstallerError('DOWNLOAD_REDIRECT', '技能包下载重定向超过 3 次')
      url = new URL(location, url).toString()
      continue
    }
    if (!response.ok || !response.body) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      throw new MarketplaceInstallerError(
        'DOWNLOAD_HTTP',
        `技能包下载失败（HTTP ${response.status}）`,
        undefined,
        retryable,
      )
    }
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
      throw new MarketplaceInstallerError('DOWNLOAD_TOO_LARGE', '技能包响应超过 20 MB')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
        await reader.cancel()
        throw new MarketplaceInstallerError('DOWNLOAD_TOO_LARGE', '技能包响应超过 20 MB')
      }
      chunks.push(result.value)
    }
    const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    try {
      await archiveWriter(targetPath, content)
    } catch (error) {
      throw new MarketplaceInstallerError('DOWNLOAD_WRITE_FAILED', `保存技能包失败：${errorMessage(error)}`)
    }
    return content
  }
  throw new MarketplaceInstallerError('DOWNLOAD_NETWORK', '技能包下载失败，请检查网络后重试')
}

async function downloadPackage(
  initialUrl: string,
  targetPath: string,
  fetchFn: MarketplaceFetch,
  archiveWriter: MarketplaceArchiveWriter,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await downloadPackageOnce(initialUrl, targetPath, fetchFn, archiveWriter, signal)
    } catch (error) {
      lastError = error
      const retryable = error instanceof TypeError
        || (error instanceof MarketplaceInstallerError && error.retryable)
      if (signal.aborted || !retryable) throw error
      if (attempt === 3) {
        if (error instanceof MarketplaceInstallerError) throw error
        throw new MarketplaceInstallerError('DOWNLOAD_NETWORK', '技能包下载失败，请检查网络后重试')
      }
      await waitForRetry(50 * 2 ** (attempt - 1), signal)
    }
  }
  throw lastError
}

export class MarketplaceInstaller {
  private readonly installs = new Map<string, MarketplaceInstallState>()
  private readonly completions = new Map<string, Promise<MarketplaceInstallState>>()
  private readonly activeTargets = new Map<string, string>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly fetchFn: MarketplaceFetch
  private readonly archiveWriter: MarketplaceArchiveWriter
  private readonly createInstallId: () => string
  private readonly now: () => Date
  private readonly fileOperations: MarketplaceFileOperations
  private readonly fileRetryDelay: (delayMs: number) => Promise<void>
  private readonly retryableFileCodes: ReadonlySet<string>

  constructor(private readonly options: MarketplaceInstallerOptions) {
    this.fetchFn = options.fetchFn ?? fetch
    this.archiveWriter = options.archiveWriter ?? writeFile
    this.createInstallId = options.createInstallId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.fileOperations = options.fileOperations ?? { rename, remove: rm }
    this.fileRetryDelay = options.fileRetryDelay ?? defaultFileRetryDelay
    this.retryableFileCodes = retryableFileSystemCodes(options.platform ?? process.platform)
  }

  listInstalls(): MarketplaceInstallState[] {
    return [...this.installs.values()]
  }

  getInstall(installId: string): MarketplaceInstallState | undefined {
    return this.installs.get(installId)
  }

  getStatus(installId: string): MarketplaceInstallStatus | undefined {
    const state = this.installs.get(installId)
    if (!state) return undefined
    return {
      installId,
      phase: state.phase,
      ...(state.error ? { error: state.error } : {}),
      ...(state.errorCode ? { errorCode: state.errorCode } : {}),
      ...(state.failedAt ? { failedAt: state.failedAt } : {}),
      ...(state.conflict ? { conflict: state.conflict } : {}),
    }
  }

  install(request: MarketplaceInstallRequest): MarketplaceInstallState {
    return this.start('install', request)
  }

  update(request: MarketplaceInstallRequest): MarketplaceInstallState {
    return this.start('update', request)
  }

  async previewUpdate(request: MarketplaceInstallRequest): Promise<MarketplaceUpdatePreview> {
    if (!request.workspaceSlug.trim() || !request.marketplaceSkillId.trim() || !isMarketplaceSemVer(request.version)) {
      throw new Error('更新预览请求参数无效')
    }
    const manifest = await this.options.catalogClient.getInstallManifest(request.marketplaceSkillId, request.version)
    this.assertManifest(manifest, request.marketplaceSkillId, request.version)
    const { skillsDirectory, inactiveSkillsDirectory } = this.options.resolveWorkspaceDirectories(request.workspaceSlug)
    const enabledDirectory = join(skillsDirectory, manifest.identifier)
    const disabledDirectory = join(inactiveSkillsDirectory, manifest.identifier)
    const installedDirectory = existsSync(enabledDirectory)
      ? enabledDirectory
      : existsSync(disabledDirectory)
        ? disabledDirectory
        : undefined
    if (installedDirectory) await assertSafeWorkspaceSkillDirectory(installedDirectory)
    const source = installedDirectory ? await readMarketplaceSource(installedDirectory) : undefined
    if (
      !installedDirectory
      || !source
      || source.marketplaceSkillId !== request.marketplaceSkillId
      || source.identifier !== manifest.identifier
    ) {
      throw new MarketplaceInstallerError(
        'UPDATE_SOURCE_MISMATCH',
        `同名 Skill 不属于当前市场 Skill，无法预览更新: ${manifest.identifier}`,
      )
    }
    if (compareMarketplaceSemVer(manifest.version, source.installedVersion) <= 0) {
      throw new MarketplaceInstallerError(
        'UPDATE_VERSION_NOT_NEWER',
        `目标版本必须高于已安装版本: ${source.installedVersion} → ${manifest.version}`,
      )
    }

    const previewId = this.createInstallId()
    const archivePath = join(dirname(installedDirectory), `.${manifest.identifier}.${previewId}.preview.zip`)
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), 60_000)
    try {
      const archive = await downloadPackage(
        manifest.downloadUrl!,
        archivePath,
        this.fetchFn,
        this.archiveWriter,
        timeoutController.signal,
      )
      if (archive.byteLength !== manifest.size) {
        throw new MarketplaceInstallerError('VERIFY_SIZE', '技能包大小与 manifest 不一致')
      }
      const actualHash = createHash('sha256').update(archive).digest('hex')
      if (actualHash !== manifest.sha256.replace(/^sha256:/, '').toLocaleLowerCase('en-US')) {
        throw new MarketplaceInstallerError('VERIFY_HASH', '技能包 SHA-256 校验失败')
      }
      const validation = await inspectMarketplaceArchive(
        archivePath,
        manifest.identifier,
        manifest.version,
        timeoutController.signal,
      )
      if (!validation.passed) {
        const firstFailure = validation.checks.find((check) => !check.passed)
        throw new MarketplaceInstallerError('VERIFY_ARCHIVE', firstFailure?.message ?? '技能包安全校验失败')
      }
      const currentFiles = await snapshotWorkspaceDirectory(installedDirectory)
      const targetFiles = new Map(
        (await snapshotMarketplaceArchive(archivePath, manifest.identifier, timeoutController.signal))
          .map((file) => [file.path, { size: file.size, sha256: file.sha256 }]),
      )
      return {
        ...request,
        identifier: manifest.identifier,
        installedVersion: source.installedVersion,
        targetVersion: manifest.version,
        changes: diffMarketplaceFiles(currentFiles, targetFiles),
      }
    } finally {
      clearTimeout(timeoutId)
      await this.removeWithRetry(archivePath, { force: true })
    }
  }

  confirmConflict(installId: string): MarketplaceInstallState {
    const state = this.installs.get(installId)
    if (
      !state
      || state.phase !== 'failed'
      || state.errorCode !== 'TARGET_CONFLICT'
      || !state.conflict?.replaceable
    ) {
      throw new Error('该安装任务没有可确认的同名冲突')
    }
    return this.start('install', {
      workspaceSlug: state.workspaceSlug,
      marketplaceSkillId: state.marketplaceSkillId,
      version: state.version,
    }, state.conflict)
  }

  cancel(installId: string): boolean {
    const state = this.installs.get(installId)
    if (!state || state.phase === 'committing') return false
    const controller = this.controllers.get(installId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async waitForInstall(installId: string): Promise<MarketplaceInstallState> {
    const completion = this.completions.get(installId)
    if (!completion) throw new Error(`安装任务不存在: ${installId}`)
    return completion
  }

  private start(
    action: MarketplaceInstallAction,
    request: MarketplaceInstallRequest,
    confirmedConflict?: MarketplaceInstallConflict,
  ): MarketplaceInstallState {
    if (!request.workspaceSlug.trim() || !request.marketplaceSkillId.trim() || !isMarketplaceSemVer(request.version)) {
      throw new Error('安装请求参数无效')
    }
    const targetKey = `${request.workspaceSlug}\0${request.marketplaceSkillId}`
    if (this.activeTargets.has(targetKey)) throw new Error('该工作区的 Skill 已有安装任务进行中')

    const installId = this.createInstallId()
    const timestamp = this.now().toISOString()
    const state: MarketplaceInstallState = {
      ...request,
      installId,
      action,
      phase: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const controller = new AbortController()
    this.installs.set(installId, state)
    this.activeTargets.set(targetKey, installId)
    this.controllers.set(installId, controller)
    this.emitProgress(state)

    const completion = Promise.resolve()
      .then(() => this.run(state, controller.signal, confirmedConflict))
      .catch((error: unknown) => {
        const installerError = error instanceof MarketplaceInstallerError ? error : undefined
        const currentPhase = this.installs.get(installId)?.phase
        const failedAt = currentPhase && !['completed', 'failed', 'cancelled'].includes(currentPhase)
          ? currentPhase as MarketplaceInstallFailurePhase
          : undefined
        return this.setState(installId, {
          phase: controller.signal.aborted ? 'cancelled' : 'failed',
          error: controller.signal.aborted ? '安装已取消' : errorMessage(error),
          ...(installerError ? { errorCode: installerError.code } : {}),
          ...(!controller.signal.aborted && failedAt ? { failedAt } : {}),
          ...(installerError?.conflict ? { conflict: installerError.conflict } : {}),
        })
      })
      .finally(() => {
        this.activeTargets.delete(targetKey)
        this.controllers.delete(installId)
      })
    this.completions.set(installId, completion)
    return state
  }

  private setState(
    installId: string,
    changes: Pick<MarketplaceInstallState, 'phase'> & Partial<Pick<MarketplaceInstallState, 'identifier' | 'error' | 'errorCode' | 'failedAt' | 'conflict'>>,
  ): MarketplaceInstallState {
    const current = this.installs.get(installId)
    if (!current) throw new Error(`安装任务不存在: ${installId}`)
    const next = { ...current, ...changes, updatedAt: this.now().toISOString() }
    this.installs.set(installId, next)
    this.emitProgress(next)
    return next
  }

  private emitProgress(state: MarketplaceInstallState): void {
    try {
      this.options.onProgress?.(state)
    } catch (error) {
      console.warn('[技能市场] 推送安装进度失败:', error)
    }
  }

  private async retryFileOperation(operation: () => Promise<void>): Promise<void> {
    let lastError: unknown
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await operation()
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (!code || !this.retryableFileCodes.has(code) || attempt === 5) throw error
        await this.fileRetryDelay(50 * 2 ** (attempt - 1))
      }
    }
    throw lastError
  }

  private async renameWithRetry(source: string, target: string): Promise<void> {
    await this.retryFileOperation(() => this.fileOperations.rename(source, target))
  }

  private async removeWithRetry(target: string, options: MarketplaceRemoveOptions): Promise<void> {
    await this.retryFileOperation(() => this.fileOperations.remove(target, options))
  }

  private async replaceWithRollback(
    stagingDirectory: string,
    replacementDirectory: string,
    backupDirectory: string,
  ): Promise<void> {
    await this.renameWithRetry(replacementDirectory, backupDirectory)
    let newSkillCommitted = false
    try {
      await this.renameWithRetry(stagingDirectory, replacementDirectory)
      newSkillCommitted = true
      await this.removeWithRetry(backupDirectory, { recursive: true, force: true })
    } catch (error) {
      if (newSkillCommitted && existsSync(replacementDirectory)) {
        await this.renameWithRetry(replacementDirectory, stagingDirectory)
      }
      if (existsSync(backupDirectory) && !existsSync(replacementDirectory)) {
        await this.renameWithRetry(backupDirectory, replacementDirectory)
      }
      throw error
    }
  }

  private async run(
    initialState: MarketplaceInstallState,
    signal: AbortSignal,
    confirmedConflict?: MarketplaceInstallConflict,
  ): Promise<MarketplaceInstallState> {
    const { installId, marketplaceSkillId, version, workspaceSlug } = initialState
    const manifest = await this.options.catalogClient.getInstallManifest(marketplaceSkillId, version)
    signal.throwIfAborted()
    this.assertManifest(manifest, marketplaceSkillId, version)
    const { skillsDirectory, inactiveSkillsDirectory } = this.options.resolveWorkspaceDirectories(workspaceSlug)
    await mkdir(skillsDirectory, { recursive: true })
    await mkdir(inactiveSkillsDirectory, { recursive: true })

    const targetDirectory = join(skillsDirectory, manifest.identifier)
    const inactiveTargetDirectory = join(inactiveSkillsDirectory, manifest.identifier)
    const existingDirectory = existsSync(targetDirectory)
      ? targetDirectory
      : existsSync(inactiveTargetDirectory)
        ? inactiveTargetDirectory
        : undefined
    if (existingDirectory) await assertSafeWorkspaceSkillDirectory(existingDirectory)
    if (initialState.action === 'update') {
      const existingSource = existingDirectory
        ? await readMarketplaceSource(existingDirectory)
        : undefined
      if (
        existingSource?.marketplaceSkillId !== marketplaceSkillId
        || existingSource.identifier !== manifest.identifier
      ) {
        throw new MarketplaceInstallerError(
          'UPDATE_SOURCE_MISMATCH',
          `同名 Skill 不属于当前市场 Skill，无法更新: ${manifest.identifier}`,
        )
      }
      if (compareMarketplaceSemVer(manifest.version, existingSource.installedVersion) <= 0) {
        throw new MarketplaceInstallerError(
          'UPDATE_VERSION_NOT_NEWER',
          `目标版本必须高于已安装版本: ${existingSource.installedVersion} → ${manifest.version}`,
        )
      }
    } else if (existingDirectory) {
      const existingMarketplaceSkillId = await readMarketplaceSkillId(existingDirectory)
      if (existingMarketplaceSkillId === marketplaceSkillId) {
        throw new MarketplaceInstallerError('ALREADY_INSTALLED', `当前工作区已安装该市场 Skill: ${manifest.identifier}`)
      }
      const conflict: MarketplaceInstallConflict = {
        kind: existingMarketplaceSkillId ? 'different_marketplace' : 'non_marketplace',
        identifier: manifest.identifier,
        location: existingDirectory === targetDirectory ? 'enabled' : 'disabled',
        replaceable: !existingMarketplaceSkillId,
        ...(existingMarketplaceSkillId ? { existingMarketplaceSkillId } : {}),
      }
      if (!confirmedConflict) {
        const message = existingMarketplaceSkillId
          ? `当前工作区的同名 Skill 属于其他市场条目: ${manifest.identifier}`
          : `当前工作区已存在同名非市场 Skill: ${manifest.identifier}`
        throw new MarketplaceInstallerError(
          'TARGET_CONFLICT',
          message,
          conflict,
        )
      }
      if (
        confirmedConflict.identifier !== conflict.identifier
        || confirmedConflict.location !== conflict.location
        || confirmedConflict.kind !== conflict.kind
      ) {
        throw new MarketplaceInstallerError('CONFLICT_STALE', '同名冲突目标已经变化，请重新安装并确认')
      }
    } else if (confirmedConflict) {
      throw new MarketplaceInstallerError('CONFLICT_STALE', '同名冲突目标已经变化，请重新安装并确认')
    }
    const replacementDirectory = initialState.action === 'update'
      ? existingDirectory
      : confirmedConflict
        ? confirmedConflict.location === 'enabled' ? targetDirectory : inactiveTargetDirectory
        : undefined
    const workingDirectory = replacementDirectory ? dirname(replacementDirectory) : skillsDirectory
    const stagingDirectory = join(workingDirectory, `.${manifest.identifier}.${installId}.staging`)
    const archivePath = join(workingDirectory, `.${manifest.identifier}.${installId}.zip`)
    const finalDirectory = replacementDirectory ?? targetDirectory
    const backupDirectory = replacementDirectory
      ? join(replacementDirectory, '..', `.${manifest.identifier}.${installId}.backup`)
      : undefined
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), 60_000)
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal])

    try {
      this.setState(installId, { phase: 'downloading', identifier: manifest.identifier })
      let archive: Uint8Array
      try {
        archive = await downloadPackage(
          manifest.downloadUrl!,
          archivePath,
          this.fetchFn,
          this.archiveWriter,
          combinedSignal,
        )
      } catch (error) {
        if (timeoutController.signal.aborted && !signal.aborted) {
          throw new MarketplaceInstallerError('DOWNLOAD_TIMEOUT', '技能包下载超过 60 秒')
        }
        throw error
      }
      this.setState(installId, { phase: 'verifying', identifier: manifest.identifier })
      signal.throwIfAborted()
      if (archive.byteLength !== manifest.size) {
        throw new MarketplaceInstallerError('VERIFY_SIZE', '技能包大小与 manifest 不一致')
      }
      const actualHash = createHash('sha256').update(archive).digest('hex')
      const expectedHash = manifest.sha256.replace(/^sha256:/, '').toLocaleLowerCase('en-US')
      if (actualHash !== expectedHash) {
        throw new MarketplaceInstallerError('VERIFY_HASH', '技能包 SHA-256 校验失败')
      }
      const validation = await inspectMarketplaceArchive(
        archivePath,
        manifest.identifier,
        manifest.version,
        signal,
      ).catch((error: unknown) => {
        if (signal.aborted) throw error
        throw new MarketplaceInstallerError('VERIFY_ARCHIVE', errorMessage(error))
      })
      if (!validation.passed) {
        const firstFailure = validation.checks.find((check) => !check.passed)
        throw new MarketplaceInstallerError('VERIFY_ARCHIVE', firstFailure?.message ?? '技能包安全校验失败')
      }

      this.setState(installId, { phase: 'extracting', identifier: manifest.identifier })
      signal.throwIfAborted()
      try {
        await mkdir(stagingDirectory, { recursive: true })
        await extractMarketplaceArchive(archivePath, manifest.identifier, stagingDirectory, signal)
        signal.throwIfAborted()
        const source: MarketplaceSkillImportSource = {
          kind: 'marketplace',
          marketplaceSkillId,
          identifier: manifest.identifier,
          installedVersion: manifest.version,
          contentHash: actualHash,
          installedAt: this.now().toISOString(),
        }
        await writeFile(join(stagingDirectory, '.source.json'), JSON.stringify(source, null, 2), 'utf8')
      } catch (error) {
        if (signal.aborted) throw error
        throw new MarketplaceInstallerError('EXTRACT_FAILED', `技能包解压失败：${errorMessage(error)}`)
      }
      await this.removeWithRetry(archivePath, { force: true })
      this.setState(installId, { phase: 'committing', identifier: manifest.identifier })
      try {
        if (replacementDirectory && backupDirectory) {
          await this.replaceWithRollback(stagingDirectory, replacementDirectory, backupDirectory)
        } else {
          await this.renameWithRetry(stagingDirectory, finalDirectory)
        }
      } catch (error) {
        throw new MarketplaceInstallerError('COMMIT_FAILED', `提交 Skill 到工作区失败：${errorMessage(error)}`)
      }
      return this.setState(installId, { phase: 'completed', identifier: manifest.identifier })
    } finally {
      clearTimeout(timeoutId)
      await this.removeWithRetry(stagingDirectory, { recursive: true, force: true })
      await this.removeWithRetry(archivePath, { force: true })
      if (backupDirectory && existsSync(backupDirectory) && !existsSync(replacementDirectory!)) {
        await this.renameWithRetry(backupDirectory, replacementDirectory!)
      }
    }
  }

  private assertManifest(manifest: MarketplaceInstallManifest, marketplaceSkillId: string, version: string): void {
    if (manifest.marketplaceSkillId !== marketplaceSkillId || manifest.version !== version) {
      throw new Error('安装 manifest 与请求不一致')
    }
    if (!isMarketplaceIdentifier(manifest.identifier) || !manifest.downloadUrl) {
      throw new Error('安装 manifest 无效')
    }
    const hash = manifest.sha256.replace(/^sha256:/, '')
    if (!/^[a-fA-F0-9]{64}$/.test(hash) || manifest.size > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
      throw new Error('安装 manifest 无效')
    }
  }
}
