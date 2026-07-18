import { Hono } from 'hono'
import { MARKETPLACE_SKILL_STATUSES, isMarketplaceIdentifier, isMarketplaceSemVer } from '@proma/marketplace-domain'
import {
  MarketplaceAdminDraftError,
  createMarketplaceAdminSkill,
  createMarketplaceAdminVersion,
  deleteMarketplaceAdminSkill,
  getMarketplaceAdminVersion,
  getMarketplaceAdminSkill,
  listMarketplaceAdminSkills,
  updateMarketplaceAdminSkill,
  updateMarketplaceAdminVersion,
  type CreateMarketplaceAdminSkillInput,
  type CreateMarketplaceAdminVersionInput,
  type UpdateMarketplaceAdminSkillInput,
  type UpdateMarketplaceAdminVersionInput,
} from './admin-drafts'
import type { MarketplaceAppEnv } from './app'
import type { MarketplaceDatabase } from './database/client'

function invalidRequest(message: string): MarketplaceAdminDraftError {
  return new MarketplaceAdminDraftError('INVALID_REQUEST', message, 400)
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string {
  const value = source[key]
  if (typeof value !== 'string' || !value.trim()) throw invalidRequest(`${label}不能为空`)
  const normalized = value.trim()
  if (normalized.length > maxLength) throw invalidRequest(`${label}不能超过 ${maxLength} 个字符`)
  return normalized
}

function parseCreateSkillBody(body: unknown): CreateMarketplaceAdminSkillInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalidRequest('请求体格式不正确')
  const source = body as Record<string, unknown>
  const identifier = requiredString(source, 'identifier', 'identifier', 64)
  if (!isMarketplaceIdentifier(identifier)) {
    throw invalidRequest('identifier 仅允许小写字母、数字和单个短横线，且必须以字母开头')
  }
  const rawTags = source.tags ?? []
  if (!Array.isArray(rawTags) || rawTags.length > 20
    || rawTags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 32)) {
    throw invalidRequest('标签必须是最多 20 个、每项不超过 32 个字符的非空字符串')
  }
  const tags = [...new Set(rawTags.map((tag) => (tag as string).trim()))]
  const authorUrlValue = source.authorUrl
  let authorUrl: string | undefined
  if (authorUrlValue !== undefined && authorUrlValue !== null && authorUrlValue !== '') {
    if (typeof authorUrlValue !== 'string') throw invalidRequest('作者链接格式不正确')
    try {
      const parsed = new URL(authorUrlValue)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
      authorUrl = parsed.toString()
    } catch {
      throw invalidRequest('作者链接必须是 HTTP(S) URL')
    }
  }
  if (source.featured !== undefined && typeof source.featured !== 'boolean') {
    throw invalidRequest('精选状态必须是 boolean')
  }
  return {
    identifier,
    name: requiredString(source, 'name', '名称', 100),
    tagline: requiredString(source, 'tagline', '简介', 160),
    description: requiredString(source, 'description', '描述', 10_000),
    authorName: requiredString(source, 'authorName', '作者名称', 100),
    ...(authorUrl ? { authorUrl } : {}),
    categoryId: requiredString(source, 'categoryId', '分类', 100),
    tags,
    icon: requiredString(source, 'icon', '图标', 200),
    featured: source.featured ?? false,
  }
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string | undefined {
  if (!(key in source)) return undefined
  return requiredString(source, key, label, maxLength)
}

