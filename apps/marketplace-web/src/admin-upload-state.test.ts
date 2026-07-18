import { describe, expect, test } from 'bun:test'
import type { MarketplaceAdminUpload } from '@proma/shared'
import { mergeAdminUploadState, needsAdminUploadPolling } from './admin-upload-state'

const queuedUpload: MarketplaceAdminUpload = {
  id: 'upload-1',
  versionId: 'version-1',
  originalFilename: 'daily-briefing.zip',
  sha256: 'abc',
  size: 1024,
  status: 'queued',
  attemptCount: 0,
  versionStatus: 'created',
  versionRevision: 1,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-18T08:00:00.000Z',
  report: null,
}

describe('管理端上传状态', () => {
  test('Given 版本上传历史 When 合并轮询结果 Then 新记录置顶且不修改旧 Map', () => {
    const initial = new Map([['version-1', { phase: 'ready' as const, items: [queuedUpload], error: null }]])
    const completed = { ...queuedUpload, status: 'succeeded' as const, attemptCount: 1 }
    const next = mergeAdminUploadState(initial, 'version-1', completed)

    expect(next).not.toBe(initial)
    expect(next.get('version-1')?.items).toEqual([completed])
    expect(initial.get('version-1')?.items).toEqual([queuedUpload])
  })

  test('Given queued/running 与终态记录 When 判断恢复轮询 Then 仅未终态需要继续', () => {
    expect(needsAdminUploadPolling([queuedUpload])).toBe(true)
    expect(needsAdminUploadPolling([{ ...queuedUpload, status: 'running' }])).toBe(true)
    expect(needsAdminUploadPolling([{ ...queuedUpload, status: 'failed' }])).toBe(false)
    expect(needsAdminUploadPolling([{ ...queuedUpload, status: 'succeeded' }])).toBe(false)
  })
})
