import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SkillMeta } from '@proma/shared'
import { SkillCard } from './SkillCard'

test('Given an installed marketplace Skill, When rendering the installed list card, Then shows source version and enabled state', () => {
  const skill: SkillMeta = {
    slug: 'research',
    name: '研究助手',
    enabled: true,
    importSource: {
      kind: 'marketplace',
      marketplaceSkillId: 'marketplace-1',
      identifier: 'research',
      installedVersion: '1.2.3',
      contentHash: 'trusted-hash',
      installedAt: '2026-07-18T00:00:00.000Z',
    },
  }

  const html = renderToStaticMarkup(
    <SkillCard
      skill={skill}
      isBuiltin={false}
      updating={false}
      onOpen={() => undefined}
      onToggle={() => undefined}
      onUpdate={() => undefined}
    />,
  )

  expect(html).toContain('技能市场 · v1.2.3')
  expect(html).toContain('aria-checked="true"')
})
