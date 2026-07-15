import { existsSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export function realpathOrResolve(path: string): string {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

export function isUnderAuthorizedRoot(resolvedPath: string, root: string): boolean {
  const resolvedRoot = realpathOrResolve(root)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep)
}

export function isPathAllowedByRoots(filePath: string, roots: string[]): boolean {
  let resolved: string
  try {
    resolved = realpathSync(resolve(filePath))
  } catch {
    return false
  }
  return roots.some((root) => isUnderAuthorizedRoot(resolved, root))
}

export function filterAllowedCandidateBasePaths(candidateBasePaths: string[] | undefined, roots: string[]): string[] | undefined {
  const allowed = candidateBasePaths?.filter((basePath) => isPathAllowedByRoots(basePath, roots)) ?? []
  return allowed.length > 0 ? allowed : undefined
}

export function ensureResolvedPathAllowed(filePath: string, roots: string[]): string | null {
  if (!existsSync(filePath)) return null
  let realPath: string
  try {
    realPath = realpathSync(resolve(filePath))
  } catch {
    return null
  }
  return roots.some((root) => isUnderAuthorizedRoot(realPath, root)) ? realPath : null
}
