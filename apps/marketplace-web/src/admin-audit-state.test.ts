import { expect, test } from 'bun:test'
import type { MarketplaceAdminAuditQuery } from '@proma/shared'
import { buildAdminAuditSearch } from './admin-audit-state'

test('Given 审计筛选含空白和日期 When 构造查询 Then 去除空值并保留分页与边界', () => {
  const query: MarketplaceAdminAuditQuery = {
    skillId: ' skill-a ', actor: ' admin ', action: '',
    from: '2026-07-18T00:00:00.000Z', to: '2026-07-19T00:00:00.000Z',
    page: 2, pageSize: 20,
  }
  expect(buildAdminAuditSearch(query).toString()).toBe(
    'page=2&pageSize=20&skillId=skill-a&actor=admin&from=2026-07-18T00%3A00%3A00.000Z&to=2026-07-19T00%3A00%3A00.000Z',
  )
})
