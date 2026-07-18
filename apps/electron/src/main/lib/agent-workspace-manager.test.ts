import { describe, expect, test } from 'bun:test'
import { normalizeSkillImportSource, normalizeWorkspaceMcpConfig } from './agent-workspace-manager'

describe('Agent 工作区 MCP 配置', () => {
  test('Given 工作区 MCP 包含内置保留名 When 归一化配置 Then 剔除冲突项并保留普通服务器', () => {
    const normalized = normalizeWorkspaceMcpConfig({
      servers: {
        automation: {
          type: 'stdio',
          command: 'custom-automation',
          enabled: true,
        },
        nano_banana: {
          type: 'stdio',
          command: 'custom-nano',
          enabled: true,
        },
        github: {
          type: 'stdio',
          command: 'github-mcp',
          enabled: true,
        },
      },
    })

    expect(Object.keys(normalized.servers).sort()).toEqual(['github'])
    expect(normalized.servers.github?.command).toBe('github-mcp')
  })
})

describe('Skill 来源元数据', () => {
  test('Given 旧版来源文件没有 kind When 读取来源 Then 作为 workspace 来源且不改写磁盘', () => {
    expect(normalizeSkillImportSource({
      sourceWorkspaceSlug: 'source-workspace',
      sourceWorkspaceName: '来源工作区',
      importedAt: '2026-07-01T00:00:00.000Z',
      sourceVersion: '1.0.0',
    })).toEqual({
      kind: 'workspace',
      sourceWorkspaceSlug: 'source-workspace',
      sourceWorkspaceName: '来源工作区',
      importedAt: '2026-07-01T00:00:00.000Z',
      sourceVersion: '1.0.0',
    })
  })

  test('Given marketplace 来源文件 When 读取来源 Then 保留市场安装信息', () => {
    const source = {
      kind: 'marketplace',
      marketplaceSkillId: 'skill-public',
      identifier: 'deep-research',
      installedVersion: '1.2.0',
      contentHash: 'a'.repeat(64),
      installedAt: '2026-07-18T05:30:00.000Z',
    } as const

    expect(normalizeSkillImportSource(source)).toEqual(source)
  })
})
