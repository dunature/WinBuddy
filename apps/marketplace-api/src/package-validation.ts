import { stat } from 'node:fs/promises'
import { openPromise, type Entry } from 'yauzl'
import {
  MARKETPLACE_MAX_TEXT_PREVIEW_BYTES,
  MARKETPLACE_ZIP_LIMITS,
  validateMarketplacePackage,
  type MarketplacePackageValidationResult,
  type MarketplaceZipEntryDescriptor,
  type MarketplaceZipEntryKind,
} from '@proma/marketplace-domain'

const unixHostSystem = 3
const unixFileTypeMask = 0o170000
const unixRegularFile = 0o100000
const unixDirectory = 0o040000
const unixSymlink = 0o120000
const pkwareUnixExtraField = 0x000d
const asiUnixExtraField = 0x756e

function unixMode(entry: Entry): number | null {
  const hostSystem = entry.versionMadeBy >>> 8
  if (hostSystem === unixHostSystem) return (entry.externalFileAttributes >>> 16) & 0xffff
  const asiField = entry.extraFields.find((field) => field.id === asiUnixExtraField)
  return asiField && asiField.data.byteLength >= 6 ? asiField.data.readUInt16LE(4) : null
}

function hasPkwareLinkTarget(entry: Entry): boolean {
  return entry.extraFields.some((field) => field.id === pkwareUnixExtraField && field.data.byteLength > 12)
}

function marketplaceEntryKind(entry: Entry): MarketplaceZipEntryKind {
  const mode = unixMode(entry)
  const fileType = mode === null ? 0 : mode & unixFileTypeMask
  if (fileType === unixSymlink) return 'symlink'
  if (hasPkwareLinkTarget(entry)) return 'hardlink'
  if (fileType && fileType !== unixRegularFile && fileType !== unixDirectory) return 'special'
  if (entry.isEncrypted()) return 'special'
  return entry.fileName.endsWith('/') || fileType === unixDirectory ? 'directory' : 'file'
}

function shouldReadEntry(entry: MarketplaceZipEntryDescriptor, expandedSize: number, fileCount: number): boolean {
  if (entry.kind !== 'file' || fileCount > MARKETPLACE_ZIP_LIMITS.fileCount) return false
  if (entry.uncompressedSize > MARKETPLACE_ZIP_LIMITS.singleFileBytes) return false
  if (expandedSize > MARKETPLACE_ZIP_LIMITS.expandedBytes) return false
  if (entry.uncompressedSize > 0
    && (entry.compressedSize === 0
      || entry.uncompressedSize / entry.compressedSize > MARKETPLACE_ZIP_LIMITS.compressionRatio)) return false
  return true
}

function invalidArchiveResult(
  entries: MarketplaceZipEntryDescriptor[],
  archiveSize: number,
  expectedIdentifier: string,
  expectedVersion: string,
  skillMdContent?: string,
): MarketplacePackageValidationResult {
  const result = validateMarketplacePackage({
    archiveSize,
    entries,
    ...(skillMdContent ? { skillMdContent } : {}),
    expectedIdentifier,
    expectedVersion,
  })
  return {
    ...result,
    passed: false,
    checks: [...result.checks.filter((check) => check.rule !== 'entry_type'), {
      rule: 'entry_type',
      passed: false,
      code: 'ZIP_INVALID_ARCHIVE',
      message: 'ZIP 文件损坏、加密或使用不支持的压缩格式',
    }],
  }
}

export async function inspectMarketplaceZipPackage(
  archivePath: string,
  expectedIdentifier: string,
  expectedVersion: string,
): Promise<MarketplacePackageValidationResult> {
  const archiveSize = (await stat(archivePath)).size
  const entries: MarketplaceZipEntryDescriptor[] = []
  let expandedSize = 0
  let fileCount = 0
  let skillMdContent: string | undefined
  let zipFile: Awaited<ReturnType<typeof openPromise>> | undefined

  try {
    zipFile = await openPromise(archivePath, {
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
    })
    for await (const entry of zipFile.eachEntry()) {
      const descriptor: MarketplaceZipEntryDescriptor = {
        path: entry.fileName,
        kind: marketplaceEntryKind(entry),
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
      }
      entries.push(descriptor)
      if (descriptor.kind !== 'directory') {
        fileCount += 1
        expandedSize += descriptor.uncompressedSize
      }
      if (!shouldReadEntry(descriptor, expandedSize, fileCount)) continue

      const stream = await zipFile.openReadStreamPromise(entry)
      let actualSize = 0
      const captureSkillMd = entry.fileName.replaceAll('\\', '/') === `${expectedIdentifier}/SKILL.md`
      const contentChunks: Buffer[] = []
      let capturedBytes = 0
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        actualSize += buffer.byteLength
        if (actualSize > MARKETPLACE_ZIP_LIMITS.singleFileBytes) throw new Error('entry size limit exceeded')
        if (captureSkillMd && capturedBytes < MARKETPLACE_MAX_TEXT_PREVIEW_BYTES) {
          const remaining = MARKETPLACE_MAX_TEXT_PREVIEW_BYTES - capturedBytes
          const captured = buffer.subarray(0, remaining)
          contentChunks.push(captured)
          capturedBytes += captured.byteLength
        }
      }
      if (captureSkillMd) {
        skillMdContent = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(contentChunks))
      }
    }
  } catch {
    return invalidArchiveResult(
      entries,
      archiveSize,
      expectedIdentifier,
      expectedVersion,
      skillMdContent,
    )
  } finally {
    zipFile?.close()
  }

  return validateMarketplacePackage({
    archiveSize,
    entries,
    ...(skillMdContent ? { skillMdContent } : {}),
    expectedIdentifier,
    expectedVersion,
  })
}
