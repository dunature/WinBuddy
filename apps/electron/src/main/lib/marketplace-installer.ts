import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { parseSkillManifest, validateMarketplacePackageEntries, type MarketplacePackageEntry } from '@proma/marketplace-domain'
import type { MarketplaceCreateInstallInput, MarketplaceCreateInstallResult, MarketplaceInstallError, MarketplaceInstallEventInput, MarketplaceInstallState, MarketplacePackageDownload, MarketplacePermissionSet, MarketplaceResolveConflictInput, MarketplaceSkillSource } from '@proma/shared'
import { getAgentWorkspacePath, getMarketplaceInstallsTempDir, getWorkspaceSkillsDir } from './config-paths'
import { listAgentWorkspaces } from './agent-workspace-manager'
import { getSettings } from './settings-service'
import { rmSyncWithRetry, renameWithRetry } from './fs-retry'
import { collectMarketplaceFileHashes, detectMarketplaceInstallConflict } from './marketplace-source'

const DEFAULT_API_URL = 'https://marketplace.proma.ai/api/v1'
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 3
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024

export interface MarketplaceInstallerSession {
  installId: string
  skillId: string
  slug: string
  version: string
  workspaceSlug: string
  tempDir: string
  packagePath: string
  stagingDir: string
  expectedSha256: string
  controller: AbortController
  active: boolean
  permissions?: MarketplacePermissionSet
  appVersion: string
}

type ProgressCallback = (state: MarketplaceInstallState) => void
const sessions = new Map<string, MarketplaceInstallerSession>()

export function createMarketplaceInstall(input: MarketplaceCreateInstallInput): MarketplaceCreateInstallResult {
  assertSafeIdentifier(input.slug, 'Skill slug')
  assertSafeIdentifier(input.workspaceSlug, '工作区 slug')
  if (!listAgentWorkspaces().some((workspace) => workspace.slug === input.workspaceSlug)) throw installerError('WORKSPACE_NOT_FOUND', '目标工作区不存在')
  const installId = randomUUID()
  const tempDir = join(getMarketplaceInstallsTempDir(), installId)
  mkdirSync(tempDir, { recursive: true })
  const session: MarketplaceInstallerSession = {
    installId,
    skillId: input.skillId,
    slug: input.slug,
    version: input.version,
    workspaceSlug: input.workspaceSlug,
    tempDir,
    packagePath: join(tempDir, 'package.zip'),
    stagingDir: join(tempDir, 'staging'),
    controller: new AbortController(),
    active: false,
    expectedSha256: '',
    appVersion: '0.0.0',
  }
  sessions.set(installId, session)
  return { installId, skillId: input.skillId, slug: input.slug, version: input.version, workspaceSlug: input.workspaceSlug }
}

export async function startMarketplaceInstall(installId: string, onProgress: ProgressCallback, appVersion = '0.0.0'): Promise<void> {
  const session = requireSession(installId)
  session.appVersion = appVersion
  session.active = true
  try {
    const metadata = await fetchPackageMetadata(session)
    session.expectedSha256 = metadata.sha256.toLowerCase()
    await downloadPackage(session, metadata, onProgress)
    onProgress({ status: 'verifying', installId, step: 'hash' })
    if (await sha256File(session.packagePath) !== session.expectedSha256) throw installerError('PACKAGE_HASH_MISMATCH', '安装包完整性校验失败')
    onProgress({ status: 'verifying', installId, step: 'package' })
    await preflightAndExtract(session)
    onProgress({ status: 'verifying', installId, step: 'manifest' })
    const manifest = parseSkillManifest(readFileSync(join(session.stagingDir, 'SKILL.md'), 'utf8'))
    if (!manifest.manifest || manifest.issues.some((issue) => issue.severity === 'error')) throw installerError('PACKAGE_INVALID', 'SKILL.md Manifest 校验失败')
    session.permissions = manifest.manifest.permissions
    session.active = false
    const targetDir = join(getWorkspaceSkillsDir(session.workspaceSlug), session.slug)
    const conflict = detectMarketplaceInstallConflict({ slug: session.slug, marketplaceSkillId: session.skillId, marketplaceVersion: session.version, marketplaceSha256: session.expectedSha256, targetDir })
    if (conflict === 'already-installed') {
      onProgress(successState(session))
      cleanupSession(session)
    } else if (conflict) {
      onProgress({ status: 'conflict', installId, conflict })
    } else {
      commitMarketplaceInstall(session, onProgress)
    }
  } catch (error) {
    if (session.controller.signal.aborted) {
      cleanupSession(session)
      onProgress({ status: 'cancelled', installId })
      return
    }
    cleanupSession(session)
    onProgress({ status: 'error', installId, error: toInstallError(error) })
    throw error
  }
}

export function cancelMarketplaceInstall(installId: string): boolean {
  const session = sessions.get(installId)
  if (!session) return false
  session.controller.abort()
  if (!session.active) cleanupSession(session)
  return true
}

