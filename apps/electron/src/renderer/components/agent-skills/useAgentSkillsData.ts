/**
 * useAgentSkillsData — Agent 技能视图的数据层
 *
 * 封装当前工作区 Skills / MCP 的加载与增删改逻辑（IPC 调用），
 * 供「Agent 技能」全屏视图复用。所有写操作后会 bump
 * workspaceCapabilitiesVersionAtom，通知侧边栏等订阅方刷新。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import { notifyMarketplaceWorkspaceChangedAtom } from '@/atoms/marketplace-atoms'
import type { BuiltinMcpServerSummary, SkillMeta, WorkspaceCapabilities, WorkspaceMcpConfig } from '@proma/shared'

export interface AgentSkillsData {
  /** 当前工作区（未选中时为 null） */
  workspaceSlug: string
  workspaceName: string
  hasWorkspace: boolean
  loading: boolean
  loadError: string | null
  skills: SkillMeta[]
  defaultSkillSlugs: Set<string>
  skillsDir: string
  mcpConfig: WorkspaceMcpConfig
  capabilities: WorkspaceCapabilities | null
  builtinMcpServers: BuiltinMcpServerSummary[]
  updatingSkill: string | null
  toggleSkill: (slug: string, enabled: boolean) => Promise<void>
  deleteSkill: (slug: string, name: string) => Promise<boolean>
  updateSkill: (slug: string) => Promise<void>
  toggleMcp: (name: string, enabled: boolean) => Promise<void>
  toggleBuiltinMcp: (id: string, enabled: boolean) => Promise<void>
  deleteMcp: (name: string) => Promise<void>
  reload: () => Promise<void>
}

