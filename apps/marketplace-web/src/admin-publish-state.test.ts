import { describe, expect, test } from 'bun:test'
import { completeAdminPublishAction } from './admin-publish-state'

describe('管理端发布动作状态', () => {
  test('Given 其他版本已有状态 When 当前版本动作完成 Then 只更新当前版本并保留不可变 Map', () => {
    const initial = new Map([
      ['version-other', { phase: 'error' as const, message: null, error: '旧错误' }],
      ['version-current', { phase: 'submitting' as const, message: null, error: null }],
    ])
    const next = completeAdminPublishAction(initial, 'version-current', '已提交审核')

    expect(next).not.toBe(initial)
    expect(next.get('version-current')).toEqual({ phase: 'success', message: '已提交审核', error: null })
    expect(next.get('version-other')).toEqual(initial.get('version-other'))
    expect(initial.get('version-current')?.phase).toBe('submitting')
  })
})
