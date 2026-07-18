import { loadMarketplaceDatabaseUrl } from './config'
import { createMarketplaceDatabase } from './database/client'
import { runMarketplaceMigrations } from './database/migrate'

const databaseUrl = loadMarketplaceDatabaseUrl()
const database = createMarketplaceDatabase(databaseUrl)

try {
  await runMarketplaceMigrations(database.sql)
  console.log('[技能市场 API] 数据库迁移完成')
} finally {
  await database.sql.end()
}
