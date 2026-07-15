import { describe, expect, test } from 'bun:test'
import { addedPermissions } from './marketplace-updates'

describe('Marketplace 更新权限差异', () => {
  test('首次兼容来源按最小权限计算新增项', () => {
    expect(addedPermissions(undefined, { network: true, filesystem: { read: true, write: 'output-only' }, shell: false }))
      .toEqual(['network', 'filesystem', 'filesystem.write'])
  })

  test('只报告真实扩权，不报告收权或不变项', () => {
    expect(addedPermissions(
      { network: true, filesystem: { read: true, write: 'workspace' }, shell: false },
      { network: false, filesystem: { read: true, write: 'output-only' }, shell: true },
    )).toEqual(['shell'])
  })
})
