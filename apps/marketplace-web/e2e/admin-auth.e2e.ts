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
  await expect(page.getByRole('heading', { name: '发布控制台' })).toBeVisible()
  await expect(page.getByText('admin', { exact: true })).toBeVisible()

  await page.waitForTimeout(5_100)
  await page.reload()
  await expect(page).toHaveURL(/\/admin\/login$/)
  await expect(page.getByRole('alert')).toContainText('会话已失效，请重新登录')
})
