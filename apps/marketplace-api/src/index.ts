import { createMarketplaceApp } from './app.ts'
import { loadMarketplaceApiConfig } from './config.ts'
import { S3MarketplaceObjectStore } from './object-store/s3-object-store.ts'
import { PostgresMarketplaceRepository } from './repository/postgres-marketplace-repository.ts'
import { AdminAuthService, HttpGitHubOAuthClient, PostgresAdminAuthRepository } from './auth/admin-auth.ts'

const config = loadMarketplaceApiConfig(process.env)
const oauth = config.githubOAuth
const adminAuth = oauth ? new AdminAuthService(
  new PostgresAdminAuthRepository(config.databaseUrl),
  new HttpGitHubOAuthClient(oauth.clientId, oauth.clientSecret, `${config.apiPublicUrl.replace(/\/$/, '')}/api/v1/admin/auth/github/callback`),
  oauth.sessionSecret,
) : undefined
const app = createMarketplaceApp({
  config,
  services: {
    repository: new PostgresMarketplaceRepository(config.databaseUrl),
    objectStore: new S3MarketplaceObjectStore(config.objectStore),
  },
  ...(adminAuth ? { adminAuth } : {}),
})

console.log(`[Marketplace API] 已启动：http://localhost:${config.port}`)

export default {
  port: config.port,
  fetch: app.fetch,
}