export function resolveMarketplaceInstallConflict(input: MarketplaceResolveConflictInput, onProgress: ProgressCallback): boolean {
  const session = sessions.get(input.installId)
  if (!session || session.active) return false
  if (input.resolution === 'cancel') {
    cleanupSession(session)
    onProgress({ status: 'cancelled', installId: input.installId })
    return true
  }
  try {
    commitMarketplaceInstall(session, onProgress)
    return true
  } catch (error) {
    cleanupSession(session)
    onProgress({ status: 'error', installId: session.installId, error: toInstallError(error) })
    return false
  }
}

export function getMarketplaceInstallerSession(installId: string): MarketplaceInstallerSession | undefined {
  return sessions.get(installId)
}

async function fetchPackageMetadata(session: MarketplaceInstallerSession): Promise<MarketplacePackageDownload> {
  const baseUrl = (getSettings().marketplaceApiUrl || DEFAULT_API_URL).replace(/\/$/, '')
  const response = await fetchWithRedirectLimit(`${baseUrl}/skills/${encodeURIComponent(session.slug)}/versions/${encodeURIComponent(session.version)}/package`, session.controller.signal)
  if (!response.ok) throw installerError('PACKAGE_DOWNLOAD_FAILED', `无法获取安装包信息（HTTP ${response.status}）`)
  const metadata = await response.json() as MarketplacePackageDownload
  if (metadata.skillId !== session.skillId || metadata.slug !== session.slug || metadata.version !== session.version) throw installerError('PACKAGE_INVALID', '安装包信息与所选 Skill 不一致')
  if (metadata.size > MAX_PACKAGE_BYTES) throw installerError('PACKAGE_TOO_LARGE', '安装包超过 25 MB 限制')
  return metadata
}

async function downloadPackage(session: MarketplaceInstallerSession, metadata: MarketplacePackageDownload, onProgress: ProgressCallback): Promise<void> {
  const downloadSignal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
  const response = await fetchWithRedirectLimit(metadata.downloadUrl, downloadSignal)
  if (!response.ok || !response.body) throw installerError('PACKAGE_DOWNLOAD_FAILED', `安装包下载失败（HTTP ${response.status}）`)
  const total = Number(response.headers.get('content-length') || metadata.size || 0)
  if (total > MAX_PACKAGE_BYTES) throw installerError('PACKAGE_TOO_LARGE', '安装包超过 25 MB 限制')
  const reader = response.body.getReader()
  let received = 0
  try {
    const chunks = Readable.from((async function* (): AsyncGenerator<Uint8Array> {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return
        received += chunk.value.byteLength
        if (received > MAX_PACKAGE_BYTES) throw installerError('PACKAGE_TOO_LARGE', '安装包超过 25 MB 限制')
        onProgress({ status: 'downloading', installId: session.installId, received, total: total || undefined })
        yield chunk.value
      }
    })())
    await pipeline(chunks, createWriteStream(session.packagePath, { flags: 'wx', mode: 0o600 }), { signal: downloadSignal })
  } finally {
    reader.releaseLock()
  }
}

async function fetchWithRedirectLimit(url: string, signal: AbortSignal): Promise<Response> {
  let currentUrl = url
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const protocol = new URL(currentUrl).protocol
    if (protocol !== 'https:' && protocol !== 'http:') throw installerError('PACKAGE_DOWNLOAD_FAILED', '安装包地址协议不安全')
    const response = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location || redirects === MAX_REDIRECTS) throw installerError('PACKAGE_DOWNLOAD_FAILED', '安装包重定向次数超过限制')
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw installerError('PACKAGE_DOWNLOAD_FAILED', '安装包重定向失败')
}

async function preflightAndExtract(session: MarketplaceInstallerSession): Promise<void> {
  const entries = await readZipEntries(await openZip(session.packagePath))
  const validation = validateMarketplacePackageEntries(entries.map(toPackageEntry))
  if (validation.issues.length > 0) {
    const first = validation.issues[0]
    throw installerError('PACKAGE_UNSAFE', `${first?.message ?? '安装包不安全'}${first?.path ? `：${first.path}` : ''}`)
  }
  if (!validation.normalizedEntries.some((entry) => entry.normalizedPath === 'SKILL.md')) throw installerError('PACKAGE_INVALID', '安装包根目录缺少 SKILL.md')
  mkdirSync(session.stagingDir, { recursive: true })
  await extractEntries(await openZip(session.packagePath), session.stagingDir)
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => error || !zipFile ? reject(error ?? new Error('无法打开 ZIP')) : resolve(zipFile)))
}

function readZipEntries(zipFile: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = []
    zipFile.on('entry', (entry: Entry) => { entries.push(entry); zipFile.readEntry() })
    zipFile.once('end', () => resolve(entries))
    zipFile.once('error', reject)
    zipFile.readEntry()
  })
}

