import { describe, expect, test } from 'bun:test'
import { applyMarketplaceGoldenPathAction } from './index'

describe('Marketplace 发布黄金路径状态机', () => {
  test('Given 已校验候选版本 When 提交审核并批准 Then 状态前进且线上指针保持不变', () => {
    const submitted = applyMarketplaceGoldenPathAction({
      action: 'submit_review',
      versionId: 'version-candidate',
      versionStatus: 'created',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-current',
    })
    const approved = applyMarketplaceGoldenPathAction({
      action: 'approve',
      versionId: 'version-candidate',
      versionStatus: submitted.versionStatus,
      skillStatus: submitted.skillStatus,
      currentPublishedVersionId: submitted.currentPublishedVersionId,
    })

    expect(submitted).toEqual({
      changed: true,
      versionStatus: 'pending_review',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-current',
    })
    expect(approved).toEqual({
      changed: true,
      versionStatus: 'approved',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-current',
    })
  })

  test('Given 已批准候选版本 When 发布 Then 原子结果切换线上指针并标记 Skill 已发布', () => {
    expect(applyMarketplaceGoldenPathAction({
      action: 'publish',
      versionId: 'version-candidate',
      versionStatus: 'approved',
      skillStatus: 'draft',
      currentPublishedVersionId: null,
    })).toEqual({
      changed: true,
      versionStatus: 'published',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-candidate',
    })
  })

  test('Given 动作已成功 When 使用同一动作重试 Then 返回幂等结果', () => {
    expect(applyMarketplaceGoldenPathAction({
      action: 'submit_review',
      versionId: 'version-candidate',
      versionStatus: 'pending_review',
      skillStatus: 'draft',
      currentPublishedVersionId: null,
    }).changed).toBe(false)
    expect(applyMarketplaceGoldenPathAction({
      action: 'approve',
      versionId: 'version-candidate',
      versionStatus: 'approved',
      skillStatus: 'draft',
      currentPublishedVersionId: null,
    }).changed).toBe(false)
    expect(applyMarketplaceGoldenPathAction({
      action: 'publish',
      versionId: 'version-candidate',
      versionStatus: 'published',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-candidate',
    }).changed).toBe(false)
  })

  test('Given 不允许的当前状态 When 执行动作 Then 返回稳定领域错误', () => {
    expect(() => applyMarketplaceGoldenPathAction({
      action: 'approve',
      versionId: 'version-candidate',
      versionStatus: 'created',
      skillStatus: 'draft',
      currentPublishedVersionId: null,
    })).toThrow('MARKETPLACE_VERSION_ACTION_NOT_ALLOWED')

    expect(() => applyMarketplaceGoldenPathAction({
      action: 'publish',
      versionId: 'version-candidate',
      versionStatus: 'published',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-other',
    })).toThrow('MARKETPLACE_PUBLISHED_POINTER_MISMATCH')
  })
})
