import * as React from 'react'
import { History } from 'lucide-react'
import type { MarketplaceVersionSummary } from '@proma/shared'

export interface MarketplaceVersionHistoryProps {
  versions: MarketplaceVersionSummary[]
  latestVersion: string
  onSelect: (version: string) => void
}

export function MarketplaceVersionHistory({
  versions,
  latestVersion,
  onSelect,
}: MarketplaceVersionHistoryProps): React.ReactElement {
  return (
    <div className="space-y-3">
      {versions.map((version) => {
        const isLatest = version.version === latestVersion
        return (
          <button
            key={version.version}
            type="button"
            onClick={() => onSelect(version.version)}
            className="flex w-full gap-4 rounded-xl bg-muted/40 p-4 text-left transition hover:bg-muted/65"
          >
            <span className="mt-0.5 rounded-lg bg-background p-2 shadow-sm"><History size={16} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium">
                  v{version.version}
                  <span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                    {isLatest ? '当前版本' : '非最新版本'}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(version.publishedAt).toLocaleDateString('zh-CN')}
                </span>
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{version.changelog}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
