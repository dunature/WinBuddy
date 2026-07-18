import { cleanupTrackedE2eDatabase } from './database-state'

export default async function globalTeardown(): Promise<void> {
  const adminDatabaseUrl = process.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
  if (!adminDatabaseUrl) return
  await cleanupTrackedE2eDatabase(adminDatabaseUrl)
}
