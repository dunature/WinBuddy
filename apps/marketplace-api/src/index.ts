import { createMarketplaceApp } from './app.ts'
import { loadMarketplaceApiConfig } from './config.ts'
import { S3MarketplaceObjectStore } from './object-store/s3-object-store.ts'
import { PostgresMarketplaceRepository } from './repository/postgres-marketplace-repository.ts'

const config = loadMarketplaceApiConfig(process.env)
const app = createMarketplaceApp({
  config,
  services: {
    repository: new PostgresMarketplaceRepository(config.databaseUrl),
    objectStore: new S3MarketplaceObjectStore(config.objectStore),
  },
})

console.log(`[Marketplace API] 已启动：http://localhost:${config.port}`)

export default {
  port: config.port,
  fetch: app.fetch,
}