function parseUpdateSkillBody(body: unknown): UpdateMarketplaceAdminSkillInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalidRequest('请求体格式不正确')
  const source = body as Record<string, unknown>
  if (!Number.isInteger(source.revision) || (source.revision as number) < 1) {
    throw invalidRequest('revision 必须是正整数')
  }
  const identifier = optionalString(source, 'identifier', 'identifier', 64)
  if (identifier && !isMarketplaceIdentifier(identifier)) {
    throw invalidRequest('identifier 仅允许小写字母、数字和单个短横线，且必须以字母开头')
  }
  let tags: string[] | undefined
  if ('tags' in source) {
    if (!Array.isArray(source.tags) || source.tags.length > 20
      || source.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 32)) {
      throw invalidRequest('标签必须是最多 20 个、每项不超过 32 个字符的非空字符串')
    }
    tags = [...new Set(source.tags.map((tag) => (tag as string).trim()))]
  }
  let authorUrl: string | null | undefined
  if ('authorUrl' in source) {
    if (source.authorUrl === null || source.authorUrl === '') {
      authorUrl = null
    } else if (typeof source.authorUrl === 'string') {
      try {
        const parsed = new URL(source.authorUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
        authorUrl = parsed.toString()
      } catch {
        throw invalidRequest('作者链接必须是 HTTP(S) URL')
      }
    } else {
      throw invalidRequest('作者链接格式不正确')
    }
  }
  if ('featured' in source && typeof source.featured !== 'boolean') {
    throw invalidRequest('精选状态必须是 boolean')
  }
  const name = optionalString(source, 'name', '名称', 100)
  const tagline = optionalString(source, 'tagline', '简介', 160)
  const description = optionalString(source, 'description', '描述', 10_000)
  const authorName = optionalString(source, 'authorName', '作者名称', 100)
  const categoryId = optionalString(source, 'categoryId', '分类', 100)
  const icon = optionalString(source, 'icon', '图标', 200)
  const result: UpdateMarketplaceAdminSkillInput = {
    revision: source.revision as number,
    ...(identifier ? { identifier } : {}),
    ...(name ? { name } : {}),
    ...(tagline ? { tagline } : {}),
    ...(description ? { description } : {}),
    ...(authorName ? { authorName } : {}),
    ...(authorUrl !== undefined ? { authorUrl } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(tags ? { tags } : {}),
    ...(icon ? { icon } : {}),
    ...(typeof source.featured === 'boolean' ? { featured: source.featured } : {}),
  }
  if (Object.keys(result).length === 1) throw invalidRequest('至少提供一个需要更新的字段')
  return result
}

function parseCreateVersionBody(body: unknown): CreateMarketplaceAdminVersionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalidRequest('请求体格式不正确')
  const source = body as Record<string, unknown>
  const version = requiredString(source, 'version', '版本号', 128)
  if (!isMarketplaceSemVer(version)) {
    throw new MarketplaceAdminDraftError('INVALID_SEMVER', '版本号必须是规范的 SemVer 2.0.0', 400)
  }
  const changelog = source.changelog ?? ''
  if (typeof changelog !== 'string' || changelog.length > 10_000) {
    throw invalidRequest('更新说明不能超过 10000 个字符')
  }
  return { version, changelog: changelog.trim() }
}

function parseUpdateVersionBody(body: unknown): UpdateMarketplaceAdminVersionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalidRequest('请求体格式不正确')
  const source = body as Record<string, unknown>
  if (!Number.isInteger(source.revision) || (source.revision as number) < 1) {
    throw invalidRequest('revision 必须是正整数')
  }
  const version = optionalString(source, 'version', '版本号', 128)
  if (version && !isMarketplaceSemVer(version)) {
    throw new MarketplaceAdminDraftError('INVALID_SEMVER', '版本号必须是规范的 SemVer 2.0.0', 400)
  }
  let changelog: string | undefined
  if ('changelog' in source) {
    if (typeof source.changelog !== 'string' || source.changelog.length > 10_000) {
      throw invalidRequest('更新说明不能超过 10000 个字符')
    }
    changelog = source.changelog.trim()
  }
  if (!version && changelog === undefined) throw invalidRequest('至少提供一个需要更新的字段')
  return {
    revision: source.revision as number,
    ...(version ? { version } : {}),
    ...(changelog !== undefined ? { changelog } : {}),
  }
}

function parseRevision(body: unknown): number {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalidRequest('请求体格式不正确')
  const revision = (body as Record<string, unknown>).revision
  if (!Number.isInteger(revision) || (revision as number) < 1) throw invalidRequest('revision 必须是正整数')
  return revision as number
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw invalidRequest('请求体必须是有效 JSON')
  }
}

