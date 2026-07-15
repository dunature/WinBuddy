import * as React from 'react'
import type { OfficePreviewResult } from '@proma/shared'
import { PdfPreview } from './PdfPreview'
import { PreviewErrorState } from './PreviewErrorState'

interface PresentationPreviewProps {
  result: OfficePreviewResult | null
  title: string
  onPdfZoomChange?: (zoom: number) => void
}

export function PresentationPreview({ result, title, onPdfZoomChange }: PresentationPreviewProps): React.ReactElement {
  if (!result) {
    return <PreviewErrorState message="无法加载演示文稿预览" />
  }

  if (result.pdf?.tmpHtmlUrl) {
    return <PdfPreview src={result.pdf.tmpHtmlUrl} title={title} onZoomChange={onPdfZoomChange} />
  }

  if (result.html) {
    return (
      <div className="office-preview-host">
        {result.notices?.length ? (
          <div className="office-preview-notice">{result.notices.map((notice) => notice.message).join('，')}</div>
        ) : null}
        <div dangerouslySetInnerHTML={{ __html: result.html }} />
      </div>
    )
  }

  return (
    <PreviewErrorState
      message={result.libreOffice?.available === false
        ? '未检测到 LibreOffice，无法内联预览该 Office 文件'
        : '无法加载 Office 预览'}
    />
  )
}
