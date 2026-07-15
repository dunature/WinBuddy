import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { PromptOptimizationRequest } from '@proma/shared'
import { getConfigDir } from '../config-paths'
import { readWorkspaceSkillContent } from '../agent-workspace-manager'
import type { ProtectedReference } from './prompt-reference-validator'

const DEFAULT_FILE_CHAR_LIMIT = 8000
const TOTAL_FILE_CHAR_LIMIT = 20_000

interface ContextItem {
  title: string
  body: string
}

function stripReferencePrefix(value: string): string {
  return value.replace(/^[@/#&]/, '').replace(/^(file|skill|mcp|session):/i, '').trim()
}

function safeReadText(path: string, limit: number): string {
  const stat = statSync(path)
  if (!stat.isFile()) return `无法读取：不是文本文件 (${basename(path)})`
  const content = readFileSync(path, 'utf-8')
  return content.length > limit
    ? `${content.slice(0, limit)}\n\n（内容已按预算截断）`
    : content
}

function resolveFileReference(reference: ProtectedReference, input: PromptOptimizationRequest): string | null {
  const value = stripReferencePrefix(reference.id ?? reference.label ?? reference.rawText)
  if (!value) return null
  const candidates = [
    isAbsolute(value) ? value : null,
    input.workspacePath ? resolve(input.workspacePath, value) : null,
    input.workspaceSlug ? resolve(getConfigDir(), 'agent-workspaces', input.workspaceSlug, 'workspace-files', value) : null,
    resolve(process.cwd(), value),
  ].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const real = realpathSync(candidate)
      if (existsSync(real)) return real
    } catch {
      continue
    }
  }
  return null
}

function buildFileContext(reference: ProtectedReference, input: PromptOptimizationRequest, remainingBudget: number): ContextItem {
  const path = resolveFileReference(reference, input)
  if (!path) {
    return {
      title: `文件引用 ${reference.rawText}`,
      body: '无法读取文件内容，仅保留引用名称。',
    }
  }
  try {
    return {
      title: `文件引用 ${reference.rawText}`,
      body: safeReadText(path, Math.min(DEFAULT_FILE_CHAR_LIMIT, remainingBudget)),
    }
  } catch {
    return {
      title: `文件引用 ${reference.rawText}`,
      body: '文件不可读或不是 UTF-8 文本，仅保留引用名称。',
    }
  }
}

function buildSkillContext(reference: ProtectedReference, input: PromptOptimizationRequest): ContextItem {
  const slug = stripReferencePrefix(reference.id ?? reference.label ?? reference.rawText)
  if (!input.workspaceSlug || !slug) {
    return { title: `Skill 引用 ${reference.rawText}`, body: '缺少工作区信息，仅保留引用名称。' }
  }
  try {
    const content = readWorkspaceSkillContent(input.workspaceSlug, slug)
    return {
      title: `Skill 引用 ${reference.rawText}`,
      body: content.slice(0, 4000),
    }
  } catch {
    return { title: `Skill 引用 ${reference.rawText}`, body: '无法读取 Skill 指令，仅保留引用名称。' }
  }
}

function buildMcpContext(reference: ProtectedReference, input: PromptOptimizationRequest): ContextItem {
  const name = stripReferencePrefix(reference.id ?? reference.label ?? reference.rawText)
  if (!input.workspaceSlug || !name) {
    return { title: `MCP 引用 ${reference.rawText}`, body: '缺少工作区信息，仅保留引用名称。' }
  }
  const mcpPath = join(getConfigDir(), 'agent-workspaces', input.workspaceSlug, 'mcp.json')
  try {
    const raw = readFileSync(mcpPath, 'utf-8')
    const data = JSON.parse(raw) as { servers?: Record<string, unknown>; mcpServers?: Record<string, unknown> }
    const servers = data.servers ?? data.mcpServers ?? {}
    const server = servers[name]
    return {
      title: `MCP 引用 ${reference.rawText}`,
      body: server ? JSON.stringify(server, null, 2).slice(0, 3000) : '未在 mcp.json 中找到对应 Server，仅保留引用名称。',
    }
  } catch {
    return { title: `MCP 引用 ${reference.rawText}`, body: '无法读取 MCP 配置，仅保留引用名称。' }
  }
}

function buildSessionContext(reference: ProtectedReference): ContextItem {
  return {
    title: `会话引用 ${reference.rawText}`,
    body: '沿用现有会话引用机制；优化阶段不额外读取、摘要或截断会话历史。',
  }
}

export function buildPromptReferenceContext(input: PromptOptimizationRequest, references: ProtectedReference[]): string {
  if (references.length === 0) return '（无）'

  const items: ContextItem[] = []
  let remainingFileBudget = TOTAL_FILE_CHAR_LIMIT

  for (const reference of references) {
    const char = reference.char ?? reference.rawText[0]
    if (char === '@') {
      const item = buildFileContext(reference, input, remainingFileBudget)
      remainingFileBudget = Math.max(0, remainingFileBudget - item.body.length)
      items.push(item)
    } else if (char === '/') {
      items.push(buildSkillContext(reference, input))
    } else if (char === '#') {
      items.push(buildMcpContext(reference, input))
    } else if (char === '&') {
      items.push(buildSessionContext(reference))
    }
  }

  return items.map((item) => `### ${item.title}\n${item.body}`).join('\n\n')
}
