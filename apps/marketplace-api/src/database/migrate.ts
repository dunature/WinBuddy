import type { Sql } from 'postgres'

const migrations = [
  {
    id: '0000_public_catalog',
    file: new URL('../../migrations/0000_public_catalog.sql', import.meta.url),
  },
  {
    id: '0001_admin_auth',
    file: new URL('../../migrations/0001_admin_auth.sql', import.meta.url),
  },
  {
    id: '0002_admin_drafts',
    file: new URL('../../migrations/0002_admin_drafts.sql', import.meta.url),
  },
  {
    id: '0003_package_uploads',
    file: new URL('../../migrations/0003_package_uploads.sql', import.meta.url),
  },
] as const

export async function runMarketplaceMigrations(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS marketplace_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `

  const applied = await sql<{ id: string }[]>`SELECT id FROM marketplace_migrations`
  const appliedIds = new Set(applied.map((migration) => migration.id))

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue
    const source = await Bun.file(migration.file).text()
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source)
      await transaction`INSERT INTO marketplace_migrations (id) VALUES (${migration.id})`
    })
  }
}
