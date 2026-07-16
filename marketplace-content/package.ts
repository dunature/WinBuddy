import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { marketplaceContentCatalog, type MarketplaceContentEntry } from './catalog.ts'

export interface MarketplaceContentPackage {
  slug: string
  directory: string
  zipPath: string
  exampleCount: number
}

export function buildMarketplaceContentPackages(outputDirectory: string): MarketplaceContentPackage[] {
  mkdirSync(outputDirectory, { recursive: true })
  return marketplaceContentCatalog.map((entry) => buildPackage(entry, outputDirectory))
}

function buildPackage(entry: MarketplaceContentEntry, outputDirectory: string): MarketplaceContentPackage {
  const directory = join(outputDirectory, entry.slug)
  const examplesDirectory = join(directory, 'examples')
  mkdirSync(examplesDirectory, { recursive: true })

  const examples = entry.prompts.map((prompt, index) => ({
    id: `${entry.slug}-example-${index + 1}`,
    title: `${entry.name}案例 ${index + 1}`,
    summary: prompt,
    featured: index === 0,
    userRequest: prompt,
    steps: entry.workflow.map((step) => ({ title: step, summary: '按输入材料执行，并保留可验证依据。' })),
    finalOutputMarkdown: `# ${entry.name}结果\n\n输出结论、依据、限制与下一步，不展示隐藏思维链。`,
    assetUrls: [],
  }))

  writeFileSync(join(directory, 'SKILL.md'), buildSkillMarkdown(entry), 'utf8')
  writeFileSync(join(directory, 'CHANGELOG.md'), `# Changelog\n\n## 1.0.0\n\n- 首次发布 ${entry.name}。\n`, 'utf8')
  writeFileSync(join(directory, 'LICENSE'), MIT_LICENSE, 'utf8')
  writeFileSync(join(examplesDirectory, 'examples.json'), `${JSON.stringify(examples, null, 2)}\n`, 'utf8')

  const zipPath = join(outputDirectory, `${entry.slug}.zip`)
  const zip = new AdmZip()
  zip.addLocalFolder(directory)
  zip.writeZip(zipPath)
  return { slug: entry.slug, directory, zipPath, exampleCount: examples.length }
}

function buildSkillMarkdown(entry: MarketplaceContentEntry): string {
  return `---
schema_version: 1
name: ${entry.slug}
display_name: ${entry.name}
description: ${entry.benefit}，适用于需要稳定流程和明确交付标准的任务。
version: 1.0.0
author:
  handle: proma-editor
  name: Proma 编辑部
category: ${entry.category}
license: MIT
permissions:
  network: false
  shell: false
  filesystem:
    read: true
    write: output-only
tags: [${entry.priority.toLowerCase()}, curated]
---
# ${entry.name}

## 适用场景

${entry.benefit}。

## 不适用场景

不得用于绕过授权、伪造来源或处理未获许可的敏感信息。

## 工作流程

${entry.workflow.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## 输出要求

给出结果、依据、限制和下一步，不展示隐藏思维链。
`
}

const MIT_LICENSE = `MIT License

Copyright (c) 2026 Proma

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the conditions of the MIT License.
`

if (import.meta.main) {
  const outputDirectory = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'proma-marketplace-content-')))
  const packages = buildMarketplaceContentPackages(outputDirectory)
  console.log(`已生成 ${packages.length} 个 Marketplace 候选包：${outputDirectory}`)
}
