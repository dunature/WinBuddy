import { randomUUID } from 'node:crypto'
import { initializeMarketplaceAdmin } from './admin-auth'
import { createMarketplaceApp } from './app'
import { loadMarketplaceConfig } from './config'
import { createMarketplaceDatabase } from './database/client'

const config = loadMarketplaceConfig()
const database = createMarketplaceDatabase(config.databaseUrl)
await initializeMarketplaceAdmin(database, {
  username: config.adminUsername,
  initialPassword: config.adminInitialPassword,
  requestId: randomUUID(),
})
const app = createMarketplaceApp({
  database,
  webRoot: config.webRoot,
  allowedOrigin: config.allowedOrigin,
})

Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
})

console.log(`[技能市场 API] 已启动: http://${config.host}:${config.port}`)
