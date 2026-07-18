import { expect, test } from 'bun:test'
import type { MarketplaceBulkGovernanceResult } from '@proma/shared'
import { failedBulkTargets, updateBulkSelection } from './admin-bulk-state'

test('Given 多项已选择 When 切换单项 Then 返回新 Map 且不修改原选择', () => {
  const initial = new Map([['skill:a', { key: 'skill:a', skillId: 'a', revision: 1 }]])
  const added = updateBulkSelection(initial, { key: 'version:b', skillId: 'b', versionId: 'v-b' }, true)
  const removed = updateBulkSelection(added, { key: 'skill:a', skillId: 'a', revision: 1 }, false)

  expect([...initial.keys()]).toEqual(['skill:a'])
  expect([...added.keys()]).toEqual(['skill:a', 'version:b'])
  expect([...removed.keys()]).toEqual(['version:b'])
})

test('Given 批量结果部分失败 When 构造重试目标 Then 只保留 failed 子集', () => {
  const result: MarketplaceBulkGovernanceResult = {
    action: 'unpublish',
    succeeded: [{ key: 'a', skillId: 'a', versionId: 'v-a', outcome: 'succeeded', code: 'OK', message: 'ok' }],
    skipped: [],
    failed: [{ key: 'b', skillId: 'b', versionId: 'v-b', outcome: 'failed', code: 'BAD', message: 'bad' }],
  }
  expect(failedBulkTargets(result)).toEqual([{ key: 'b', skillId: 'b', versionId: 'v-b' }])
})
