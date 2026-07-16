import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownGuide } from './MarkdownGuide.tsx'

describe('Marketplace Markdown 安全渲染', () => {
  test('脚本 HTML 与危险链接不会进入可执行属性', () => {
    const html = renderToStaticMarkup(<MarkdownGuide markdown={'<script>alert(1)</script>\n\n[点击](javascript:alert(1))\n\n![图片](data:text/html,bad)'} />)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:text/html')
  })
})
