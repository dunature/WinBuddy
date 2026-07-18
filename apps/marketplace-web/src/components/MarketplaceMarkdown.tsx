import * as React from 'react'
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ImageOff } from 'lucide-react'

export interface MarketplaceMarkdownProps {
  content: string
}

function safeHttpsHref(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function MarketplaceMarkdown({ content }: MarketplaceMarkdownProps): React.ReactElement {
  const sanitized = React.useMemo(
    () => DOMPurify.sanitize(content, { ALLOWED_TAGS: [] }),
    [content],
  )

  return (
    <div className="marketplace-prose prose max-w-none prose-headings:font-display prose-headings:tracking-tight prose-a:text-[var(--blue)] prose-code:text-[var(--accent)] prose-pre:bg-[var(--ink)] prose-pre:text-[var(--paper)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          a: ({ href, children }) => {
            const safeHref = safeHttpsHref(href)
            return safeHref ? (
              <a href={safeHref} target="_blank" rel="noreferrer">{children}</a>
            ) : (
              <span title="不受信链接已阻止" className="text-[var(--muted)] underline decoration-dotted">{children}</span>
            )
          },
          img: ({ alt }) => (
            <span className="my-4 flex items-center gap-2 rounded-xl bg-[var(--ink)]/[0.055] px-3 py-2 text-xs text-[var(--muted)]">
              <ImageOff size={15} /> 远程图片已阻止{alt ? `：${alt}` : ''}
            </span>
          ),
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  )
}
