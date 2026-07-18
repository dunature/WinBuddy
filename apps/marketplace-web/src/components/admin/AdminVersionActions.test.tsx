import { expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarketplaceAdminVersion } from '@proma/shared'
import { AdminVersionActions } from './AdminVersionActions'

test('Given 服务端动作与状态名不一致 When 渲染版本动作 Then 只服从 allowedActions 和 nextAction', () => {
  const version: MarketplaceAdminVersion = {
    id: 'version-1',
    skillId: 'skill-1',
    version: '1.0.0',
    changelog: '',
    status: 'archived',
    allowedActions: ['approve', 'reject'],
    nextAction: 'approve',
    revision: 1,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  }
  const html = renderToStaticMarkup(
    <Provider store={createStore()}>
      <AdminVersionActions
        skillId="skill-1"
        version={version}
        csrfToken="csrf"
        onCompleted={() => undefined}
      />
    </Provider>,
  )

  expect(html).toContain('批准版本')
  expect(html).toContain('驳回')
  expect(html).not.toContain('归档')
})
