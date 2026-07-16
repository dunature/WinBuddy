import { useAtomValue } from 'jotai'
import { adminSessionAtom } from '../atoms/admin-auth.ts'

export function AdminHomePage(): React.ReactElement {
  const session = useAtomValue(adminSessionAtom)
  return <main className="mx-auto max-w-6xl px-6 py-16"><p className="text-sm text-accent">MARKETPLACE ADMIN</p><h1 className="mt-3 text-4xl font-semibold">欢迎回来，{session?.user?.displayName}</h1><p className="mt-4 text-muted">管理上传、审核和发布流程。</p></main>
}
