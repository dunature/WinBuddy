import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { parseSkillManifest, validateMarketplacePackageEntries, type MarketplacePackageEntry } from '@proma/marketplace-domain'
import type { MarketplaceCreateInstallInput, MarketplaceCreateInstallResult, MarketplaceInstallError, MarketplaceInstallState, MarketplacePackageDownload } from '@proma/shared'
import { getMarketplaceInstallsTempDir } from './config-paths'
import { listAgentWorkspaces } from './agent-workspace-manager'
import { getSettings } from './settings-service'

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
  expectedSha256?: string
  controller: AbortController
  active: boolean
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
  }
  sessions.set(installId, session)
  return { installId, skillId: input.skillId, slug: input.slug, version: input.version, workspaceSlug: input.workspaceSlug }
}

export async function startMarketplaceInstall(installId: string, onProgress: ProgressCallback): Promise<void> {
  const session = requireSession(installId)
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
    session.active = false
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
  const response = await fetchWithRedirectLimit(metadata.downloadUrl, session.controller.signal)
  if (!response.ok || !response.body) throw installerError('PACKAGE_DOWNLOAD_FAILED', `安装包下载失败（HTTP ${response.status}）`)
  const total = Number(response.headers.get('content-length') || metadata.size || 0)
  if (total > MAX_PACKAGE_BYTES) throw installerError('PACKAGE_TOO_LARGE', '安装包超过 25 MB 限制')
  const reader = response.body.getReader()
  const output = createWriteStream(session.packagePath, { flags: 'wx', mode: 0o600 })
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > MAX_PACKAGE_BYTES) throw installerError('PACKAGE_TOO_LARGE', '安装包超过 25 MB 限制')
      if (!output.write(chunk.value)) await new Promise<void>((resolve) => output.once('drain', resolve))
      onProgress({ status: 'downloading', installId: session.installId, received, total: total || undefined })
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()))
  } catch (error) {
    output.destroy()
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function fetchWithRedirectLimit(url: string, signal: AbortSignal): Promise<Response> {
  let currentUrl = url
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
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

function cleanupSession(session: MarketplaceInstallerSession): void {
  if (existsSync(session.tempDir)) rmSync(session.tempDir, { recursive: true, force: true })
  sessions.delete(session.installId)
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
