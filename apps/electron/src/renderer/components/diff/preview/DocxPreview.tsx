import * as React from 'react'
import DOMPurify from 'dompurify'
import { PreviewErrorState } from './PreviewErrorState'

interface DocxPreviewProps {
  sourceUrl?: string
  fallbackHtml: string
}

export function DocxPreview({ sourceUrl, fallbackHtml }: DocxPreviewProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function renderDocx() {
      if (!sourceUrl || !hostRef.current) {
        setFailed(true)
        return
      }
      try {
        setFailed(false)
        hostRef.current.innerHTML = ''
        const [docxPreview, response] = await Promise.all([
          import('docx-preview'),
          fetch(sourceUrl),
        ])
        if (!response.ok) throw new Error(`DOCX 读取失败: ${response.status}`)
        const buffer = await response.arrayBuffer()
        if (cancelled || !hostRef.current) return
        await docxPreview.renderAsync(buffer, hostRef.current, undefined, {
          className: 'proma-docx',
          inWrapper: true,
          ignoreFonts: false,
          ignoreHeight: false,
          ignoreWidth: false,
          breakPages: true,
        })
      } catch (error) {
        console.warn('[file-preview] docx-preview 渲染失败，使用文本回退:', error)
        if (!cancelled) setFailed(true)
      }
    }
    void renderDocx()
    return () => {
      cancelled = true
    }
  }, [sourceUrl])

  if (failed) {
    const safeHtml = DOMPurify.sanitize(fallbackHtml)
    return safeHtml ? (
      <div
        className="prose prose-sm max-w-none px-4 py-3 dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    ) : (
      <PreviewErrorState message="DOCX 预览失败，且没有可用的文本回退内容" />
    )
  }

  return <div ref={hostRef} className="h-full overflow-auto bg-background px-4 py-3" />
}
