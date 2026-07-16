export function safeMarketplaceLink(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('./') || value.startsWith('../')) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function safeMarketplaceAssetUrl(value: string | undefined): string | undefined {
  const url = safeMarketplaceLink(value)
  return url?.startsWith('https://') || url?.startsWith('http://') || url?.startsWith('/') ? url : undefined
}
