import { beforeEach, describe, expect, test } from 'bun:test'
import type { MarketplaceSkillDetail } from '@proma/shared'
import { createMarketplaceApp } from '../app.ts'
import { loadMarketplaceApiConfig } from '../config.ts'
import { MemoryMarketplaceObjectStore } from '../object-store/memory-object-store.ts'
import { MemoryMarketplaceRepository, type MemoryMarketplaceData } from '../repository/memory-marketplace-repository.ts'

const SKILL_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const PACKAGE_KEY = 'skills/11111111-1111-4111-8111-111111111111/1.0.0/package.zip'

const skill: MarketplaceSkillDetail = {
  id: SKILL_ID,
  slug: 'deep-research',
  displayName: '深度研究',
  description: '执行多来源研究并生成可追溯的结构化报告',
  author: { id: 'author-1', handle: 'proma-labs', name: 'Proma Labs', official: true },
  category: { slug: 'research', name: '研究与分析', order: 10 },
  tags: ['研究'],
  version: '1.0.0',
  installCount: 1200,
  updatedAt: '2026-07-15T00:00:00.000Z',
  guideMarkdown: '# 深度研究',
  currentVersion: {
    id: 'version-1',
    version: '1.0.0',
    status: 'published',
    sha256: 'abc123',
    packageSize: 3,
    permissions: { network: true, filesystem: { read: true, write: 'output-only' }, shell: false },
    publishedAt: '2026-07-15T00:00:00.000Z',
  },
  versions: [],
  triggerKeywords: ['深度研究'],
}

const data: MemoryMarketplaceData = {
  categories: [{ slug: 'research', name: '研究与分析', order: 10 }],
  skills: [skill, {
    ...skill,
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'community-research',
    displayName: '社区研究',
    author: { ...skill.author, id: 'author-2', handle: 'lin-research', official: false },
    installCount: 10,
  }],
  files: {
    'deep-research@1.0.0': {
      tree: [{ path: 'SKILL.md', name: 'SKILL.md', kind: 'markdown', size: 20 }],
      contents: [{ path: 'SKILL.md', kind: 'markdown', size: 20, content: '# 深度研究', truncated: false }],
    },
  },
  examples: {
    'deep-research@1.0.0': [{
      id: 'example-1',
      title: '市场研究',
      summary: '研究市场趋势',
      featured: true,
      userRequest: '研究 AI Agent 市场',
      steps: [{ title: '定义问题', summary: '确认范围' }],
      finalOutputMarkdown: '# 报告',
      assetUrls: [],
    }],
  },
  packages: [{ skillId: SKILL_ID, slug: 'deep-research', version: '1.0.0', sha256: 'abc123', size: 3, objectKey: PACKAGE_KEY }],
}

const config = loadMarketplaceApiConfig({
  MARKETPLACE_DATABASE_URL: 'postgres://localhost/test',
  MARKETPLACE_OBJECT_BUCKET: 'test-bucket',
  MARKETPLACE_OBJECT_REGION: 'test-region',
  MARKETPLACE_OBJECT_ACCESS_KEY_ID: 'test-access-key',
  MARKETPLACE_OBJECT_SECRET_ACCESS_KEY: 'test-secret-key',
  NODE_ENV: 'test',
})

let repository: MemoryMarketplaceRepository
let objectStore: MemoryMarketplaceObjectStore

beforeEach(async () => {
  repository = new MemoryMarketplaceRepository(data)
  objectStore = new MemoryMarketplaceObjectStore()
  await objectStore.putPackage(PACKAGE_KEY, new Uint8Array([1, 2, 3]))
})

function app() {
  return createMarketplaceApp({
    config,
    services: { repository, objectStore, now: () => new Date('2026-07-15T00:00:00.000Z') },
  })
}

describe('Marketplace public routes', () => {
  test('列表支持 scope、关键词、分类和分页', async () => {
    const response = await app().request('/api/v1/skills?scope=official&query=深度&category=research&page=1&pageSize=1')
    const body = await response.json() as { items: MarketplaceSkillDetail[]; total: number }
    expect(response.status).toBe(200)
    expect(body.items.map((item) => item.slug)).toEqual(['deep-research'])
    expect(body.total).toBe(1)
  })

  test('详情、文件和案例只返回已提供的公开版本', async () => {
    expect((await app().request('/api/v1/skills/deep-research')).status).toBe(200)
    expect((await app().request('/api/v1/skills/deep-research/versions/1.0.0/files')).status).toBe(200)
    expect((await app().request('/api/v1/skills/deep-research/versions/1.0.0/files/content?path=SKILL.md')).status).toBe(200)
    expect((await app().request('/api/v1/skills/deep-research/versions/1.0.0/examples')).status).toBe(200)
    expect((await app().request('/api/v1/skills/missing')).status).toBe(404)
  })

  test('包下载返回短期 URL 且禁止缓存', async () => {
    const response = await app().request('/api/v1/skills/deep-research/versions/1.0.0/package')
    const body = await response.json() as { downloadUrl: string; expiresAt: string }
    expect(body.downloadUrl).toStartWith('memory://')
    expect(body.expiresAt).toBe('2026-07-15T00:05:00.000Z')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  test('安装事件幂等接受', async () => {
    const input = {
      eventId: EVENT_ID,
      skillId: SKILL_ID,
      version: '1.0.0',
      installedAt: '2026-07-15T00:00:00.000Z',
      platform: 'darwin',
      appVersion: '0.14.24',
    }
    const first = await app().request('/api/v1/install-events', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } })
    const duplicate = await app().request('/api/v1/install-events', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } })
    expect(first.status).toBe(201)
    expect(await duplicate.json()).toEqual({ accepted: true, duplicate: true })
  })
})
