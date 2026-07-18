import { expect, test } from '@playwright/test'
import { createZipFixture } from '../../marketplace-api/tests/zip-fixture'

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

  await expect(page.getByText('深度研究助手', { exact: true })).toBeVisible()
  await page.getByLabel('新分类名称').fill('知识  管理')
  await page.getByLabel('新分类图标').fill('library')
  await page.getByRole('button', { name: '创建分类' }).click()
  const taxonomyPanel = page.getByLabel('分类标签管理')
  await expect(taxonomyPanel.getByText('知识 管理', { exact: true })).toBeVisible()
  await page.getByLabel('新标签名称').fill('自动化')
  await page.getByRole('button', { name: '创建标签' }).click()
  await page.getByLabel('编辑标签 自动化').click()
  await page.getByLabel('重命名 自动化').fill('效率自动化')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByLabel('编辑标签 效率自动化')).toBeVisible()

  await page.getByRole('button', { name: '新建 Skill' }).click()
  await page.getByLabel('Identifier').fill('daily-briefing')
  await page.getByLabel('Skill 名称').fill('每日工作简报')
  await page.getByLabel('一句话简介').fill('自动整理每天的工作进展')
  await page.getByLabel('完整描述').fill('汇总工作区中的进展并生成结构化简报。')
  await page.getByLabel('作者', { exact: true }).fill('Proma Labs')
  const skillForm = page.locator('form')
  await skillForm.getByRole('combobox').selectOption({ label: '知识 管理' })
  await skillForm.getByLabel('效率自动化', { exact: true }).check()
  await skillForm.getByLabel('图标', { exact: true }).fill('workflow')
  await page.getByRole('button', { name: '保存草稿' }).click()

  await expect(page.getByText('每日工作简报', { exact: true })).toBeVisible()
  await expect(page.locator('form').getByText('draft', { exact: true })).toBeVisible()
  await page.getByLabel('Skill 名称').fill('每日简报助手')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('每日简报助手', { exact: true })).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('删除分类 知识 管理').click()
  await expect(page.getByRole('alert')).toContainText('引用 1 个 Skill')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('删除标签 效率自动化').click()
  await expect(page.getByRole('alert')).toContainText('标签仍被 Skill 使用')

  await page.getByRole('button', { name: '新建候选版本' }).click()
  await page.getByLabel('版本号').fill('1.0.0')
  await page.getByLabel('更新说明').fill('首个可审核版本。')
  await page.getByRole('button', { name: '保存候选版本' }).click()
  await expect(page.getByText('1.0.0', { exact: true })).toBeVisible()
  await expect(page.getByText('created', { exact: true })).toBeVisible()

  const invalidZip = createZipFixture([{ path: 'daily-briefing/README.md', content: '# 缺少 SKILL.md\n' }])
  await page.getByLabel('Skill ZIP 包 1.0.0').setInputFiles({
    name: 'daily-briefing.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(invalidZip),
  })
  await page.getByRole('button', { name: '上传校验' }).click()
  await expect(page.getByText('校验失败', { exact: true })).toBeVisible()
  await expect(page.getByText(/SKILL_MD_MISSING/)).toBeVisible()

  const validZip = createZipFixture([{
    path: 'daily-briefing/SKILL.md',
    content: '---\nname: daily-briefing\ndescription: 自动生成每日简报\nversion: 1.0.0\n---\n',
  }])
  await page.getByLabel('Skill ZIP 包 1.0.0').setInputFiles({
    name: 'daily-briefing.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(validZip),
  })
  await page.getByRole('button', { name: '重新上传' }).click()
  await expect(page.getByText('校验通过', { exact: true })).toBeVisible()
  await expect(page.getByText(/SKILL_MANIFEST_OK/)).toBeVisible()
  await expect(page.getByText('历史上传记录（1）')).toBeVisible()
  await page.getByText('历史上传记录（1）').click()
  await page.getByText('校验失败', { exact: true }).click()
  await expect(page.getByText(/SKILL_MD_MISSING/)).toBeVisible()

  await page.getByRole('button', { name: '提交审核' }).click()
  await expect(page.getByText('pending_review', { exact: true })).toBeVisible()
  await expect(page.getByText('已提交审核', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '驳回', exact: true }).click()
  await page.getByLabel('驳回原因').fill('需要补充风险说明')
  await page.getByRole('button', { name: '确认驳回' }).click()
  await expect(page.getByText('rejected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回编辑' }).click()
  await page.getByLabel('返回编辑原因').fill('按审核意见修改')
  await page.getByRole('button', { name: '确认返回编辑' }).click()
  await expect(page.getByText('created', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '提交审核' }).click()
  await page.getByRole('button', { name: '批准版本' }).click()
  await expect(page.getByText('approved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤回', exact: true }).click()
  await page.getByLabel('撤回原因').fill('发布前再次检查')
  await page.getByRole('button', { name: '确认撤回' }).click()
  await expect(page.getByText('created', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '提交审核' }).click()
  await page.getByRole('button', { name: '批准版本' }).click()
  await page.getByRole('button', { name: '发布上线' }).click()
  await expect(page.getByText('published', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('版本已发布，公开市场现已可见')).toBeVisible()

  await page.goto('/agent/marketplace/skills/daily-briefing')
  await expect(page.getByRole('heading', { name: '每日简报助手' })).toBeVisible()
  await expect(page.getByText('最新 v1.0.0', { exact: true })).toBeVisible()
  await page.goto('/agent/marketplace/admin')
  await expect(page.getByText('每日简报助手', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新建候选版本' }).click()
  await page.getByLabel('版本号').fill('1.1.0')
  await page.getByLabel('更新说明').fill('用于批量部分失败验证。')
  await page.getByRole('button', { name: '保存候选版本' }).click()
  await page.getByLabel('选择版本 1.0.0').check()
  await page.getByLabel('选择版本 1.1.0').check()
  await page.getByLabel('批量治理原因').fill('批量维护验证')
  await page.getByRole('button', { name: '批量下架' }).click()
  await expect(page.getByText('成功 1 · 跳过 0 · 失败 1')).toBeVisible()
  await expect(page.getByText(/VERSION_ACTION_NOT_ALLOWED/)).toBeVisible()

  const retryRequestPromise = page.waitForRequest((request) => request.url().includes('/bulk-actions/unpublish'))
  await page.getByRole('button', { name: '仅重试失败项' }).click()
  const retryRequest = await retryRequestPromise
  const retryBody = retryRequest.postDataJSON() as { items: Array<{ key: string }> }
  expect(retryBody.items).toHaveLength(1)
  expect(retryBody.items[0]?.key).toContain('version:')
  await expect(page.getByText('成功 0 · 跳过 0 · 失败 1')).toBeVisible()
  await page.getByRole('button', { name: '清空批量选择' }).click()
  await page.getByRole('button', { name: '重新发布' }).click()

  await page.getByRole('button', { name: '下架', exact: true }).click()
  await page.getByLabel('下架原因').fill('临时维护')
  await page.getByRole('button', { name: '确认下架' }).click()
  const governedVersion = page.getByRole('article').filter({ hasText: '1.0.0' })
  await expect(governedVersion.getByText('unpublished', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重新发布' }).click()
  await expect(governedVersion.getByText('published', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下架', exact: true }).click()
  await page.getByLabel('下架原因').fill('停止维护')
  await page.getByRole('button', { name: '确认下架' }).click()
  await governedVersion.getByRole('button', { name: '归档', exact: true }).click()
  await governedVersion.getByLabel('归档原因').fill('版本生命周期结束')
  await governedVersion.getByRole('button', { name: '确认归档' }).click()
  await expect(governedVersion.getByText('archived', { exact: true })).toBeVisible()

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
