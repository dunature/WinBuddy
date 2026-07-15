import { describe, expect, test } from 'bun:test'
import { parseSkillManifest } from './parser.ts'

const VALID_MANIFEST = `---
schema_version: 1
name: deep-research
display_name: 深度研究
description: 执行多来源研究并生成可追溯的结构化报告，适合复杂分析任务
version: 1.0.0-beta.1
author:
  handle: lin-research
  name: Lin Research
category: research
tags:
  - 研究
  - 事实核查
license: MIT
permissions:
  network: true
  filesystem:
    read: true
    write: output-only
  shell: false
---
# 深度研究

正文内容。`

describe('parseSkillManifest', () => {
  test('解析合法、多语言和 prerelease manifest', () => {
    const result = parseSkillManifest(`\uFEFF${VALID_MANIFEST}`)
    expect(result.issues).toEqual([])
    expect(result.manifest?.name).toBe('deep-research')
    expect(result.manifest?.version).toBe('1.0.0-beta.1')
    expect(result.body).toContain('# 深度研究')
  })

  test('支持 block scalar', () => {
    const result = parseSkillManifest(VALID_MANIFEST.replace(
      'description: 执行多来源研究并生成可追溯的结构化报告，适合复杂分析任务',
      'description: >-\n  执行多来源研究并生成可追溯的结构化报告，\n  适合复杂分析任务',
    ))
    expect(result.manifest?.description).toContain('适合复杂分析任务')
  })

  test('缺少 frontmatter 时返回稳定错误码', () => {
    const result = parseSkillManifest('# 只有正文')
    expect(result.issues[0]?.code).toBe('MANIFEST_FRONTMATTER_MISSING')
  })

  test('非法 YAML 返回行列', () => {
    const result = parseSkillManifest('---\nname: [broken\n---\nbody')
    expect(result.issues[0]?.code).toBe('MANIFEST_YAML_INVALID')
    expect(result.issues[0]?.line).toBeGreaterThan(0)
    expect(result.issues[0]?.column).toBeGreaterThan(0)
  })

  test('校验字段路径并容忍未知字段', () => {
    const result = parseSkillManifest(VALID_MANIFEST
      .replace('name: deep-research', 'name: Deep Research')
      .replace('category: research', 'category: unknown')
      .replace('schema_version: 1', 'schema_version: 1\nfuture_field: enabled'))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MANIFEST_NAME_INVALID', path: 'name' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MANIFEST_CATEGORY_INVALID', path: 'category' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MANIFEST_UNKNOWN_FIELD', severity: 'warning' }))
    expect(result.manifest).toBeUndefined()
  })
})
