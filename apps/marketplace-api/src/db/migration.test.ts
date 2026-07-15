import { describe, expect, test } from 'bun:test'

describe('Marketplace database migration', () => {
  test('建表和分类 seed 可以重复执行', async () => {
    const sql = await Bun.file(new URL('../../drizzle/0000_marketplace.sql', import.meta.url)).text()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS marketplace_skills')
    expect(sql).toContain('ON CONFLICT (slug) DO UPDATE')
    expect(sql).toContain("'research', '研究与分析'")
  })
})
