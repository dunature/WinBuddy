import postgres from 'postgres'
import { loadMarketplaceApiConfig } from '../config.ts'

const config = loadMarketplaceApiConfig(process.env)
const sql = postgres(config.databaseUrl, { max: 1 })
const migration = await Bun.file(new URL('../../drizzle/0000_marketplace.sql', import.meta.url)).text()

try {
  await sql.unsafe(migration)
  console.log('[Marketplace API] 数据库 migration 完成')
} finally {
  await sql.end()
}