function toPackageEntry(entry: Entry): MarketplacePackageEntry {
  return { path: entry.fileName, compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize, isDirectory: entry.fileName.endsWith('/'), isSymbolicLink: ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000 }
}

function extractEntries(zipFile: ZipFile, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zipFile.on('entry', (entry: Entry) => {
      const outputPath = join(destination, entry.fileName.replace(/\\/g, '/'))
      if (entry.fileName.endsWith('/')) { mkdirSync(outputPath, { recursive: true }); zipFile.readEntry(); return }
      mkdirSync(dirname(outputPath), { recursive: true })
      zipFile.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(error ?? new Error('无法读取 ZIP 条目')); return }
        void pipeline(stream, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })).then(() => zipFile.readEntry()).catch(reject)
      })
    })
    zipFile.once('end', resolve)
    zipFile.once('error', reject)
    zipFile.readEntry()
  })
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('end', () => resolve(hash.digest('hex')))
    stream.once('error', reject)
  })
}

function requireSession(installId: string): MarketplaceInstallerSession {
  const session = sessions.get(installId)
  if (!session) throw installerError('INSTALL_COMMIT_FAILED', '安装任务不存在或已结束')
  return session
}

function commitMarketplaceInstall(session: MarketplaceInstallerSession, onProgress: ProgressCallback): void {
  const targetDir = join(getWorkspaceSkillsDir(session.workspaceSlug), session.slug)
  const backupRoot = join(getAgentWorkspacePath(session.workspaceSlug), 'skill-backups')
  const backupDir = join(backupRoot, `${session.slug}-${Date.now()}`)
  let backupCreated = false
  onProgress({ status: 'committing', installId: session.installId })
  try {
    const source: MarketplaceSkillSource = {
      schemaVersion: 1,
      sourceType: 'marketplace',
      marketplaceSkillId: session.skillId,
      slug: session.slug,
      version: session.version,
      sha256: session.expectedSha256,
      installedAt: new Date().toISOString(),
      files: collectMarketplaceFileHashes(session.stagingDir),
      permissions: session.permissions,
    }
    writeFileSync(join(session.stagingDir, '.proma-source.json'), JSON.stringify(source, null, 2), { encoding: 'utf8', mode: 0o600 })
    if (existsSync(targetDir)) {
      mkdirSync(backupRoot, { recursive: true })
      renameWithRetry(targetDir, backupDir)
      backupCreated = true
    }
    renameWithRetry(session.stagingDir, targetDir)
    onProgress(successState(session))
    void reportMarketplaceInstall(session, source.installedAt)
    cleanupSession(session)
  } catch (error) {
    if (backupCreated && !existsSync(targetDir) && existsSync(backupDir)) {
      try { renameWithRetry(backupDir, targetDir) } catch (rollbackError) { console.error('[社区市场] 安装回滚失败:', rollbackError) }
    }
    throw installerError('INSTALL_COMMIT_FAILED', error instanceof Error ? error.message : '写入 Skill 失败')
  }
}

function successState(session: MarketplaceInstallerSession): MarketplaceInstallState {
  return { status: 'success', installId: session.installId, slug: session.slug, version: session.version, workspaceSlug: session.workspaceSlug }
}

async function reportMarketplaceInstall(session: MarketplaceInstallerSession, installedAt: string): Promise<void> {
  try {
    const baseUrl = (getSettings().marketplaceApiUrl || DEFAULT_API_URL).replace(/\/$/, '')
    const event: MarketplaceInstallEventInput = {
      eventId: session.installId,
      skillId: session.skillId,
      version: session.version,
      installedAt,
      platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
      appVersion: session.appVersion,
    }
    const response = await fetch(`${baseUrl}/install-events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) console.warn(`[社区市场] 安装统计上报失败（HTTP ${response.status}）`)
  } catch (error) {
    console.warn('[社区市场] 安装统计上报失败，不影响本地安装:', error)
  }
}

function cleanupSession(session: MarketplaceInstallerSession): void {
  try {
    if (existsSync(session.tempDir)) rmSyncWithRetry(session.tempDir, { recursive: true, force: true })
  } catch (error) {
    console.warn(`[社区市场] 临时目录清理失败 (${session.installId}):`, error)
  } finally {
    sessions.delete(session.installId)
  }
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(value)) throw installerError('VALIDATION_FAILED', `${label} 格式无效`)
}

function installerError(code: MarketplaceInstallError['code'], message: string): Error & { code: MarketplaceInstallError['code'] } {
  return Object.assign(new Error(message), { code })
}

function toInstallError(error: unknown): MarketplaceInstallError {
  const candidate = error as { code?: MarketplaceInstallError['code']; message?: string }
  return { code: candidate.code ?? 'PACKAGE_DOWNLOAD_FAILED', message: candidate.message ?? '安装包处理失败', retryable: candidate.code === 'PACKAGE_DOWNLOAD_FAILED' || candidate.code === 'MARKETPLACE_OFFLINE' }
}
