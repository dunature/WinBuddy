import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'

export interface MarketplaceTestDatabase {
  databaseUrl: string
  close(): Promise<void>
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export async function createMarketplaceTestDatabase(adminDatabaseUrl: string): Promise<MarketplaceTestDatabase> {
  const databaseName = `proma_marketplace_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(adminDatabaseUrl, { max: 1 })
  await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)

  const databaseUrl = new URL(adminDatabaseUrl)
  databaseUrl.pathname = `/${databaseName}`
  const value = databaseUrl.toString()

  return {
    databaseUrl: value,
    async close(): Promise<void> {
      await admin.unsafe(`DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`)
      await admin.end()
    },
  }
}

export async function closeSql(sql: Sql): Promise<void> {
  await sql.end()
}
