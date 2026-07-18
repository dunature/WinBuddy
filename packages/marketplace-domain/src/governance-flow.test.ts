import { describe, expect, test } from 'bun:test'
import {
  MarketplaceVersionGovernanceError,
  applyMarketplaceVersionGovernanceAction,
  getMarketplaceSkillGovernance,
  getMarketplaceVersionGovernance,
  type MarketplaceVersionGovernanceState,
} from './index'

function state(
  versionStatus: MarketplaceVersionGovernanceState['versionStatus'],
  overrides: Partial<MarketplaceVersionGovernanceState> = {},
): MarketplaceVersionGovernanceState {
  return {
    action: 'submit_review',
    versionId: 'version-candidate',
    versionStatus,
    skillStatus: 'published',
    currentPublishedVersionId: 'version-current',
    ...overrides,
  }
}

describe('Marketplace 完整版本治理状态机', () => {
  test('Given 每个版本状态 When 请求治理决策 Then 返回服务端唯一 nextAction 与完整 allowedActions', () => {
    expect(getMarketplaceVersionGovernance('created')).toEqual({
      allowedActions: ['reupload', 'submit_review', 'archive'],
      nextAction: 'submit_review',
    })
    expect(getMarketplaceVersionGovernance('validation_failed')).toEqual({
      allowedActions: ['reupload', 'archive'],
      nextAction: 'reupload',
    })
    expect(getMarketplaceVersionGovernance('pending_review')).toEqual({
      allowedActions: ['approve', 'reject', 'withdraw'],
      nextAction: 'approve',
    })
    expect(getMarketplaceVersionGovernance('approved')).toEqual({
      allowedActions: ['publish', 'withdraw'],
      nextAction: 'publish',
    })
    expect(getMarketplaceVersionGovernance('rejected')).toEqual({
      allowedActions: ['reupload', 'return_to_edit', 'archive'],
      nextAction: 'return_to_edit',
    })
    expect(getMarketplaceVersionGovernance('published')).toEqual({
      allowedActions: ['unpublish'],
      nextAction: 'unpublish',
    })
    expect(getMarketplaceVersionGovernance('unpublished')).toEqual({
      allowedActions: ['republish', 'archive'],
      nextAction: 'republish',
    })
    expect(getMarketplaceVersionGovernance('archived')).toEqual({
      allowedActions: [],
      nextAction: null,
    })
  })

  test('Given Skill 状态 When 请求治理决策 Then 服务端返回新建版本和删除草稿能力', () => {
    expect(getMarketplaceSkillGovernance('draft')).toEqual({
      allowedActions: ['edit_draft', 'create_version', 'delete_draft'],
      nextAction: 'create_version',
    })
    expect(getMarketplaceSkillGovernance('published')).toEqual({
      allowedActions: ['create_version'],
      nextAction: 'create_version',
    })
    expect(getMarketplaceSkillGovernance('archived')).toEqual({ allowedActions: [], nextAction: null })
  })

  test('Given 候选版本 When 驳回、返回编辑或撤回 Then 状态转换且旧线上指针不变', () => {
    const rejected = applyMarketplaceVersionGovernanceAction(state('pending_review', { action: 'reject' }))
    const returned = applyMarketplaceVersionGovernanceAction(state('rejected', { action: 'return_to_edit' }))
    const withdrawn = applyMarketplaceVersionGovernanceAction(state('approved', { action: 'withdraw' }))

    expect(rejected).toMatchObject({ changed: true, versionStatus: 'rejected', currentPublishedVersionId: 'version-current' })
    expect(returned).toMatchObject({ changed: true, versionStatus: 'created', currentPublishedVersionId: 'version-current' })
    expect(withdrawn).toMatchObject({ changed: true, versionStatus: 'created', currentPublishedVersionId: 'version-current' })
  })

  test('Given 所有合法状态边 When 执行动作 Then 每条边都到达服务端声明的目标状态', () => {
    const cases: Array<{
      action: MarketplaceVersionGovernanceState['action']
      from: MarketplaceVersionGovernanceState['versionStatus']
      to: MarketplaceVersionGovernanceState['versionStatus']
      skillStatus?: MarketplaceVersionGovernanceState['skillStatus']
      pointer?: string | null
    }> = [
      { action: 'submit_review', from: 'created', to: 'pending_review' },
      { action: 'approve', from: 'pending_review', to: 'approved' },
      { action: 'reject', from: 'pending_review', to: 'rejected' },
      { action: 'return_to_edit', from: 'rejected', to: 'created' },
      { action: 'withdraw', from: 'pending_review', to: 'created' },
      { action: 'withdraw', from: 'approved', to: 'created' },
      { action: 'publish', from: 'approved', to: 'published' },
      { action: 'unpublish', from: 'published', to: 'unpublished', pointer: 'version-candidate' },
      { action: 'republish', from: 'unpublished', to: 'published', skillStatus: 'unpublished', pointer: null },
      { action: 'archive', from: 'created', to: 'archived' },
      { action: 'archive', from: 'validation_failed', to: 'archived' },
      { action: 'archive', from: 'rejected', to: 'archived' },
      { action: 'archive', from: 'unpublished', to: 'archived', skillStatus: 'unpublished', pointer: null },
    ]

    for (const edge of cases) {
      const result = applyMarketplaceVersionGovernanceAction(state(edge.from, {
        action: edge.action,
        ...(edge.skillStatus ? { skillStatus: edge.skillStatus } : {}),
        ...(edge.pointer !== undefined ? { currentPublishedVersionId: edge.pointer } : {}),
      }))
      expect(result.changed).toBe(true)
      expect(result.versionStatus).toBe(edge.to)
    }
  })

  test('Given 当前线上版本 When 下架、重新发布并归档 Then 指针和 Skill 状态遵循事务语义', () => {
    const unpublished = applyMarketplaceVersionGovernanceAction(state('published', {
      action: 'unpublish',
      versionId: 'version-current',
    }))
    expect(unpublished).toMatchObject({
      changed: true,
      versionStatus: 'unpublished',
      skillStatus: 'unpublished',
      currentPublishedVersionId: null,
    })

    const republished = applyMarketplaceVersionGovernanceAction(state('unpublished', {
      action: 'republish',
      versionId: 'version-current',
      skillStatus: 'unpublished',
      currentPublishedVersionId: null,
    }))
    expect(republished).toMatchObject({
      changed: true,
      versionStatus: 'published',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-current',
    })

    const archived = applyMarketplaceVersionGovernanceAction(state('unpublished', {
      action: 'archive',
      skillStatus: 'unpublished',
      currentPublishedVersionId: null,
    }))
    expect(archived).toMatchObject({
      changed: true,
      versionStatus: 'archived',
      skillStatus: 'archived',
      currentPublishedVersionId: null,
    })
  })

  test('Given 已被新版本替换的历史版本 When 请求动作或归档 Then 不允许重发且不影响当前线上 Skill', () => {
    expect(getMarketplaceVersionGovernance('unpublished', {
      versionId: 'version-history',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-current',
    })).toEqual({ allowedActions: ['archive'], nextAction: 'archive' })

    expect(applyMarketplaceVersionGovernanceAction(state('unpublished', {
      action: 'archive',
      versionId: 'version-history',
    }))).toMatchObject({
      versionStatus: 'archived',
      skillStatus: 'published',
      currentPublishedVersionId: 'version-current',
    })
  })

  test('Given 非当前线上版本或非法状态 When 执行治理动作 Then 返回稳定领域错误', () => {
    expect(() => applyMarketplaceVersionGovernanceAction(state('published', {
      action: 'unpublish',
      versionId: 'version-other',
    }))).toThrow(new MarketplaceVersionGovernanceError('MARKETPLACE_PUBLISHED_POINTER_MISMATCH'))
    expect(() => applyMarketplaceVersionGovernanceAction(state('approved', {
      action: 'reject',
    }))).toThrow(new MarketplaceVersionGovernanceError('MARKETPLACE_VERSION_ACTION_NOT_ALLOWED'))
  })
})
