import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import type { MarketplaceSubmissionDetail, MarketplaceSubmissionSummary } from '@proma/shared'
import { MemoryMarketplaceObjectStore } from '../object-store/memory-object-store.ts'
import { quarantinePackageKey } from '../object-store/object-store.ts'
import { SubmissionService, type SubmissionInternalRecord, type SubmissionRepository } from './submission-service.ts'

class MemoryRepository implements SubmissionRepository {
  rows: SubmissionInternalRecord[] = []
  async findByIdempotencyKey(key: string, actor: string) { return this.rows.find((row) => row.submittedBy === actor && row.id === key) }
  async create(input: { id: string; fileName: string; size: number; actor: string; idempotencyKey: string }) { const row: SubmissionInternalRecord = { id: input.id, fileName: input.fileName, packageSize: input.size, objectKey: quarantinePackageKey(input.id), status: 'uploading', submittedBy: input.actor, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), validationIssues: [] }; this.rows.push(row); return row }
  async complete(id: string, actor: string, sha256: string) { const row = this.rows.find((item) => item.id === id && item.submittedBy === actor); if (!row) return undefined; row.status = 'validating'; row.sha256 = sha256; return row }
  async list(): Promise<MarketplaceSubmissionSummary[]> { return this.rows }
  async get(id: string): Promise<MarketplaceSubmissionDetail | undefined> { const row = this.rows.find((item) => item.id === id); if (!row) return undefined; const { objectKey: _objectKey, ...detail } = row; return detail }
  async getInternal(id: string) { return this.rows.find((row) => row.id === id) }
}

const editor = { githubLogin: 'proma-editor', displayName: 'Proma 编辑部', role: 'editor' as const }

describe('SubmissionService', () => {
  test('上传包保持在 quarantine，hash 正确后进入校验', async () => {
    const repository = new MemoryRepository()
    const objects = new MemoryMarketplaceObjectStore()
    const service = new SubmissionService(repository, objects)
    const created = await service.create({ fileName: 'skill.zip', size: 3, idempotencyKey: 'request-123' }, editor)
    const objectKey = quarantinePackageKey(created.submission.id)
    expect(created).not.toHaveProperty('objectKey')
    const body = new Uint8Array([1, 2, 3])
    await objects.putPackage(objectKey, body)
    const completed = await service.complete(created.submission.id, createHash('sha256').update(body).digest('hex'), editor)
    expect(completed.status).toBe('validating')
  })

  test('拒绝超限与 hash 不符的上传', async () => {
    const service = new SubmissionService(new MemoryRepository(), new MemoryMarketplaceObjectStore())
    await expect(service.create({ fileName: 'skill.zip', size: 21 * 1024 * 1024, idempotencyKey: 'request-123' }, editor)).rejects.toMatchObject({ code: 'PACKAGE_TOO_LARGE' })
  })
})
