import * as React from 'react'
import { FileText, Folder, FolderOpen } from 'lucide-react'
import type { MarketplaceFileNode } from '@proma/shared'

export interface SkillFileTreeProps {
  nodes: MarketplaceFileNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function SkillFileTree({ nodes, selectedPath, onSelect }: SkillFileTreeProps): React.ReactElement {
  return (
    <div className="space-y-1">
      {nodes.map((node) => node.type === 'directory' ? (
        <details key={node.path} open className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium hover:bg-white/70">
            <Folder className="group-open:hidden" size={16} />
            <FolderOpen className="hidden group-open:block" size={16} />
            <span className="truncate">{node.name}</span>
          </summary>
          <div className="ml-4 border-l border-[color:var(--ink)]/10 pl-2">
            <SkillFileTree nodes={node.children ?? []} selectedPath={selectedPath} onSelect={onSelect} />
          </div>
        </details>
      ) : (
        <button
          key={node.path}
          type="button"
          onClick={() => onSelect(node.path)}
          className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition ${
            selectedPath === node.path ? 'bg-[var(--ink)] text-[var(--paper)]' : 'hover:bg-white/70'
          }`}
        >
          <FileText size={15} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className={`text-[10px] ${selectedPath === node.path ? 'text-white/60' : 'text-[var(--muted)]'}`}>
            {formatBytes(node.size)}
          </span>
        </button>
      ))}
    </div>
  )
}

export { formatBytes }
