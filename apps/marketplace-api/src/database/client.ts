import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createMarketplaceDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 })
  return {
    sql,
    db: drizzle(sql, { schema }),
  }
}

export type MarketplaceDatabase = ReturnType<typeof createMarketplaceDatabase>
