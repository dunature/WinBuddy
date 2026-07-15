import { useEffect } from 'react'
import { useStore } from 'jotai'
import { toast } from 'sonner'
import type { MarketplaceInstallState } from '@proma/shared'
import { marketplaceInstallStatesAtom } from '@/atoms/marketplace'

/** 全局挂载，保证安装任务切换页面后仍继续接收进度。 */
export function useGlobalMarketplaceInstallListeners(): void {
  const store = useStore()
  useEffect(() => window.electronAPI.onMarketplaceInstallProgress((state: MarketplaceInstallState) => {
    const next = new Map(store.get(marketplaceInstallStatesAtom))
    next.set(state.installId, state)
    store.set(marketplaceInstallStatesAtom, next)
    if (state.status === 'success') toast.success(`Skill ${state.slug} 安装成功`)
    if (state.status === 'error') toast.error('Skill 安装失败', { description: state.error.message })
  }), [store])
}
