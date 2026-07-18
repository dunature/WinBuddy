import { expect, test } from '@playwright/test'

test('Given 公开目录 When 搜索筛选并分页 Then URL 与结果保持一致', async ({ page }) => {
  await page.goto('/agent/marketplace/')

  await expect(page.getByRole('heading', { name: '把可信能力，装进每一次工作' })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索技能' }).fill('研究')
  await expect(page).toHaveURL(/q=%E7%A0%94%E7%A9%B6/)
  await expect(page.getByRole('link', { name: /深度研究助手/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /工作流工具 1/ })).toHaveCount(0)

  await page.getByRole('searchbox', { name: '搜索技能' }).fill('')
  await expect(page).not.toHaveURL(/q=/)
  await page.getByRole('button', { name: '文档创作' }).click()
  await page.getByRole('button', { name: '精选' }).click()
  await expect(page).toHaveURL(/category=docs/)
  await expect(page).toHaveURL(/featured=1/)
  await expect(page.getByRole('link', { name: /工作流工具 10/ })).toBeVisible()

  await page.getByRole('button', { name: '全部' }).click()
  await page.getByRole('button', { name: '精选' }).click()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByText('第 2 / 2 页')).toBeVisible()
})

test('Given Skill 详情深链 When 切换 Tab 与历史版本并刷新 Then 状态和内容可恢复', async ({ page }) => {
  await page.goto('/agent/marketplace/skills/deep-research?tab=files&version=1.1.0')

  await expect(page.getByRole('heading', { name: '深度研究助手' })).toBeVisible()
  await expect(page.getByText('正在查看历史版本 1.1.0')).toBeVisible()
  await expect(page.getByRole('heading', { name: '深度研究助手', level: 1 })).toBeVisible()
  await expect(page.getByText('这是 1.1.0 历史版本。')).toBeVisible()

  await page.getByRole('tab', { name: '版本历史' }).click()
  await expect(page).toHaveURL(/tab=versions/)
  await expect(page.getByText('当前版本', { exact: true })).toBeVisible()
  await expect(page.getByText('非最新版本', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('tab', { name: '版本历史' })).toHaveAttribute('aria-selected', 'true')
})

test('Given 最新 Skill When 浏览 Overview、SKILL.md 和文件 Then 内容安全且选择写入 URL', async ({ page }) => {
  await page.goto('/agent/marketplace/skills/deep-research')

  await expect(page.getByRole('heading', { name: '关于此技能' })).toBeVisible()
  await expect(page.getByText('从公开资料出发，整理证据、结论与引用。')).toBeVisible()

  await page.getByRole('tab', { name: 'SKILL.md' }).click()
  await expect(page).toHaveURL(/tab=skill-md/)
  await expect(page.getByText(/当前版本提供/)).toBeVisible()
  await expect(page.getByText('远程图片已阻止：远程示例')).toBeVisible()
  await expect(page.getByText('globalThis.pwned')).toHaveCount(0)
  await expect(page.locator('main img')).toHaveCount(0)

  await page.getByRole('tab', { name: '文件' }).click()
  await page.getByRole('button', { name: /guide.md/ }).click()
  await expect(page).toHaveURL(/file=references%2Fguide.md/)
  await expect(page.getByRole('heading', { name: '引用指南' })).toBeVisible()
})

test('Given 慢速与空结果 When 浏览目录 Then 展示 loading 和 empty 状态', async ({ page }) => {
  await page.route('**/api/v1/marketplace/skills?**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 450))
    await route.continue()
  })

  await page.goto('/agent/marketplace/?q=definitely-no-match')
  await expect(page.getByLabel('正在加载技能')).toBeVisible()
  await expect(page.getByRole('heading', { name: '没有找到匹配的技能' })).toBeVisible()
})

test('Given 目录 API 断网 When 打开市场 Then 显示离线状态和重试入口', async ({ page }) => {
  await page.route('**/api/v1/marketplace/skills?**', (route) => route.abort('internetdisconnected'))
  await page.goto('/agent/marketplace/')

  await expect(page.getByRole('alert')).toContainText('当前处于离线状态')
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
})

test('Given 不存在的 identifier When 打开详情 Then 显示可恢复的 404 状态', async ({ page }) => {
  await page.goto('/agent/marketplace/skills/not-found')

  await expect(page.getByRole('heading', { name: '找不到这个技能' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回技能市场' })).toHaveAttribute('href', '/agent/marketplace/')
})
