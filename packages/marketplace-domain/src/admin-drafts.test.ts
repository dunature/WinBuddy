import { describe, expect, test } from 'bun:test'
import {
  compareMarketplaceSemVer,
  createMarketplaceCandidateVersionState,
  createMarketplaceDraftSkillState,
  MARKETPLACE_SKILL_STATUSES,
  MARKETPLACE_VERSION_STATUSES,
  isMarketplaceIdentifier,
  isMarketplaceSemVer,
} from './index'

describe('技能市场草稿领域规则', () => {
  test('Given identifier 候选值 When 校验 Then 仅接受小写短横线格式', () => {
    expect(isMarketplaceIdentifier('deep-research')).toBe(true)
    expect(isMarketplaceIdentifier('skill2')).toBe(true)
    expect(isMarketplaceIdentifier('Deep-Research')).toBe(false)
    expect(isMarketplaceIdentifier('deep--research')).toBe(false)
    expect(isMarketplaceIdentifier('-deep-research')).toBe(false)
    expect(isMarketplaceIdentifier('deep_research')).toBe(false)
    expect(isMarketplaceIdentifier(`a${'b'.repeat(64)}`)).toBe(false)
  })

  test('Given 版本候选值 When 校验 Then 接受完整 SemVer 2.0.0 并拒绝非规范形式', () => {
    expect(isMarketplaceSemVer('1.0.0')).toBe(true)
    expect(isMarketplaceSemVer('2.1.3-beta.1+build.7')).toBe(true)
    expect(isMarketplaceSemVer('v1.0.0')).toBe(false)
    expect(isMarketplaceSemVer('1.0')).toBe(false)
    expect(isMarketplaceSemVer('01.0.0')).toBe(false)
    expect(isMarketplaceSemVer('1.0.0-01')).toBe(false)
  })

  test('Given 合法 SemVer When 比较更新顺序 Then 遵循 prerelease precedence 并忽略 build metadata', () => {
    expect(compareMarketplaceSemVer('1.2.0', '1.1.9')).toBe(1)
    expect(compareMarketplaceSemVer('1.2.0-beta.2', '1.2.0-beta.10')).toBe(-1)
    expect(compareMarketplaceSemVer('1.2.0', '1.2.0-rc.1')).toBe(1)
    expect(compareMarketplaceSemVer('1.2.0+build.2', '1.2.0+build.1')).toBe(0)
  })

  test('Given 新建 Skill 与候选版本 When 生成初始状态 Then 使用固定状态且不改变线上指针', () => {
    expect(MARKETPLACE_SKILL_STATUSES).toEqual(['draft', 'published', 'unpublished', 'archived'])
    expect(MARKETPLACE_VERSION_STATUSES).toEqual([
      'created', 'validation_failed', 'pending_review', 'approved',
      'rejected', 'published', 'unpublished', 'archived',
    ])
    expect(createMarketplaceDraftSkillState()).toEqual({
      status: 'draft',
      currentPublishedVersionId: null,
    })
    expect(createMarketplaceCandidateVersionState('published-version-id')).toEqual({
      status: 'created',
      currentPublishedVersionId: 'published-version-id',
    })
    expect(createMarketplaceCandidateVersionState(null)).toEqual({
      status: 'created',
      currentPublishedVersionId: null,
    })
  })
})
