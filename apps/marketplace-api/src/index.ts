import { createMarketplaceApp } from './app.ts'
import { loadMarketplaceApiConfig } from './config.ts'

const config = loadMarketplaceApiConfig(process.env)
const app = createMarketplaceApp({ config })

console.log(`[Marketplace API] 已启动：http://localhost:${config.port}`)

export default {
  port: config.port,
  fetch: app.fetch,
}
