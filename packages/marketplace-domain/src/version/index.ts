import semver from 'semver'

const STRICT_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isValidMarketplaceVersion(value: string): boolean {
  return STRICT_SEMVER_PATTERN.test(value) && semver.valid(value) !== null
}

export function compareMarketplaceVersions(left: string, right: string): number {
  if (!isValidMarketplaceVersion(left) || !isValidMarketplaceVersion(right)) {
    throw new Error('无法比较非法的 Semantic Version')
  }
  return semver.compare(left, right)
}

export function satisfiesPromaVersion(version: string, range: string): boolean {
  return semver.satisfies(version, range, { includePrerelease: true })
}
