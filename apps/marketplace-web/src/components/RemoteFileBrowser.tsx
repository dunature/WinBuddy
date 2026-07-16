import * as React from 'react'
import { ChevronDown, ChevronRight, Copy, File, FileCode2, Folder, Image as ImageIcon } from 'lucide-react'
import type { MarketplaceFileContent, MarketplaceFileNode } from '@proma/shared'
import { marketplaceApi } from '../lib/api-client.ts'
import { MarkdownGuide } from './MarkdownGuide.tsx'
import { safeMarketplaceAssetUrl } from '../lib/safe-url.ts'

interface RemoteFileBrowserProps {
  slug: string
  version: string
}

export function RemoteFileBrowser({ slug, version }: RemoteFileBrowserProps): React.ReactElement {
  const [tree, setTree] = React.useState<MarketplaceFileNode[] | null>(null)
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [content, setContent] = React.useState<MarketplaceFileContent | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    marketplaceApi.listFiles(slug, version, controller.signal).then((items) => {
      setTree(items)
      setSelectedPath(firstPreviewablePath(items))
    }).catch(() => {
      if (!controller.signal.aborted) setError('文件列表加载失败')
    })
    return () => controller.abort()
  }, [slug, version])

  React.useEffect(() => {
    if (!selectedPath) {
      setContent(null)
      return
    }
    const controller = new AbortController()
    setContent(null)
    marketplaceApi.getFile(slug, version, selectedPath, controller.signal)
      .then(setContent)
      .catch(() => {
        if (!controller.signal.aborted) setError('文件内容加载失败')
      })
    return () => controller.abort()
  }, [selectedPath, slug, version])

  if (error) return <BrowserState title="无法加载文件" description={error} />
  if (!tree) return <BrowserState title="正在加载文件" description="正在读取该版本的安全文件索引。" loading />
  if (tree.length === 0) return <BrowserState title="此版本没有可预览文件" description="安装包中未公开文件索引。" />

  return (
    <div className="mt-6 grid min-h-[560px] overflow-hidden rounded-xl border border-line bg-panel shadow-card md:grid-cols-[250px_minmax(0,1fr)]">
      <nav className="border-b border-line bg-[#f8f7f3] p-3 md:border-b-0 md:border-r" aria-label="Skill 文件">
        <FileTree nodes={tree} selectedPath={selectedPath} onSelect={setSelectedPath} />
      </nav>
      <div className="min-w-0">
        {content ? <FilePreview content={content} /> : <BrowserState title="正在加载文件" description={selectedPath ?? ''} loading />}
      </div>
    </div>
  )
}

function FileTree({ nodes, selectedPath, onSelect }: { nodes: MarketplaceFileNode[]; selectedPath: string | null; onSelect: (path: string) => void }): React.ReactElement {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => <FileTreeItem key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} />)}
    </ul>
  )
}

function FileTreeItem({ node, selectedPath, onSelect }: { node: MarketplaceFileNode; selectedPath: string | null; onSelect: (path: string) => void }): React.ReactElement {
  const [open, setOpen] = React.useState(true)
  const isDirectory = node.kind === 'directory'
  return (
    <li>
      <button className={node.path === selectedPath ? 'file-tree-item file-tree-item-active' : 'file-tree-item'} type="button" onClick={() => isDirectory ? setOpen((value) => !value) : onSelect(node.path)} aria-expanded={isDirectory ? open : undefined}>
        {isDirectory ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="size-3.5" />}
        {isDirectory ? <Folder size={15} /> : <FileNodeIcon kind={node.kind} />}
        <span className="truncate">{node.name}</span>
      </button>
      {isDirectory && open && node.children && <div className="ml-4"><FileTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} /></div>}
    </li>
  )
}

function FileNodeIcon({ kind }: { kind: MarketplaceFileNode['kind'] }): React.ReactElement {
  if (kind === 'image') return <ImageIcon size={15} />
  if (kind === 'code' || kind === 'json' || kind === 'yaml') return <FileCode2 size={15} />
  return <File size={15} />
}

function FilePreview({ content }: { content: MarketplaceFileContent }): React.ReactElement {
  const safeAssetUrl = safeMarketplaceAssetUrl(content.assetUrl)
  const copy = (): void => {
    if (content.content) void navigator.clipboard.writeText(content.content)
  }
  return (
    <article>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm">{content.path}</p>
          <p className="mt-1 text-xs text-muted">{formatBytes(content.size)} · {content.kind}{content.truncated ? ' · 已截断' : ''}</p>
        </div>
        {content.content && <button className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" type="button" onClick={copy} aria-label="复制文件内容"><Copy size={15} /></button>}
      </header>
      <div className="max-h-[700px] overflow-auto p-5 sm:p-7">
        {content.kind === 'markdown' && content.content && <MarkdownGuide markdown={content.content} />}
        {(content.kind === 'code' || content.kind === 'json' || content.kind === 'yaml' || content.kind === 'text') && content.content && <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-6 text-[#454239]"><code>{content.content}</code></pre>}
        {content.kind === 'image' && safeAssetUrl && <img className="mx-auto max-h-[560px] max-w-full rounded-lg border border-line" src={safeAssetUrl} alt={content.path} />}
        {(!content.content && !safeAssetUrl) && <BrowserState title="此文件不提供在线预览" description="二进制、超大或受限制文件只展示元信息，内容不会传到浏览器。" />}
      </div>
    </article>
  )
}

function firstPreviewablePath(nodes: MarketplaceFileNode[]): string | null {
  for (const node of nodes) {
    if (node.kind !== 'directory') return node.path
    const child = firstPreviewablePath(node.children ?? [])
    if (child) return child
  }
  return null
}

function BrowserState({ title, description, loading = false }: { title: string; description: string; loading?: boolean }): React.ReactElement {
  return <div className="grid min-h-64 place-items-center p-8 text-center"><div>{loading && <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-line border-t-accent" />}<h3 className="font-semibold">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p></div></div>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
