import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createHeadingSlugger } from '../lib/markdown-headings.ts'
import { safeMarketplaceAssetUrl, safeMarketplaceLink } from '../lib/safe-url.ts'

export function MarkdownGuide({ markdown }: { markdown: string }): React.ReactElement {
  const slug = createHeadingSlugger()
  const components: Components = {
    h1: ({ children }) => <h1 className="mb-6 mt-2 text-3xl font-semibold tracking-[-0.03em]">{children}</h1>,
    h2: ({ children }) => {
      const text = textContent(children)
      return <h2 id={slug(text)} className="scroll-mt-28 border-t border-line pt-9 text-2xl font-semibold tracking-[-0.025em] first:border-0 first:pt-0">{children}</h2>
    },
    h3: ({ children }) => {
      const text = textContent(children)
      return <h3 id={slug(text)} className="scroll-mt-28 text-lg font-semibold">{children}</h3>
    },
    p: ({ children }) => <p className="font-serif text-[17px] leading-8 text-[#555248]">{children}</p>,
    ul: ({ children }) => <ul className="list-disc space-y-2 pl-6 text-[15px] leading-7 text-[#555248]">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-2 pl-6 text-[15px] leading-7 text-[#555248]">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="rounded-r-lg border-l-2 border-accent bg-[#fff0e9] px-5 py-3 text-[#555248]">{children}</blockquote>,
    code: ({ className, children }) => className
      ? <code className={`${className} block overflow-x-auto rounded-xl bg-ink p-5 font-mono text-sm leading-6 text-[#f5f2e9]`}>{children}</code>
      : <code className="rounded bg-[#ece9e1] px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>,
    table: ({ children }) => <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
    th: ({ children }) => <th className="border-b border-line bg-canvas px-4 py-3 font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-b border-line px-4 py-3 last:border-b-0">{children}</td>,
    a: ({ href, children }) => { const safeHref = safeMarketplaceLink(href); return <a className="text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent" href={safeHref} target={safeHref?.startsWith('http') ? '_blank' : undefined} rel={safeHref?.startsWith('http') ? 'noreferrer' : undefined}>{children}</a> },
    img: ({ src, alt }) => { const safeSrc = safeMarketplaceAssetUrl(src); return safeSrc ? <img className="max-w-full rounded-lg border border-line" src={safeSrc} alt={alt ?? ''} loading="lazy" /> : <span>{alt ?? '已阻止不安全图片'}</span> },
  }

  return <div className="guide-content space-y-6"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown></div>
}

function textContent(children: React.ReactNode): string {
  return React.Children.toArray(children).map((child) => typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('')
}
