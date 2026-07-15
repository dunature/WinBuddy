import * as React from 'react'
import DOMPurify from 'dompurify'
import type { MarkupPreviewResult } from '@proma/shared'
import { cn } from '@/lib/utils'

interface MarkupPreviewProps {
  result: MarkupPreviewResult
  kind: 'html' | 'svg'
  imageUrl?: string
}

function isAllowedLocalUrl(value: string): boolean {
  if (!value || value.startsWith('#')) return true
  if (/^(?:data:|blob:|proma-file:)/i.test(value)) return true
  return !/^[a-z][a-z\d+.-]*:/i.test(value)
}

function buildSandboxDocument(source: string, baseUrl: string): string {
  const sanitized = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form'],
    FORBID_ATTR: ['srcdoc'],
  })
  const doc = new DOMParser().parseFromString(sanitized, 'text/html')

  for (const element of Array.from(doc.querySelectorAll('[src], [href], [poster]'))) {
    for (const attr of ['src', 'href', 'poster']) {
      const value = element.getAttribute(attr)
      if (value && !isAllowedLocalUrl(value)) element.removeAttribute(attr)
    }
  }
  for (const link of Array.from(doc.querySelectorAll('a[href]'))) {
    link.removeAttribute('href')
  }

  const base = doc.createElement('base')
  base.href = baseUrl
  doc.head.prepend(base)

  const csp = doc.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = [
    "default-src 'none'",
    "img-src proma-file: data: blob:",
    "media-src proma-file: data: blob:",
    "font-src proma-file: data:",
    "style-src 'unsafe-inline' proma-file:",
    "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
  doc.head.prepend(csp)

  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`
}

export function MarkupPreview({ result, kind, imageUrl }: MarkupPreviewProps): React.ReactElement {
  const [mode, setMode] = React.useState<'preview' | 'source'>('preview')
  const srcDoc = React.useMemo(() => buildSandboxDocument(result.source, result.baseUrl), [result.baseUrl, result.source])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border/30 bg-background/70 px-3 py-2">
        {(['preview', 'source'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              mode === item && 'bg-muted text-foreground',
            )}
          >
            {item === 'preview' ? '预览' : '源码'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'source' ? (
          <pre className="h-full overflow-auto p-4 font-mono text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
            {result.source}
          </pre>
        ) : kind === 'svg' ? (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            {imageUrl ? <img src={imageUrl} alt="SVG 预览" className="max-h-full max-w-full" /> : null}
          </div>
        ) : (
          <iframe
            title="HTML 预览"
            srcDoc={srcDoc}
            sandbox=""
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  )
}
