import type { ReactElement } from 'react'
import type { MarketplaceUpdateFileChange, MarketplaceUpdatePreview } from '@proma/shared'
import { cn } from '@/lib/utils'

interface MarketplaceUpdateSummaryProps {
  preview: MarketplaceUpdatePreview
  changelog: string
}

const changeLabels: Record<MarketplaceUpdateFileChange['kind'], string> = {
  added: '新增',
  modified: '修改',
  removed: '删除',
}

const changeStyles: Record<MarketplaceUpdateFileChange['kind'], string> = {
  added: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  modified: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  removed: 'bg-destructive/10 text-destructive',
}

export function MarketplaceUpdateSummary({
  preview,
  changelog,
}: MarketplaceUpdateSummaryProps): ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-muted/55 px-4 py-3 text-sm">
        <span className="font-medium">v{preview.installedVersion}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-semibold text-primary">v{preview.targetVersion}</span>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground">更新说明</div>
        <p className="mt-1 text-sm leading-6">{changelog || '本版本未提供更新说明。'}</p>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          文件变化（{preview.changes.length}）
        </div>
        {preview.changes.length > 0 ? (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-muted/35 p-2">
            {preview.changes.map((change) => (
              <div key={change.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs">
                <span className={cn('w-9 flex-none rounded px-1.5 py-0.5 text-center font-medium', changeStyles[change.kind])}>
                  {changeLabels[change.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/35 px-3 py-4 text-center text-xs text-muted-foreground">
            文件内容没有变化。
          </div>
        )}
      </div>
    </div>
  )
}
