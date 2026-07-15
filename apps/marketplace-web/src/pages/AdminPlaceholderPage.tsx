import { LockKeyhole } from 'lucide-react'

export function AdminPlaceholderPage(): React.ReactElement {
  return (
    <section className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center px-6 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-panel shadow-card"><LockKeyhole size={20} /></span>
        <h1 className="mt-5 text-2xl font-semibold">管理端尚未开放</h1>
        <p className="mt-3 leading-7 text-muted">M0–M2 仅建立受保护路由边界，上传、审核和发布将在后续里程碑实现。</p>
      </div>
    </section>
  )
}
