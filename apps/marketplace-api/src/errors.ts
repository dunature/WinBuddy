import type { MarketplaceErrorCode } from '@proma/shared'

export class MarketplaceApiException extends Error {
  constructor(
    readonly code: MarketplaceErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'MarketplaceApiException'
  }
}
