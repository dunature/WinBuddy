import { atom } from 'jotai'
import type { MarketplaceAvailableUpdate, MarketplaceInstallState, MarketplaceScope, MarketplaceSort } from '@proma/shared'

export type MarketplaceDetailTab = 'guide' | 'files' | 'examples'

export const marketplaceQueryAtom = atom('')
export const marketplaceScopeAtom = atom<MarketplaceScope>('all')
export const marketplaceCategoryAtom = atom<string | undefined>(undefined)
export const marketplaceSortAtom = atom<MarketplaceSort>('popular')
export const marketplaceSelectedSlugAtom = atom<string | null>(null)
export const marketplaceDetailTabAtom = atom<MarketplaceDetailTab>('guide')
export const marketplaceSelectedFileAtom = atom<string | null>(null)
export const marketplaceSelectedExampleAtom = atom<string | null>(null)
export const marketplacePendingInstallSlugAtom = atom<string | null>(null)
export const marketplaceActiveInstallIdAtom = atom<string | null>(null)
export const marketplaceInstallStatesAtom = atom<Map<string, MarketplaceInstallState>>(new Map())
export const marketplaceAvailableUpdatesAtom = atom<MarketplaceAvailableUpdate[]>([])
