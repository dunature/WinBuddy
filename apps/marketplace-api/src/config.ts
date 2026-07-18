import { fileURLToPath } from 'node:url'

export interface MarketplaceConfig {
  databaseUrl: string
  host: string
  port: number
  webRoot: string
  adminUsername: string
  adminInitialPassword: string
  allowedOrigin: string
}

const defaultWebRoot = fileURLToPath(new URL('../../marketplace-web/dist', import.meta.url))

export function loadMarketplaceDatabaseUrl(
  env: Record<string, string | undefined> = Bun.env,
): string {
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

  return databaseUrl
}

export function loadMarketplaceConfig(env: Record<string, string | undefined> = Bun.env): MarketplaceConfig {
  const databaseUrl = loadMarketplaceDatabaseUrl(env)

  const port = Number(env.MARKETPLACE_PORT ?? '4318')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MARKETPLACE_PORT 必须是 1 到 65535 之间的整数')
  }

  const adminUsername = env.MARKETPLACE_ADMIN_USERNAME?.trim()
  if (!adminUsername) throw new Error('缺少 MARKETPLACE_ADMIN_USERNAME')
  const adminInitialPassword = env.MARKETPLACE_ADMIN_INITIAL_PASSWORD ?? ''
  if (!adminInitialPassword) throw new Error('缺少 MARKETPLACE_ADMIN_INITIAL_PASSWORD')
  if (adminInitialPassword.length < 12) {
    throw new Error('MARKETPLACE_ADMIN_INITIAL_PASSWORD 至少需要 12 个字符')
  }

  const originValue = env.MARKETPLACE_ALLOWED_ORIGIN?.trim() || 'https://www.feiyangclaw.com'
  let originUrl: URL
  try {
    originUrl = new URL(originValue)
  } catch {
    throw new Error('MARKETPLACE_ALLOWED_ORIGIN 必须是 HTTP(S) Origin')
  }
  if ((originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:')
    || originUrl.username || originUrl.password || originUrl.pathname !== '/'
    || originUrl.search || originUrl.hash) {
    throw new Error('MARKETPLACE_ALLOWED_ORIGIN 必须是 HTTP(S) Origin')
  }

  return {
    databaseUrl,
    host: env.MARKETPLACE_HOST?.trim() || '127.0.0.1',
    port,
    webRoot: env.MARKETPLACE_WEB_DIR?.trim() || defaultWebRoot,
    adminUsername,
    adminInitialPassword,
    allowedOrigin: originUrl.origin,
  }
}
