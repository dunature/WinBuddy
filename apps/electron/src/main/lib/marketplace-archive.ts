import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { openPromise, type Entry } from 'yauzl'
import {
  MARKETPLACE_MAX_TEXT_PREVIEW_BYTES,
  MARKETPLACE_ZIP_LIMITS,
  validateMarketplacePackage,
  type MarketplacePackageValidationResult,
  type MarketplaceZipEntryDescriptor,
  type MarketplaceZipEntryKind,
} from '@proma/marketplace-domain'

const UNIX_HOST_SYSTEM = 3
const UNIX_FILE_TYPE_MASK = 0o170000
const UNIX_REGULAR_FILE = 0o100000
const UNIX_DIRECTORY = 0o040000
const UNIX_SYMLINK = 0o120000
const PKWARE_UNIX_EXTRA_FIELD = 0x000d
const ASI_UNIX_EXTRA_FIELD = 0x756e

function unixMode(entry: Entry): number | null {
  const hostSystem = entry.versionMadeBy >>> 8
  if (hostSystem === UNIX_HOST_SYSTEM) return (entry.externalFileAttributes >>> 16) & 0xffff
  const asiField = entry.extraFields.find((field) => field.id === ASI_UNIX_EXTRA_FIELD)
  return asiField && asiField.data.byteLength >= 6 ? asiField.data.readUInt16LE(4) : null
}

function entryKind(entry: Entry): MarketplaceZipEntryKind {
  const mode = unixMode(entry)
  const fileType = mode === null ? 0 : mode & UNIX_FILE_TYPE_MASK
  if (fileType === UNIX_SYMLINK) return 'symlink'
  if (entry.extraFields.some((field) => field.id === PKWARE_UNIX_EXTRA_FIELD && field.data.byteLength > 12)) {
    return 'hardlink'
  }
  if (fileType && fileType !== UNIX_REGULAR_FILE && fileType !== UNIX_DIRECTORY) return 'special'
  if (entry.isEncrypted()) return 'special'
  return entry.fileName.endsWith('/') || fileType === UNIX_DIRECTORY ? 'directory' : 'file'
}

async function readEntry(entry: Entry, zipFile: Awaited<ReturnType<typeof openPromise>>): Promise<Buffer> {
  const stream = await zipFile.openReadStreamPromise(entry)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MARKETPLACE_ZIP_LIMITS.singleFileBytes) throw new Error('解压文件超过单文件限制')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function inspectMarketplaceArchive(
  archivePath: string,
  identifier: string,
  version: string,
): Promise<MarketplacePackageValidationResult> {
  const entries: MarketplaceZipEntryDescriptor[] = []
  let skillMdContent: string | undefined
  const archiveSize = (await stat(archivePath)).size
  const zipFile = await openPromise(archivePath, {
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  try {
    for await (const entry of zipFile.eachEntry()) {
      const kind = entryKind(entry)
      entries.push({
        path: entry.fileName,
        kind,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
      })
      if (kind !== 'file' || entry.fileName.replaceAll('\\', '/') !== `${identifier}/SKILL.md`) continue
      if (entry.uncompressedSize > MARKETPLACE_MAX_TEXT_PREVIEW_BYTES) continue
      skillMdContent = new TextDecoder('utf-8', { fatal: true }).decode(await readEntry(entry, zipFile))
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid relative path')) {
      throw new Error('ZIP 包含非法父目录路径')
    }
    throw new Error('ZIP 文件损坏、加密或使用不支持的压缩格式')
  } finally {
    zipFile.close()
  }
  return validateMarketplacePackage({
    archiveSize,
    entries,
    ...(skillMdContent ? { skillMdContent } : {}),
    expectedIdentifier: identifier,
    expectedVersion: version,
  })
}

export async function extractMarketplaceArchive(
  archivePath: string,
  identifier: string,
  targetDirectory: string,
): Promise<void> {
  const prefix = `${identifier}/`
  const zipFile = await openPromise(archivePath, {
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entryKind(entry) !== 'file') continue
      const normalized = entry.fileName.replaceAll('\\', '/')
      if (!normalized.startsWith(prefix)) throw new Error('ZIP 根目录与 Skill identifier 不一致')
      const relativePath = normalized.slice(prefix.length)
      if (!relativePath) continue
      const destination = join(targetDirectory, ...relativePath.split('/'))
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, await readEntry(entry, zipFile))
    }
  } finally {
    zipFile.close()
  }
}