export function createMarketplaceAdminDraftRouter(database: MarketplaceDatabase): Hono<MarketplaceAppEnv> {
  const router = new Hono<MarketplaceAppEnv>()

  router.get('/skills', async (context) => {
    const status = context.req.query('status')
    if (status && !MARKETPLACE_SKILL_STATUSES.includes(status as typeof MARKETPLACE_SKILL_STATUSES[number])) {
      return context.json({
        error: { code: 'INVALID_SKILL_STATUS', message: 'Skill 状态筛选值无效' },
        requestId: context.get('requestId'),
      }, 400)
    }
    const result = await listMarketplaceAdminSkills(database, {
      page: context.req.query('page'),
      pageSize: context.req.query('pageSize'),
      ...(status ? { status: status as typeof MARKETPLACE_SKILL_STATUSES[number] } : {}),
    })
    return context.json({ data: result.items, page: result.page, requestId: context.get('requestId') })
  })

  router.post('/skills', async (context) => {
    try {
      const skill = await createMarketplaceAdminSkill(
        database,
        parseCreateSkillBody(await readJsonBody(context.req.raw)),
        { actor: context.get('adminSession'), requestId: context.get('requestId') },
      )
      return context.json({ data: skill, requestId: context.get('requestId') }, 201)
    } catch (error) {
      if (!(error instanceof MarketplaceAdminDraftError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.post('/skills/:skillId/versions', async (context) => {
    try {
      const version = await createMarketplaceAdminVersion(
        database,
        context.req.param('skillId'),
        parseCreateVersionBody(await readJsonBody(context.req.raw)),
        { actor: context.get('adminSession'), requestId: context.get('requestId') },
      )
      return context.json({ data: version, requestId: context.get('requestId') }, 201)
    } catch (error) {
      if (!(error instanceof MarketplaceAdminDraftError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.get('/skills/:skillId/versions/:versionId', async (context) => {
    const version = await getMarketplaceAdminVersion(
      database,
      context.req.param('skillId'),
      context.req.param('versionId'),
    )
    if (!version) {
      return context.json({
        error: { code: 'VERSION_NOT_FOUND', message: '候选版本不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: version, requestId: context.get('requestId') })
  })

  router.patch('/skills/:skillId/versions/:versionId', async (context) => {
    try {
      const version = await updateMarketplaceAdminVersion(
        database,
        context.req.param('skillId'),
        context.req.param('versionId'),
        parseUpdateVersionBody(await readJsonBody(context.req.raw)),
        { actor: context.get('adminSession'), requestId: context.get('requestId') },
      )
      return context.json({ data: version, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminDraftError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.get('/skills/:skillId', async (context) => {
    const skill = await getMarketplaceAdminSkill(database, context.req.param('skillId'))
    if (!skill) {
      return context.json({
        error: { code: 'SKILL_NOT_FOUND', message: 'Skill 不存在' },
        requestId: context.get('requestId'),
      }, 404)
    }
    return context.json({ data: skill, requestId: context.get('requestId') })
  })

  router.patch('/skills/:skillId', async (context) => {
    try {
      const skill = await updateMarketplaceAdminSkill(
        database,
        context.req.param('skillId'),
        parseUpdateSkillBody(await readJsonBody(context.req.raw)),
        { actor: context.get('adminSession'), requestId: context.get('requestId') },
      )
      return context.json({ data: skill, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminDraftError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  router.delete('/skills/:skillId', async (context) => {
    try {
      await deleteMarketplaceAdminSkill(
        database,
        context.req.param('skillId'),
        parseRevision(await readJsonBody(context.req.raw)),
        { actor: context.get('adminSession'), requestId: context.get('requestId') },
      )
      return context.json({ data: { deleted: true }, requestId: context.get('requestId') })
    } catch (error) {
      if (!(error instanceof MarketplaceAdminDraftError)) throw error
      return context.json({
        error: { code: error.code, message: error.message },
        requestId: context.get('requestId'),
      }, error.status)
    }
  })

  return router
}
