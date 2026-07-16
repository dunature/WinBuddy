export interface MarketplaceLogFields {
  requestId?: string
  errorCode?: string
  skillId?: string
  version?: string
  platform?: string
  result?: string
}

const ALLOWED_FIELDS = ['requestId', 'errorCode', 'skillId', 'version', 'platform', 'result'] as const

/** Marketplace 日志只保留不可逆、无正文的诊断标识。 */
export function sanitizeMarketplaceLogFields(input: Record<string, unknown>): MarketplaceLogFields {
  const output: MarketplaceLogFields = {}
  for (const field of ALLOWED_FIELDS) {
    const value = input[field]
    if (typeof value === 'string' && value.length <= 128) output[field] = value
  }
  return output
}

export function formatMarketplaceLog(message: string, fields: Record<string, unknown> = {}): string {
  return `[Marketplace] ${message} ${JSON.stringify(sanitizeMarketplaceLogFields(fields))}`
}
