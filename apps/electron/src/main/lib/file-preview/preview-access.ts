import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import type { FileAccessOptions } from '@proma/shared'
import { normalizePathForCompare } from '@proma/shared'
import { getAgentSessionMeta } from '../agent-session-manager'
import { getAgentWorkspacesDir, getWorkspaceFilesDir } from '../config-paths'
import {
  getAgentWorkspace,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
  getWorktreeRepos,
} from '../agent-workspace-manager'
import { getMainRepoRoot } from '../git-diff-service'
import { resolveTargetPath } from '../file-preview-service'
import {
  filterAllowedCandidateBasePaths,
  isPathAllowedByRoots,
  realpathOrResolve,
} from './preview-access-core'

export interface AuthorizedPreviewFile {
  resolvedPath: string
}

function getAuthorizedRoots(options?: FileAccessOptions): string[] {
  const roots: string[] = [
    getAgentWorkspacesDir(),
    join(tmpdir(), 'proma-preview'),
  ]

  const workspaceSlugs = new Set<string>()
  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.attachedDirectories) roots.push(...meta.attachedDirectories)
    if (meta?.attachedFiles) roots.push(...meta.attachedFiles)
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) workspaceSlugs.add(workspace.slug)
    }
  }
  if (options?.workspaceSlug) workspaceSlugs.add(options.workspaceSlug)

  for (const slug of workspaceSlugs) {
    roots.push(getWorkspaceFilesDir(slug))
    roots.push(...getWorkspaceAttachedDirectories(slug))
    roots.push(...getWorkspaceAttachedFiles(slug))
  }

  return roots
}

export function isPreviewPathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  return isPathAllowedByRoots(filePath, getAuthorizedRoots(options))
}

function getAllowedCandidateBasePaths(options?: FileAccessOptions): string[] | undefined {
  return filterAllowedCandidateBasePaths(options?.candidateBasePaths, getAuthorizedRoots(options))
}

async function getAccessRootMainRepo(root: string): Promise<string | null> {
  if (!existsSync(root)) return null
  let probePath = root
  try {
    const stats = statSync(probePath)
    if (stats.isFile()) probePath = dirname(probePath)
  } catch {
    return null
  }
  return getMainRepoRoot(probePath)
}

async function isPreviewPathAllowedWithWorktree(filePath: string, options?: FileAccessOptions): Promise<boolean> {
  if (isPreviewPathAllowed(filePath, options)) return true

  const mainRepo = await getMainRepoRoot(filePath)
  if (!mainRepo) return false

  const targetMainRepo = normalizePathForCompare(realpathOrResolve(mainRepo))

  for (const root of getAuthorizedRoots(options)) {
    const authorizedMainRepo = await getAccessRootMainRepo(root)
    if (!authorizedMainRepo) continue
    const authorizedRoot = normalizePathForCompare(realpathOrResolve(authorizedMainRepo))
    if (authorizedRoot === targetMainRepo) return true
  }

  const workspaceSlugs = new Set<string>()
  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) workspaceSlugs.add(workspace.slug)
    }
  }
  if (options?.workspaceSlug) workspaceSlugs.add(options.workspaceSlug)

  for (const slug of workspaceSlugs) {
    let repos: import('@proma/shared').WorkspaceWorktreeRepo[]
    try {
      repos = await getWorktreeRepos(slug)
    } catch {
      continue
    }
    for (const repo of repos) {
      const repoMain = await getMainRepoRoot(repo.repoPath)
      const repoRoot = normalizePathForCompare(realpathOrResolve(repoMain ?? repo.repoPath))
      if (repoRoot === targetMainRepo) return true
    }
  }

  return false
}

export async function resolveAuthorizedPreviewFile(
  filePath: string,
  access?: FileAccessOptions,
): Promise<AuthorizedPreviewFile | null> {
  const allowedBasePaths = getAllowedCandidateBasePaths(access)
  const resolved = resolveTargetPath(filePath, allowedBasePaths)
  if (!existsSync(resolved)) return null

  const realPath = realpathOrResolve(resolved)

  if (!await isPreviewPathAllowedWithWorktree(realPath, access)) {
    console.warn('[file-preview] 拒绝越界预览路径:', realPath)
    return null
  }

  return { resolvedPath: realPath }
}
