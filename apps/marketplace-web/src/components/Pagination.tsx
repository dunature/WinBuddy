import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

function visiblePages(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const values = new Set([1, totalPages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= totalPages))
  const result: Array<number | 'ellipsis'> = []
  let previous = 0
  for (const value of [...values].sort((left, right) => left - right)) {
    if (previous && value - previous > 1) result.push('ellipsis')
    result.push(value)
    previous = value
  }
  return result
}

export function Pagination({ page, totalPages, onChange }: PaginationProps): React.ReactElement | null {
  if (totalPages <= 1) return null
  return (
    <nav className="mt-10 flex justify-center gap-2" aria-label="市场分页">
      <button className="page-button" type="button" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="上一页"><ChevronLeft size={15} /></button>
      {visiblePages(page, totalPages).map((value, index) => value === 'ellipsis'
        ? <span key={`ellipsis-${index}`} className="grid size-10 place-items-center text-muted">…</span>
        : <button key={value} className={value === page ? 'page-button page-button-active' : 'page-button'} type="button" onClick={() => onChange(value)} aria-current={value === page ? 'page' : undefined}>{value}</button>)}
      <button className="page-button" type="button" disabled={page === totalPages} onClick={() => onChange(page + 1)} aria-label="下一页"><ChevronRight size={15} /></button>
    </nav>
  )
}
