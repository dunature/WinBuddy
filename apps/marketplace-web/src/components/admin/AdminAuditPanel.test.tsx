import { expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { adminAuditQueryAtom, adminAuditStateAtom } from '../../admin-audit-state'
import { AdminAuditPanel } from './AdminAuditPanel'

test('Given 筛选后没有审计 When 渲染审计视图 Then 保留筛选并显示可恢复空态', () => {
  const store = createStore()
  store.set(adminAuditQueryAtom, {
    skillId: '', actor: 'admin', action: 'skill.updated', from: '', to: '', page: 1, pageSize: 16,
  })
  store.set(adminAuditStateAtom, {
    status: 'ready',
    result: { items: [], page: { number: 1, size: 16, total: 0, pages: 1 } },
    error: null,
  })

  const html = renderToStaticMarkup(
    <Provider store={store}><AdminAuditPanel skills={[]} /></Provider>,
  )

  expect(html).toContain('审计日志')
  expect(html).toContain('value="admin"')
  expect(html).toContain('value="skill.updated"')
  expect(html).toContain('当前筛选下没有审计记录')
})

test('Given 审计请求失败 When 渲染审计视图 Then 显示原筛选和重试入口', () => {
  const store = createStore()
  store.set(adminAuditStateAtom, { status: 'error', result: null, error: '审计服务不可用' })
  const html = renderToStaticMarkup(
    <Provider store={store}><AdminAuditPanel skills={[]} /></Provider>,
  )
  expect(html).toContain('审计服务不可用')
  expect(html).toContain('重试')
})
