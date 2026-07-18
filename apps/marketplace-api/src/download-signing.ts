import { createHmac, timingSafeEqual } from 'node:crypto'

const downloadUrlDurationSeconds = 5 * 60

function payload(identifier: string, version: string, expires: number): string {
  return `${identifier}\n${version}\n${expires}`
}

function signature(secret: string, identifier: string, version: string, expires: number): string {
  return createHmac('sha256', secret).update(payload(identifier, version, expires)).digest('hex')
}

export function createMarketplaceDownloadUrl(
  origin: string,
  secret: string,
  identifier: string,
  version: string,
  now: Date,
): string {
  const expires = Math.floor(now.getTime() / 1_000) + downloadUrlDurationSeconds
  const url = new URL(
    `/api/v1/marketplace/downloads/${encodeURIComponent(identifier)}/${encodeURIComponent(version)}`,
    origin,
  )
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('signature', signature(secret, identifier, version, expires))
  return url.toString()
}

export type MarketplaceDownloadValidationError =
  | 'DOWNLOAD_URL_EXPIRED'
  | 'DOWNLOAD_SIGNATURE_INVALID'

export function validateMarketplaceDownloadUrl(
  secret: string,
  identifier: string,
  version: string,
  expiresValue: string | undefined,
  signatureValue: string | undefined,
  now: Date,
): MarketplaceDownloadValidationError | null {
  const expires = Number(expiresValue)
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(now.getTime() / 1_000)) {
    return 'DOWNLOAD_URL_EXPIRED'
  }
  if (!signatureValue || !/^[a-f0-9]{64}$/.test(signatureValue)) return 'DOWNLOAD_SIGNATURE_INVALID'
  const expected = Buffer.from(signature(secret, identifier, version, expires), 'hex')
  const actual = Buffer.from(signatureValue, 'hex')
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
    ? null
    : 'DOWNLOAD_SIGNATURE_INVALID'
}
