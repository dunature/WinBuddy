import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import postgres from 'postgres'

const statePath = join(tmpdir(), 'proma-marketplace-web-e2e-state.json')

interface E2eDatabaseState {
  databaseUrl: string
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export async function writeE2eDatabaseState(databaseUrl: string): Promise<void> {
  await writeFile(statePath, JSON.stringify({ databaseUrl } satisfies E2eDatabaseState), 'utf8')
}

export async function cleanupTrackedE2eDatabase(adminDatabaseUrl: string): Promise<void> {
  let serialized: string
  try {
    serialized = await readFile(statePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }

  const state = JSON.parse(serialized) as E2eDatabaseState
  const databaseName = new URL(state.databaseUrl).pathname.slice(1)
  if (!/^proma_marketplace_[a-f0-9]{32}$/.test(databaseName)) {
    throw new Error(`拒绝删除非 E2E 数据库: ${databaseName}`)
  }

  const admin = postgres(adminDatabaseUrl, { max: 1 })
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
  } finally {
    await admin.end()
    await rm(statePath, { force: true })
  }
}
