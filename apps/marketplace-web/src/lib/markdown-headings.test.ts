import { describe, expect, test } from 'bun:test'
import { extractGuideHeadings } from './markdown-headings.ts'

describe('extractGuideHeadings', () => {
  test('为重复中英文标题生成稳定锚点', () => {
    expect(extractGuideHeadings('## 工作流程\n### 检索 Sources\n## 工作流程')).toEqual([
      { depth: 2, text: '工作流程', id: '工作流程' },
      { depth: 3, text: '检索 Sources', id: '检索-sources' },
      { depth: 2, text: '工作流程', id: '工作流程-2' },
    ])
  })

  test('忽略代码块内的伪标题', () => {
    expect(extractGuideHeadings('```md\n## not heading\n```\n## Real')).toEqual([
      { depth: 2, text: 'Real', id: 'real' },
    ])
  })
})
