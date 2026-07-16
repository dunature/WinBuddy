import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import type { MarketplaceSkillSummary } from '@proma/shared'
import { SkillCard } from './SkillCard'

const skill: MarketplaceSkillSummary = {
  id: 'skill-1',
  slug: 'deep-research',
  displayName: '深度研究',
  description: '基于来源完成结构化研究。',
  author: { id: 'author-1', handle: 'proma-editor', name: 'Proma 编辑部', official: true },
  category: { slug: 'research', name: '研究', order: 1 },
  tags: ['research'],
  version: '1.0.0',
  installCount: 12,
  updatedAt: '2026-07-16T00:00:00.000Z',
}

describe('Marketplace Skill 卡片', () => {
  test('展示独立作者 handle，并提供可访问链接名称', () => {
    const html = renderToStaticMarkup(<StaticRouter location="/"><SkillCard skill={skill} /></StaticRouter>)

    expect(html).toContain('@proma-editor')
    expect(html).toContain('aria-label="查看 深度研究"')
  })
})
