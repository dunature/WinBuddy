import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SpreadsheetCell, SpreadsheetPreviewResult, SpreadsheetSheetPreview } from '@proma/shared'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpreadsheetPreviewProps {
  result: SpreadsheetPreviewResult
}

const ROW_HEIGHT = 30
const COLUMN_WIDTH = 160
const ROW_HEADER_WIDTH = 52
const HEADER_HEIGHT = 32

function columnNameFromIndex(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function buildCellMap(sheet: SpreadsheetSheetPreview): Map<string, SpreadsheetCell> {
  const map = new Map<string, SpreadsheetCell>()
  for (const cell of sheet.cells) {
    map.set(`${cell.row}:${cell.column}`, cell)
  }
  return map
}

function findCell(sheet: SpreadsheetSheetPreview, query: string): SpreadsheetCell | null {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return null
  return sheet.cells.find((cell) => (
    cell.value.toLowerCase().includes(normalized) ||
    cell.formula?.toLowerCase().includes(normalized)
  )) ?? null
}

export function SpreadsheetPreview({ result }: SpreadsheetPreviewProps): React.ReactElement {
  const [sheetIndex, setSheetIndex] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const parentRef = React.useRef<HTMLDivElement>(null)
  const sheet = result.sheets[sheetIndex] ?? result.sheets[0]
  const cellMap = React.useMemo(() => sheet ? buildCellMap(sheet) : new Map<string, SpreadsheetCell>(), [sheet])
  const rowCount = Math.max(sheet?.rowCount ?? 0, 1)
  const columnCount = Math.max(sheet?.columnCount ?? 0, 1)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => COLUMN_WIDTH,
    overscan: 4,
  })

  const jumpToMatch = React.useCallback(() => {
    if (!sheet) return
    const match = findCell(sheet, query)
    if (!match) return
    rowVirtualizer.scrollToIndex(match.row, { align: 'center' })
    columnVirtualizer.scrollToIndex(match.column, { align: 'center' })
  }, [columnVirtualizer, query, rowVirtualizer, sheet])

  if (!sheet) {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">没有可预览的表格数据</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/30 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {result.sheets.map((item, index) => (
            <button
              key={`${item.name}:${item.index}`}
              type="button"
              onClick={() => setSheetIndex(index)}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                index === sheetIndex && 'bg-muted text-foreground',
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border/40 bg-background px-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jumpToMatch()
            }}
            placeholder="查找单元格"
            className="h-7 w-40 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      {result.notices.length > 0 && (
        <div className="shrink-0 border-b border-border/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          {result.notices.map((notice) => notice.message).join('，')}
        </div>
      )}
      <div ref={parentRef} className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="relative"
          style={{
            width: ROW_HEADER_WIDTH + columnVirtualizer.getTotalSize(),
            height: HEADER_HEIGHT + rowVirtualizer.getTotalSize(),
          }}
        >
          <div className="sticky left-0 top-0 z-30 flex h-8 w-[52px] items-center justify-center border-b border-r border-border/50 bg-muted text-[11px] text-muted-foreground" />
          {columnVirtualizer.getVirtualItems().map((virtualColumn) => (
            <div
              key={virtualColumn.key}
              className="absolute top-0 z-20 flex h-8 items-center border-b border-r border-border/50 bg-muted px-2 text-[11px] font-medium text-muted-foreground"
              style={{
                left: ROW_HEADER_WIDTH + virtualColumn.start,
                width: virtualColumn.size,
              }}
            >
              {columnNameFromIndex(virtualColumn.index)}
            </div>
          ))}
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <React.Fragment key={virtualRow.key}>
              <div
                className="absolute left-0 z-10 flex items-center justify-end border-b border-r border-border/40 bg-muted px-2 text-[11px] text-muted-foreground"
                style={{
                  top: HEADER_HEIGHT + virtualRow.start,
                  width: ROW_HEADER_WIDTH,
                  height: virtualRow.size,
                }}
              >
                {virtualRow.index + 1}
              </div>
              {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
                const cell = cellMap.get(`${virtualRow.index}:${virtualColumn.index}`)
                return (
                  <div
                    key={`${virtualRow.key}:${virtualColumn.key}`}
                    className="absolute overflow-hidden border-b border-r border-border/30 px-2 py-1.5 text-[12px] text-foreground"
                    title={cell?.formula ? `=${cell.formula}\n${cell.value}` : cell?.value}
                    style={{
                      left: ROW_HEADER_WIDTH + virtualColumn.start,
                      top: HEADER_HEIGHT + virtualRow.start,
                      width: virtualColumn.size,
                      height: virtualRow.size,
                    }}
                  >
                    <span className="block truncate">{cell?.value ?? ''}</span>
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
