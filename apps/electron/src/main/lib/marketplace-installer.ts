import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MARKETPLACE_ZIP_LIMITS, isMarketplaceIdentifier, isMarketplaceSemVer } from '@proma/marketplace-domain'
import type {
  MarketplaceInstallAction,
  MarketplaceInstallManifest,
  MarketplaceInstallRequest,
  MarketplaceInstallState,
  MarketplaceInstallStatus,
  MarketplaceSkillImportSource,
} from '@proma/shared'
import type { MarketplaceCatalogClient } from './marketplace-catalog-client'
import { extractMarketplaceArchive, inspectMarketplaceArchive } from './marketplace-archive'

interface WorkspaceDirectories {
  skillsDirectory: string
  inactiveSkillsDirectory: string
}

type MarketplaceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface MarketplaceInstallerOptions {
  catalogClient: Pick<MarketplaceCatalogClient, 'getInstallManifest'>
  resolveWorkspaceDirectories(workspaceSlug: string): WorkspaceDirectories
  fetchFn?: MarketplaceFetch
  onProgress?: (state: MarketplaceInstallState) => void
  createInstallId?: () => string
  now?: () => Date
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '技能安装失败'
}

async function downloadPackage(
  initialUrl: string,
  targetPath: string,
  fetchFn: MarketplaceFetch,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchFn(url, { redirect: 'manual', signal })
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('技能包重定向缺少目标地址')
      if (redirects === 3) throw new Error('技能包下载重定向超过 3 次')
      url = new URL(location, url).toString()
      continue
    }
    if (!response.ok || !response.body) throw new Error(`技能包下载失败（HTTP ${response.status}）`)
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MARKETPLACE_ZIP_LIMITS.archiveBytes) {
      throw new Error('技能包响应超过 20 MB')
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
        throw new Error('技能包响应超过 20 MB')
      }
      chunks.push(result.value)
    }
    const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    await writeFile(targetPath, content)
    return content
  }
  throw new Error('技能包下载失败')
}

export class MarketplaceInstaller {
  private readonly installs = new Map<string, MarketplaceInstallState>()
  private readonly completions = new Map<string, Promise<MarketplaceInstallState>>()
  private readonly activeTargets = new Map<string, string>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly fetchFn: MarketplaceFetch
  private readonly createInstallId: () => string
  private readonly now: () => Date

  constructor(private readonly options: MarketplaceInstallerOptions) {
    this.fetchFn = options.fetchFn ?? fetch
    this.createInstallId = options.createInstallId ?? randomUUID
    this.now = options.now ?? (() => new Date())
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
    return { installId, phase: state.phase, ...(state.error ? { error: state.error } : {}) }
  }

  install(request: MarketplaceInstallRequest): MarketplaceInstallState {
    return this.start('install', request)
  }

  update(_request: MarketplaceInstallRequest): MarketplaceInstallState {
    throw new Error('技能市场更新将在后续版本开放')
  }

  cancel(installId: string): boolean {
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

  private start(action: MarketplaceInstallAction, request: MarketplaceInstallRequest): MarketplaceInstallState {
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
      .then(() => this.run(state, controller.signal))
      .catch((error: unknown) => this.setState(installId, {
        phase: controller.signal.aborted ? 'cancelled' : 'failed',
        error: controller.signal.aborted ? '安装已取消' : errorMessage(error),
      }))
      .finally(() => {
        this.activeTargets.delete(targetKey)
        this.controllers.delete(installId)
      })
    this.completions.set(installId, completion)
    return state
  }

  private setState(
    installId: string,
    changes: Pick<MarketplaceInstallState, 'phase'> & Partial<Pick<MarketplaceInstallState, 'identifier' | 'error'>>,
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

  private async run(initialState: MarketplaceInstallState, signal: AbortSignal): Promise<MarketplaceInstallState> {
    const { installId, marketplaceSkillId, version, workspaceSlug } = initialState
    const manifest = await this.options.catalogClient.getInstallManifest(marketplaceSkillId, version)
    this.assertManifest(manifest, marketplaceSkillId, version)
    const { skillsDirectory, inactiveSkillsDirectory } = this.options.resolveWorkspaceDirectories(workspaceSlug)
    await mkdir(skillsDirectory, { recursive: true })
    await mkdir(inactiveSkillsDirectory, { recursive: true })

    const targetDirectory = join(skillsDirectory, manifest.identifier)
    const inactiveTargetDirectory = join(inactiveSkillsDirectory, manifest.identifier)
    if (existsSync(targetDirectory) || existsSync(inactiveTargetDirectory)) {
      throw new Error(`当前工作区已存在同名 Skill: ${manifest.identifier}`)
    }
    const stagingDirectory = join(skillsDirectory, `.${manifest.identifier}.${installId}.staging`)
    const archivePath = join(skillsDirectory, `.${manifest.identifier}.${installId}.zip`)
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), 60_000)
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal])

    try {
      this.setState(installId, { phase: 'downloading', identifier: manifest.identifier })
      const archive = await downloadPackage(manifest.downloadUrl!, archivePath, this.fetchFn, combinedSignal)
      this.setState(installId, { phase: 'verifying', identifier: manifest.identifier })
      if (archive.byteLength !== manifest.size) throw new Error('技能包大小与 manifest 不一致')
      const actualHash = createHash('sha256').update(archive).digest('hex')
      const expectedHash = manifest.sha256.replace(/^sha256:/, '').toLocaleLowerCase('en-US')
      if (actualHash !== expectedHash) throw new Error('技能包 SHA-256 校验失败')
      const validation = await inspectMarketplaceArchive(archivePath, manifest.identifier, manifest.version)
      if (!validation.passed) {
        const firstFailure = validation.checks.find((check) => !check.passed)
        throw new Error(firstFailure?.message ?? '技能包安全校验失败')
      }

      this.setState(installId, { phase: 'extracting', identifier: manifest.identifier })
      await mkdir(stagingDirectory, { recursive: true })
      await extractMarketplaceArchive(archivePath, manifest.identifier, stagingDirectory)
      const source: MarketplaceSkillImportSource = {
        kind: 'marketplace',
        marketplaceSkillId,
        identifier: manifest.identifier,
        installedVersion: manifest.version,
        contentHash: actualHash,
        installedAt: this.now().toISOString(),
      }
      await writeFile(join(stagingDirectory, '.source.json'), JSON.stringify(source, null, 2), 'utf8')
      await rm(archivePath, { force: true })
      this.setState(installId, { phase: 'committing', identifier: manifest.identifier })
      await rename(stagingDirectory, targetDirectory)
      return this.setState(installId, { phase: 'completed', identifier: manifest.identifier })
    } finally {
      clearTimeout(timeoutId)
      await rm(stagingDirectory, { recursive: true, force: true })
      await rm(archivePath, { force: true })
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
