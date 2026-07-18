import { expect, test } from '@playwright/test'

test('Given 初始管理员 When 登录改密且会话到期 Then 管理路由完成保护与失效恢复', async ({ page }) => {
  await page.goto('/agent/marketplace/admin')

  await expect(page.getByRole('heading', { name: '进入安全控制台' })).toBeVisible()
  await page.getByLabel('管理员用户名').fill('admin')
  await page.getByLabel('管理员密码').fill('initial-password-123')
  await page.getByRole('button', { name: '验证身份' }).click()

  await expect(page).toHaveURL(/\/admin\/change-password$/)
  await expect(page.getByRole('heading', { name: '必须先修改初始密码' })).toBeVisible()
  await page.getByLabel('当前密码').fill('initial-password-123')
  await page.getByLabel('新密码', { exact: true }).fill('updated-password-456')
  await page.getByLabel('确认新密码').fill('updated-password-456')
  await page.getByRole('button', { name: '保存新密码' }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Skill 草稿', exact: true })).toBeVisible()
  await expect(page.getByText('admin', { exact: true })).toBeVisible()

  await expect(page.getByText('还没有 Skill 草稿')).toBeVisible()
  await page.getByRole('button', { name: '新建 Skill' }).click()
  await page.getByLabel('Identifier').fill('daily-briefing')
  await page.getByLabel('Skill 名称').fill('每日工作简报')
  await page.getByLabel('一句话简介').fill('自动整理每天的工作进展')
  await page.getByLabel('完整描述').fill('汇总工作区中的进展并生成结构化简报。')
  await page.getByLabel('作者', { exact: true }).fill('Proma Labs')
  await page.getByLabel('分类').selectOption('automation')
  await page.getByLabel('标签').fill('自动化, 简报')
  await page.getByLabel('图标').fill('workflow')
  await page.getByRole('button', { name: '保存草稿' }).click()

  await expect(page.getByText('每日工作简报', { exact: true })).toBeVisible()
  await expect(page.locator('form').getByText('draft', { exact: true })).toBeVisible()
  await page.getByLabel('Skill 名称').fill('每日简报助手')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('每日简报助手', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新建候选版本' }).click()
  await page.getByLabel('版本号').fill('1.0.0')
  await page.getByLabel('更新说明').fill('首个可审核版本。')
  await page.getByRole('button', { name: '保存候选版本' }).click()
  await expect(page.getByText('1.0.0', { exact: true })).toBeVisible()
  await expect(page.getByText('created', { exact: true })).toBeVisible()

  await page.route('**/api/v1/admin/skills?**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: '测试草稿服务不可用' }, requestId: 'e2e-error' }),
    })
  })
  await page.reload()
  await expect(page.getByText('草稿档案暂时无法读取')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await page.unroute('**/api/v1/admin/skills?**')
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByText('每日简报助手', { exact: true })).toBeVisible()

  await page.request.post('/__e2e__/expire-admin-sessions')
  await page.reload()
  await expect(page).toHaveURL(/\/admin\/login$/)
  await expect(page.getByRole('alert')).toContainText('会话已失效，请重新登录')
})
