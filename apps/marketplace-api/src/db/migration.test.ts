import { describe, expect, test } from 'bun:test'
import { listMarketplaceMigrations } from './migrate.ts'

describe('Marketplace database migration', () => {
  test('建表和分类 seed 可以重复执行', async () => {
    const sql = await Bun.file(new URL('../../drizzle/0000_marketplace.sql', import.meta.url)).text()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS marketplace_skills')
    expect(sql).toContain('ON CONFLICT (slug) DO UPDATE')
    expect(sql).toContain("'research', '研究与分析'")
  })

  test('按文件名顺序发现全部 migration', async () => {
    expect(await listMarketplaceMigrations()).toEqual([
      '0000_marketplace.sql',
      '0001_marketplace_admin_auth.sql',
      '0002_marketplace_submissions.sql',
      '0003_marketplace_validation_payload.sql',
    ])
  })
})
