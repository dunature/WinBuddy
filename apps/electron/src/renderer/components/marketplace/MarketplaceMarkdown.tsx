import * as React from 'react'
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface MarketplaceMarkdownProps {
  content: string
}

export function MarketplaceMarkdown({ content }: MarketplaceMarkdownProps): React.ReactElement {
  const sanitized = React.useMemo(
    () => DOMPurify.sanitize(content, { ALLOWED_TAGS: [] }),
    [content],
  )

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted/70 prose-pre:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <button
              type="button"
              className="inline cursor-pointer text-primary underline underline-offset-2"
              onClick={() => {
                if (href?.startsWith('https://')) void window.electronAPI.openExternal(href)
              }}
            >
              {children}
            </button>
          ),
          img: ({ alt }) => (
            <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
              远程图片已阻止{alt ? `：${alt}` : ''}
            </span>
          ),
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  )
}
