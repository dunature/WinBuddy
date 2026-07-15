import { MARKETPLACE_CATEGORIES } from '../manifest/types.ts'
import { isValidMarketplaceVersion } from '../version/index.ts'
import type {
  ManifestIssue,
  MarketplaceCategorySlug,
  SkillManifestV1,
} from '../manifest/types.ts'

interface ValidationResult {
  manifest?: SkillManifestV1
  issues: ManifestIssue[]
}

const KNOWN_FIELDS = new Set([
  'schema_version', 'name', 'display_name', 'description', 'version', 'author',
  'category', 'license', 'permissions', 'tags', 'icon', 'trigger_keywords',
  'homepage', 'repository', 'documentation', 'compatibility', 'dependencies',
  'deprecated', 'replacement',
])

function issue(code: string, message: string, path: string, severity: 'error' | 'warning' = 'error'): ManifestIssue {
  return { code, message, path, severity }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string, issues: ManifestIssue[]): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') {
    issues.push(issue('MANIFEST_FIELD_TYPE', `${key} 必须是字符串`, key))
    return undefined
  }
  return value
}

function readBoolean(record: Record<string, unknown>, key: string, path: string, issues: ManifestIssue[]): boolean | undefined {
  const value = record[key]
  if (typeof value !== 'boolean') {
    issues.push(issue('MANIFEST_FIELD_TYPE', `${path} 必须是布尔值`, path))
    return undefined
  }
  return value
}

export function validateManifest(value: unknown): ValidationResult {
  const issues: ManifestIssue[] = []
  if (!isRecord(value)) {
    return { issues: [issue('MANIFEST_ROOT_TYPE', 'Frontmatter 必须是对象', '$')] }
  }

  for (const key of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(key)) {
      issues.push(issue('MANIFEST_UNKNOWN_FIELD', `未知字段 ${key} 将被忽略`, key, 'warning'))
    }
  }

  const schemaVersion = value.schema_version
  if (schemaVersion !== 1) issues.push(issue('MANIFEST_SCHEMA_UNSUPPORTED', 'schema_version 当前必须为 1', 'schema_version'))

  const name = readString(value, 'name', issues)
  if (name && !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/.test(name)) {
    issues.push(issue('MANIFEST_NAME_INVALID', 'name 必须为 3–64 位小写字母、数字或连字符', 'name'))
  }

  const displayName = readString(value, 'display_name', issues)
  if (displayName && (displayName.length < 2 || displayName.length > 40)) {
    issues.push(issue('MANIFEST_DISPLAY_NAME_LENGTH', 'display_name 必须为 2–40 个字符', 'display_name'))
  }

  const description = readString(value, 'description', issues)
  if (description && (description.length < 20 || description.length > 200)) {
    issues.push(issue('MANIFEST_DESCRIPTION_LENGTH', 'description 必须为 20–200 个字符', 'description'))
  }

  const version = readString(value, 'version', issues)
  if (version && !isValidMarketplaceVersion(version)) {
    issues.push(issue('MANIFEST_VERSION_INVALID', 'version 必须是合法 Semantic Version', 'version'))
  }

  const authorValue = value.author
  let author: SkillManifestV1['author'] | undefined
  if (!isRecord(authorValue)) {
    issues.push(issue('MANIFEST_FIELD_TYPE', 'author 必须是对象', 'author'))
  } else {
    const handle = readString(authorValue, 'handle', issues)
    const authorName = readString(authorValue, 'name', issues)
    if (handle && !/^(?=.{2,39}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])$/.test(handle)) {
      issues.push(issue('MANIFEST_AUTHOR_HANDLE_INVALID', 'author.handle 必须为 2–39 位且不含 @', 'author.handle'))
    }
    if (handle && authorName) author = { handle, name: authorName }
  }

  const categoryValue = readString(value, 'category', issues)
  const category = MARKETPLACE_CATEGORIES.includes(categoryValue as MarketplaceCategorySlug)
    ? categoryValue as MarketplaceCategorySlug
    : undefined
  if (categoryValue && !category) issues.push(issue('MANIFEST_CATEGORY_INVALID', 'category 不在允许列表中', 'category'))

  const license = readString(value, 'license', issues)

  const permissionsValue = value.permissions
  let permissions: SkillManifestV1['permissions'] | undefined
  if (!isRecord(permissionsValue)) {
    issues.push(issue('MANIFEST_FIELD_TYPE', 'permissions 必须是对象', 'permissions'))
  } else {
    const network = readBoolean(permissionsValue, 'network', 'permissions.network', issues)
    const shell = readBoolean(permissionsValue, 'shell', 'permissions.shell', issues)
    const filesystemValue = permissionsValue.filesystem
    if (!isRecord(filesystemValue)) {
      issues.push(issue('MANIFEST_FIELD_TYPE', 'permissions.filesystem 必须是对象', 'permissions.filesystem'))
    } else {
      const read = readBoolean(filesystemValue, 'read', 'permissions.filesystem.read', issues)
      const write = filesystemValue.write
      if (write !== 'none' && write !== 'output-only' && write !== 'workspace') {
        issues.push(issue('MANIFEST_PERMISSION_INVALID', 'filesystem.write 必须为 none、output-only 或 workspace', 'permissions.filesystem.write'))
      } else if (network !== undefined && shell !== undefined && read !== undefined) {
        permissions = { network, shell, filesystem: { read, write } }
      }
    }
  }

  const tags = validateStringArray(value.tags, 'tags', 8, 20, issues)
  const triggerKeywords = validateStringArray(value.trigger_keywords, 'trigger_keywords', 12, 40, issues)

  if (issues.some((item) => item.severity === 'error')) return { issues }
  if (!name || !displayName || !description || !version || !author || !category || !license || !permissions) return { issues }

  return {
    manifest: {
      schema_version: 1,
      name,
      display_name: displayName,
      description,
      version,
      author,
      category,
      license,
      permissions,
      ...(tags ? { tags } : {}),
      ...(typeof value.icon === 'string' ? { icon: value.icon } : {}),
      ...(triggerKeywords ? { trigger_keywords: triggerKeywords } : {}),
      ...(typeof value.homepage === 'string' ? { homepage: value.homepage } : {}),
      ...(typeof value.repository === 'string' ? { repository: value.repository } : {}),
      ...(typeof value.documentation === 'string' ? { documentation: value.documentation } : {}),
      ...(typeof value.deprecated === 'boolean' ? { deprecated: value.deprecated } : {}),
      ...(typeof value.replacement === 'string' ? { replacement: value.replacement } : {}),
    },
    issues,
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
  issues: ManifestIssue[],
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    issues.push(issue('MANIFEST_FIELD_TYPE', `${path} 必须是字符串数组`, path))
    return undefined
  }
  if (value.length > maxItems) issues.push(issue('MANIFEST_ARRAY_LENGTH', `${path} 最多包含 ${maxItems} 项`, path))
  if (value.some((item) => item.length === 0 || item.length > maxLength)) {
    issues.push(issue('MANIFEST_ITEM_LENGTH', `${path} 的每项必须为 1–${maxLength} 个字符`, path))
  }
  return value
}
