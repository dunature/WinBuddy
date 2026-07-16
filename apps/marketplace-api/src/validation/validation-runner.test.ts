import { describe, expect, test } from 'bun:test'
import AdmZip from 'adm-zip'
import { validateSubmissionPackage } from './validation-runner.ts'

const VALID_SKILL = `---
schema_version: 1
name: test-skill
display_name: 测试 Skill
description: 用于验证市场上传校验流程的完整测试 Skill 内容。
version: 1.0.0
author:
  handle: proma-editor
  name: Proma 编辑部
category: productivity
license: MIT
permissions:
  network: false
  shell: false
  filesystem:
    read: false
    write: none
---
# 测试 Skill
` 

describe('MarketplaceValidationRunner', () => {
  test('解析合法包并持久化可预览内容', async () => {
    const zip = new AdmZip()
    zip.addFile('SKILL.md', Buffer.from(VALID_SKILL))
    zip.addFile('examples/basic.json', Buffer.from(JSON.stringify({ title: '基础案例' })))
    const result = await validateSubmissionPackage(zip.toBuffer())
    expect(result.manifest?.name).toBe('test-skill')
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0)
    expect(result.examples).toHaveLength(1)
  })

  test('拒绝缺少 SKILL.md 的包', async () => {
    const zip = new AdmZip()
    zip.addFile('README.md', Buffer.from('# missing'))
    const result = await validateSubmissionPackage(zip.toBuffer())
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MANIFEST_MISSING' }))
  })
})
