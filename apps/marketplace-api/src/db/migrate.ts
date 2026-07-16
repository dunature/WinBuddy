import { readdir } from 'node:fs/promises'
import postgres from 'postgres'
import { loadMarketplaceApiConfig } from '../config.ts'

const MIGRATIONS_DIRECTORY = new URL('../../drizzle/', import.meta.url)

export async function listMarketplaceMigrations(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIRECTORY))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right))
}

export async function runMarketplaceMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 })
  const applied: string[] = []
  try {
    await sql`CREATE TABLE IF NOT EXISTS marketplace_schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`
    const completed = await sql<{ name: string }[]>`SELECT name FROM marketplace_schema_migrations`
    const completedNames = new Set(completed.map((row) => row.name))
    for (const name of await listMarketplaceMigrations()) {
      if (completedNames.has(name)) continue
      const source = await Bun.file(new URL(name, MIGRATIONS_DIRECTORY)).text()
      try {
        await sql.begin(async (transaction) => {
          await transaction.unsafe(source)
          await transaction`INSERT INTO marketplace_schema_migrations (name) VALUES (${name})`
        })
      } catch (error) {
        throw new MarketplaceMigrationError(name, error)
      }
      applied.push(name)
    }
    return applied
  } finally {
    await sql.end()
  }
}

export class MarketplaceMigrationError extends Error {
  readonly code = 'MIGRATION_FAILED' as const
  constructor(readonly migration: string, cause: unknown) {
    super(`Marketplace migration 失败：${migration}`, { cause })
  }
}

if (import.meta.main) {
  const config = loadMarketplaceApiConfig(process.env)
  const applied = await runMarketplaceMigrations(config.databaseUrl)
  console.log(`[Marketplace API] 数据库 migration 完成，本次执行 ${applied.length} 个文件`)
}