export function useAgentSkillsData(): AgentSkillsData {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)
  const notifyMarketplaceWorkspaceChanged = useSetAtom(notifyMarketplaceWorkspaceChangedAtom)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''

  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [defaultSkillSlugs, setDefaultSkillSlugs] = React.useState<Set<string>>(new Set())
  const [skillsDir, setSkillsDir] = React.useState('')
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const [builtinMcpServers, setBuiltinMcpServers] = React.useState<BuiltinMcpServerSummary[]>([])
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)

  const loadData = React.useCallback(async () => {
    setLoading(true)
    if (!workspaceSlug) {
      setSkills([])
      setMcpConfig({ servers: {} })
      setCapabilities(null)
      setBuiltinMcpServers([])
      setLoading(false)
      setLoadError(null)
      return
    }
    setLoadError(null)
    try {
      const [config, skillList, installedMarketplaceSkills, dir, defaultSlugs, capabilities] = await Promise.all([
        window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
        window.electronAPI.listInstalledMarketplaceSkills(workspaceSlug),
        window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
        window.electronAPI.getDefaultSkillSlugs(),
        window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
      ])
      setMcpConfig(config)
      setSkills(skillList.map((skill) => {
        const source = skill.importSource
        if (source?.kind !== 'marketplace') return skill
        const installed = installedMarketplaceSkills.find((candidate) => (
          candidate.marketplaceSkillId === source.marketplaceSkillId
          && candidate.identifier === skill.slug
          && candidate.enabled === skill.enabled
        ))
        if (!installed) return skill
        return {
          ...skill,
          enabled: installed.enabled,
          importSource: {
            kind: 'marketplace' as const,
            marketplaceSkillId: installed.marketplaceSkillId,
            identifier: installed.identifier,
            installedVersion: installed.installedVersion,
            contentHash: installed.contentHash,
            installedAt: installed.installedAt,
          },
        }
      }))
      setSkillsDir(dir)
      setDefaultSkillSlugs(new Set(defaultSlugs))
      setCapabilities(capabilities)
      setBuiltinMcpServers(capabilities.builtinMcpServers)
    } catch (error) {
      console.error('[Agent 技能] 加载工作区配置失败:', error)
      setLoadError(error instanceof Error ? error.message : '加载工作区 Skills 失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  // workspaceSlug 或外部能力版本变化时重新拉取
  React.useEffect(() => {
    void loadData()
  }, [loadData, capabilitiesVersion])

  const toggleSkill = React.useCallback(async (slug: string, enabled: boolean) => {
    try {
      const skill = skills.find((candidate) => candidate.slug === slug)
      if (skill?.importSource?.kind === 'marketplace') {
        await window.electronAPI.setInstalledMarketplaceSkillEnabled({
          workspaceSlug,
          marketplaceSkillId: skill.importSource.marketplaceSkillId,
          enabled,
        })
        notifyMarketplaceWorkspaceChanged()
      } else {
        await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, slug, enabled)
        bumpCapabilitiesVersion((v) => v + 1)
      }
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)))
    } catch (error) {
      console.error('[Agent 技能] 切换 Skill 状态失败:', error)
      toast.error('切换 Skill 状态失败')
    }
  }, [workspaceSlug, skills, bumpCapabilitiesVersion, notifyMarketplaceWorkspaceChanged])

  const deleteSkill = React.useCallback(async (slug: string, name: string): Promise<boolean> => {
    try {
      const skill = skills.find((candidate) => candidate.slug === slug)
      if (skill?.importSource?.kind === 'marketplace') {
        await window.electronAPI.uninstallMarketplaceSkill({
          workspaceSlug,
          marketplaceSkillId: skill.importSource.marketplaceSkillId,
        })
        notifyMarketplaceWorkspaceChanged()
      } else {
        await window.electronAPI.deleteWorkspaceSkill(workspaceSlug, slug)
        bumpCapabilitiesVersion((v) => v + 1)
      }
      setSkills((prev) => prev.filter((s) => s.slug !== slug))
      toast.success(`已删除 Skill：${name}`)
      return true
    } catch (error) {
      console.error('[Agent 技能] 删除 Skill 失败:', error)
      toast.error('删除 Skill 失败')
      return false
    }
  }, [workspaceSlug, skills, bumpCapabilitiesVersion, notifyMarketplaceWorkspaceChanged])

  const updateSkill = React.useCallback(async (slug: string) => {
    if (!workspaceSlug || updatingSkill) return
    setUpdatingSkill(slug)
    try {
      const updated = await window.electronAPI.updateSkillFromSource(workspaceSlug, slug)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? updated : s)))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已同步更新 Skill：${updated.name}`)
    } catch (error) {
      console.error('[Agent 技能] 更新 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('更新 Skill 失败', { description: message })
    } finally {
      setUpdatingSkill(null)
    }
  }, [workspaceSlug, updatingSkill, bumpCapabilitiesVersion])

  const toggleMcp = React.useCallback(async (name: string, enabled: boolean) => {
    try {
      const entry = mcpConfig.servers[name]
      if (!entry) return
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...mcpConfig.servers, [name]: { ...entry, enabled } },
      }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 MCP 服务器状态失败:', error)
      toast.error('切换 MCP 状态失败')
    }
  }, [workspaceSlug, mcpConfig, bumpCapabilitiesVersion])

  const toggleBuiltinMcp = React.useCallback(async (id: string, enabled: boolean) => {
    try {
      const capabilities = await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, id, enabled)
      setCapabilities(capabilities)
      setBuiltinMcpServers(capabilities.builtinMcpServers)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(enabled ? '已启用内置 MCP' : '已关闭内置 MCP')
    } catch (error) {
      console.error('[Agent 技能] 切换内置 MCP 状态失败:', error)
      toast.error('切换内置 MCP 状态失败')
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const deleteMcp = React.useCallback(async (name: string) => {
    const entry = mcpConfig.servers[name]
    if (entry?.isBuiltin) return
    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[name]
      const newConfig: WorkspaceMcpConfig = { servers: newServers }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 MCP 服务器：${name}`)
    } catch (error) {
      console.error('[Agent 技能] 删除 MCP 服务器失败:', error)
      toast.error('删除 MCP 服务器失败')
    }
  }, [workspaceSlug, mcpConfig, bumpCapabilitiesVersion])

  return {
    workspaceSlug,
    workspaceName: currentWorkspace?.name ?? '',
    hasWorkspace: !!currentWorkspace,
    loading,
    loadError,
    skills,
    defaultSkillSlugs,
    skillsDir,
    mcpConfig,
    capabilities,
    builtinMcpServers,
    updatingSkill,
    toggleSkill,
    deleteSkill,
    updateSkill,
    toggleMcp,
    toggleBuiltinMcp,
    deleteMcp,
    reload: loadData,
  }
}
