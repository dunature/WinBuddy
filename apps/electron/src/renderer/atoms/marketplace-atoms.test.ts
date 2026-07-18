import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import {
  applyMarketplaceInstallProgressAtom,
  findMarketplaceInstallTask,
  initialMarketplaceState,
  marketplaceInstallPhaseLabel,
  marketplaceInstallTasksAtom,
  notifyMarketplaceWorkspaceChangedAtom,
  toMarketplaceListQuery,
  withMarketplaceInstallState,
} from './marketplace-atoms'
import type { MarketplaceInstallState } from '@proma/shared'
import { workspaceCapabilitiesVersionAtom } from './agent-atoms'

describe('技能市场查询状态', () => {
  test('Given 未整理的筛选状态 When 转换为目录查询 Then 去除空白并保留分页条件', () => {
    const query = toMarketplaceListQuery({
      ...initialMarketplaceState,
      query: '  研究  ',
      category: 'research',
      featured: true,
      sort: 'latest',
      page: 3,
    })

    expect(query).toEqual({
      query: '研究',
      category: 'research',
      featured: true,
      sort: 'latest',
      page: 3,
      pageSize: 16,
    })
  })

  test('Given 空筛选状态 When 转换为目录查询 Then 不传递无意义筛选字段', () => {
    expect(toMarketplaceListQuery(initialMarketplaceState)).toEqual({
      sort: 'hot',
      page: 1,
      pageSize: 16,
    })
  })
})

test('Given 多个安装进度 When 写入 Jotai Map Then 按 installId 独立保存最新状态', () => {
  const first: MarketplaceInstallState = {
    installId: 'install-1', action: 'install', phase: 'downloading', workspaceSlug: 'research',
    marketplaceSkillId: 'skill-1', version: '1.0.0', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:01.000Z',
  }
  const second: MarketplaceInstallState = {
    ...first, installId: 'install-2', marketplaceSkillId: 'skill-2', phase: 'queued',
  }
  const completed = { ...first, phase: 'completed' as const, updatedAt: '2026-07-18T00:00:02.000Z' }

  const tasks = withMarketplaceInstallState(withMarketplaceInstallState(withMarketplaceInstallState(new Map(), first), second), completed)

  expect(tasks.size).toBe(2)
  expect(tasks.get('install-1')?.phase).toBe('completed')
  expect(tasks.get('install-2')?.phase).toBe('queued')
})

test('Given 冲突确认产生新任务 When 查找当前安装 Then 优先返回最新任务', () => {
  const failed: MarketplaceInstallState = {
    installId: 'install-conflict', action: 'install', phase: 'failed', workspaceSlug: 'research',
    marketplaceSkillId: 'skill-1', version: '1.0.0', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:01.000Z',
    errorCode: 'TARGET_CONFLICT',
  }
  const downloading: MarketplaceInstallState = {
    ...failed,
    installId: 'install-confirmed',
    phase: 'downloading',
    createdAt: '2026-07-18T00:01:00.000Z',
    updatedAt: '2026-07-18T00:01:01.000Z',
    errorCode: undefined,
  }

  const current = findMarketplaceInstallTask(
    new Map([[failed.installId, failed], [downloading.installId, downloading]]),
    'research',
    'skill-1',
    '1.0.0',
  )

  expect(current?.installId).toBe('install-confirmed')
})

test('Given 固定安装阶段 When 显示进度 Then 每个阶段都有中文标签', () => {
  expect([
    'queued', 'downloading', 'verifying', 'extracting', 'committing', 'completed', 'failed', 'cancelled',
  ].map((phase) => marketplaceInstallPhaseLabel(phase as MarketplaceInstallState['phase']))).toEqual([
    '等待安装', '正在下载', '正在校验', '正在解压', '正在提交', '安装完成', '安装失败', '已取消',
  ])
})

test('Given 更新任务 When 显示终态进度 Then 使用更新语义而不是安装语义', () => {
  expect([
    marketplaceInstallPhaseLabel('queued', 'update'),
    marketplaceInstallPhaseLabel('completed', 'update'),
    marketplaceInstallPhaseLabel('failed', 'update'),
    marketplaceInstallPhaseLabel('cancelled', 'update'),
  ]).toEqual(['等待更新', '更新完成', '更新失败', '更新已取消'])
})

test('Given 市场 Skill 生命周期成功 When 通知工作区变化 Then 递增能力版本', () => {
  const store = createStore()
  store.set(workspaceCapabilitiesVersionAtom, 4)

  store.set(notifyMarketplaceWorkspaceChangedAtom)

  expect(store.get(workspaceCapabilitiesVersionAtom)).toBe(5)
})

test('Given 市场 Skill 更新完成 When 全局进度重复到达 Then 只刷新一次工作区能力', () => {
  const store = createStore()
  const downloading: MarketplaceInstallState = {
    installId: 'update-1', action: 'update', phase: 'downloading', workspaceSlug: 'research',
    marketplaceSkillId: 'skill-1', version: '1.2.0', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:01.000Z',
  }
  const completed: MarketplaceInstallState = {
    ...downloading, phase: 'completed', updatedAt: '2026-07-18T00:00:02.000Z',
  }

  store.set(applyMarketplaceInstallProgressAtom, downloading)
  store.set(applyMarketplaceInstallProgressAtom, completed)
  store.set(applyMarketplaceInstallProgressAtom, completed)

  expect(store.get(marketplaceInstallTasksAtom).get('update-1')?.phase).toBe('completed')
  expect(store.get(workspaceCapabilitiesVersionAtom)).toBe(1)
})
