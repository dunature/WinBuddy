export interface MarketplaceConfig {
  databaseUrl: string
  host: string
  port: number
}

export function loadMarketplaceConfig(env: Record<string, string | undefined> = Bun.env): MarketplaceConfig {
  const databaseUrl = env.MARKETPLACE_DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('缺少 MARKETPLACE_DATABASE_URL')

  let parsedDatabaseUrl: URL
  try {
    parsedDatabaseUrl = new URL(databaseUrl)
  } catch {
    throw new Error('MARKETPLACE_DATABASE_URL 不是有效 URL')
  }
  if (parsedDatabaseUrl.protocol !== 'postgres:' && parsedDatabaseUrl.protocol !== 'postgresql:') {
    throw new Error('MARKETPLACE_DATABASE_URL 必须使用 PostgreSQL 协议')
  }

  const port = Number(env.MARKETPLACE_PORT ?? '4318')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MARKETPLACE_PORT 必须是 1 到 65535 之间的整数')
  }

  return {
    databaseUrl,
    host: env.MARKETPLACE_HOST?.trim() || '127.0.0.1',
    port,
  }
}
