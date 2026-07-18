import { deflateRawSync } from 'node:zlib'

export interface ZipFixtureEntry {
  path: string
  content?: string | Uint8Array
  compression?: 'store' | 'deflate'
  versionMadeBy?: number
  externalFileAttributes?: number
  extraFields?: Array<{ id: number; data: Uint8Array }>
}

function uint16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function uint32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

function crc32(content: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function extraFieldBytes(fields: ZipFixtureEntry['extraFields'] = []): Buffer {
  return Buffer.concat(fields.map((field) => Buffer.concat([
    uint16(field.id),
    uint16(field.data.byteLength),
    Buffer.from(field.data),
  ])))
}

export function createZipFixture(entries: ZipFixtureEntry[]): Uint8Array {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const path = Buffer.from(entry.path, 'utf8')
    const content = typeof entry.content === 'string'
      ? Buffer.from(entry.content, 'utf8')
      : Buffer.from(entry.content ?? new Uint8Array())
    const compressionMethod = entry.compression === 'deflate' ? 8 : 0
    const compressed = compressionMethod === 8 ? deflateRawSync(content) : content
    const checksum = crc32(content)
    const extra = extraFieldBytes(entry.extraFields)
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(compressionMethod),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(compressed.byteLength),
      uint32(content.byteLength),
      uint16(path.byteLength),
      uint16(extra.byteLength),
      path,
      extra,
    ])
    localParts.push(localHeader, compressed)

    centralParts.push(Buffer.concat([
      uint32(0x02014b50),
      uint16(entry.versionMadeBy ?? 0x033f),
      uint16(20),
      uint16(0x0800),
      uint16(compressionMethod),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(compressed.byteLength),
      uint32(content.byteLength),
      uint16(path.byteLength),
      uint16(extra.byteLength),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(entry.externalFileAttributes ?? (0o100644 << 16)),
      uint32(localOffset),
      path,
      extra,
    ]))
    localOffset += localHeader.byteLength + compressed.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralDirectory.byteLength),
    uint32(localOffset),
    uint16(0),
  ])
  return Buffer.concat([...localParts, centralDirectory, end])
}
