import { describe, expect, test } from 'bun:test'
import { MemoryMarketplaceObjectStore } from './memory-object-store.ts'
import { publishedPackageKey, quarantinePackageKey } from './object-store.ts'

describe('MarketplaceObjectStore', () => {
  test('quarantine 与公开 key 明确隔离', () => {
    expect(quarantinePackageKey('submission-1')).toBe('quarantine/submissions/submission-1/package.zip')
    expect(publishedPackageKey('skill-1', '1.0.0')).toBe('skills/skill-1/1.0.0/package.zip')
  })

  test('内存 adapter 支持写入、签名读取和删除', async () => {
    const store = new MemoryMarketplaceObjectStore()
    const stored = await store.putPackage('quarantine/test/package.zip', new Uint8Array([1, 2, 3]))
    expect(stored.size).toBe(3)
    expect(await store.getSignedDownloadUrl(stored.key, 60)).toContain('expires=60')
    await store.deleteObject(stored.key)
    expect(store.objects.has(stored.key)).toBe(false)
  })
})
