import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MemoryRouter, Route, Routes } from 'react-router'
import { marketplaceStateAtom } from '@/atoms/marketplace-atoms'
import { createMarketplaceMemoryEntries } from '@/atoms/marketplace-route'
import { MarketplaceCatalogPage } from './MarketplaceCatalogPage'
import { MarketplaceSkillDetailPage } from './MarketplaceSkillDetailPage'

export function MarketplaceView(): React.ReactElement {
  const state = useAtomValue(marketplaceStateAtom)
  const [initialEntries] = React.useState(() => createMarketplaceMemoryEntries(
    {
      query: state.query,
      category: state.category,
      featured: state.featured,
      sort: state.sort,
      page: state.page,
    },
    state.selectedIdentifier
      ? {
          identifier: state.selectedIdentifier,
          route: {
            tab: state.selectedTab,
            file: state.selectedFile?.path ?? null,
            version: state.selectedVersion === state.selectedSkill?.latestVersion ? null : state.selectedVersion,
          },
        }
      : undefined,
  ))

  return (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <Routes>
        <Route path="/" element={<MarketplaceCatalogPage />} />
        <Route path="/skills/:identifier" element={<MarketplaceSkillDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}
