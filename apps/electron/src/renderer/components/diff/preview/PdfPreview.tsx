import * as React from 'react'

interface PdfPreviewProps {
  src: string
  title: string
  onZoomChange?: (zoom: number) => void
}

function isZoomMessage(value: unknown): value is { type: 'pdf-zoom-changed'; zoom: number } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'pdf-zoom-changed' &&
    typeof (value as { zoom?: unknown }).zoom === 'number',
  )
}

export function PdfPreview({ src, title, onZoomChange }: PdfPreviewProps): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!isZoomMessage(event.data)) return
      onZoomChange?.(event.data.zoom)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onZoomChange])

  return (
    <iframe
      ref={iframeRef}
      src={src}
      className="h-full w-full border-0"
      title={title}
    />
  )
}
