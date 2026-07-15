import { Sparkles } from 'lucide-react'

export function BrandMark(): React.ReactElement {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-[-0.02em]">
      <span className="grid size-8 place-items-center rounded-lg bg-ink text-white" aria-hidden="true">
        <Sparkles size={17} strokeWidth={1.8} />
      </span>
      <span className="text-lg">Proma</span>
    </span>
  )
}
